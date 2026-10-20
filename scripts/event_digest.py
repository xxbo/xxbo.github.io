"""Conservative title grouping and bounded seven-day observation history.

This records collector observations, not verified event occurrence or factual changes.
"""
import copy
import datetime as dt
import hashlib
import re
import unicodedata


def stamp(value):
    try:
        date = dt.datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return date if date.tzinfo else date.replace(tzinfo=dt.timezone.utc)
    except (ValueError, TypeError):
        return None


def normalized(title):
    return re.sub(r'[^\w]', '', unicodedata.normalize('NFKC', title or '').lower())


def similar(a, b):
    raw_a, raw_b = unicodedata.normalize('NFKC', a or '').lower(), unicodedata.normalize('NFKC', b or '').lower()
    # Check before removing punctuation: 1.5% and 15% must remain distinct.
    if set(re.findall(r'\d+(?:\.\d+)?', raw_a)) != set(re.findall(r'\d+(?:\.\d+)?', raw_b)):
        return False
    for positive, negative in [('上调', '下调'), ('上涨', '下跌'), ('加息', '降息'), ('盈利', '亏损')]:
        if (positive in raw_a and negative in raw_b) or (negative in raw_a and positive in raw_b):
            return False
    a, b = normalized(a), normalized(b)
    if a == b and a:
        return True
    if min(len(a), len(b)) < 12:
        return False
    x = {a[i:i+3] for i in range(len(a)-2)}
    y = {b[i:i+3] for i in range(len(b)-2)}
    shared = len(x & y)
    return shared / max(1, len(x | y)) >= .55 and shared / min(len(x), len(y)) >= .72


def fingerprint(row):
    content = '\n'.join(re.sub(r'\s+', ' ', row.get(k) or '').strip()
                        for k in ('title', 'summary', 'reader_text'))
    return hashlib.sha256(content.encode()).hexdigest()[:20]


def compact(row):
    keys = ('id', 'title', 'url', 'source', 'category', 'published_at', 'fetched_at',
            'feed_id', 'kind', 'first_seen', 'updated_at', 'fingerprint', 'event_id')
    result = {k: row.get(k) for k in keys}
    result['summary'] = (row.get('summary') or '')[:500]
    return result


def build_events(news, previous, now):
    current = stamp(now)
    cutoff = current - dt.timedelta(days=7)
    events = [copy.deepcopy(e) for e in previous.get('events', [])
              if (stamp(e.get('last_activity')) or dt.datetime.min.replace(tzinfo=dt.timezone.utc)) >= cutoff]
    # Initial migration can remember the previous snapshot without inventing older history.
    if not previous.get('events') and previous.get('news'):
        seeded = build_events(copy.deepcopy(previous['news']), {}, previous.get('generated_at') or now)
        events = [e for e in seeded if (stamp(e['last_activity']) or current) >= cutoff]
    by_id = {a['id']: (e, a) for e in events for a in e['articles']}
    by_url = {a.get('url'): e for e in events for a in e['articles'] if a.get('url')}
    for e in events:
        e['active'] = False
    for row in sorted(news, key=lambda n: (n.get('published_at') or '', n['id'])):
        known = by_id.get(row['id'])
        event = known[0] if known else by_url.get(row.get('url'))
        if not event:
            published = stamp(row.get('published_at'))
            candidates = [e for e in events if any(
                a.get('category') == row.get('category') and published and stamp(a.get('published_at'))
                and abs((published-stamp(a['published_at'])).total_seconds()) <= 48*3600
                and similar(row['title'], a['title']) for a in e['articles'][:1])]
            event = candidates[0] if candidates else None
        if not event:
            event = {'id': 'event:'+hashlib.sha256(row['id'].encode()).hexdigest()[:16],
                     'title': row['title'], 'category': row.get('category'),
                     'first_seen': now, 'last_activity': now, 'articles': [], 'changes': []}
            events.append(event)
        old = known[1] if known else None
        fp = fingerprint(row)
        row.update(event_id=event['id'], first_seen=old.get('first_seen', now) if old else now,
                   updated_at=old.get('updated_at', now) if old and old.get('fingerprint') == fp else now,
                   fingerprint=fp)
        if not old or old.get('fingerprint') != fp:
            event['last_activity'] = now
            event['changes'].append({'at': now, 'article_id': row['id'],
                                     'type': 'content_updated' if old else 'report_added',
                                     'title': row['title'], 'source': row.get('source')})
        event['articles'] = [a for a in event['articles'] if a['id'] != row['id']] + [compact(row)]
        event['active'] = True
        by_id[row['id']] = (event, compact(row))
        by_url[row.get('url')] = event
    for event in events:
        event['articles'].sort(key=lambda a: (a.get('first_seen') or '', a['id']))
        # Preserve the anchor title so later comparisons do not chain unrelated stories.
        if len(event['articles']) > 12:
            event['articles'] = event['articles'][:1] + event['articles'][-11:]
        event['changes'] = event['changes'][-24:]
        event['sources'] = sorted({a.get('source') or '未知来源' for a in event['articles']})
    return sorted(events, key=lambda e: e['last_activity'], reverse=True)[:300]
