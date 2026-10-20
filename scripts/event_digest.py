"""Persistent, bounded event dossiers built from collector observations.

This records collector observations, not verified event occurrence or factual changes.
"""
import copy
import datetime as dt
import hashlib
import re
import unicodedata
from functools import lru_cache
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

RETENTION_DAYS = 30
MAX_EVENTS = 800

def canonical_url(url):
    try:
        u = urlsplit(url or "")
        query = [(k,v) for k,v in parse_qsl(u.query) if not k.lower().startswith("utm_") and k.lower() not in {"oc", "spm", "from", "source"}]
        return urlunsplit((u.scheme.lower(),u.netloc.lower(),u.path.rstrip("/"),urlencode(sorted(query)),""))
    except ValueError:
        return url or ""

@lru_cache(maxsize=8192)
def clean_title(title):
    text = unicodedata.normalize("NFKC", title or "").lower()
    return re.sub(r"_(?:公司新闻|财经新闻|新闻中心|财经)(?:_[^_]{1,12})*$", "", text)



def stamp(value):
    try:
        date = dt.datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return date if date.tzinfo else date.replace(tzinfo=dt.timezone.utc)
    except (ValueError, TypeError):
        return None


def normalized(title):
    return re.sub(r'[^\w]', '', clean_title(title))


def similar(a, b):
    raw_a, raw_b = clean_title(a), clean_title(b)
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
    return (shared / max(1, len(x | y)) >= .55 and shared / min(len(x), len(y)) >= .72) or (min(len(a),len(b)) >= 20 and shared / min(len(x),len(y)) >= .9)


def same_event(a, b):
    if canonical_url(a.get('url')) and canonical_url(a.get('url')) == canonical_url(b.get('url')):
        return True
    pa, pb = stamp(a.get('published_at')), stamp(b.get('published_at'))
    if not pa or not pb:
        return False
    gap = abs((pa-pb).total_seconds())
    # Long identical headlines may be republished. Short market bulletins recur daily.
    exact = normalized(a.get('title')) == normalized(b.get('title'))
    if exact and similar(a.get('title'),b.get('title')) and len(normalized(a.get('title'))) >= 20 and gap <= 7*86400 and not re.search(r'收盘|开盘|下跌|上涨|逆回购|收报|净流入|净流出',a.get('title','')):
        return True
    if exact and (len(normalized(a.get('title'))) < 20 or re.search(r'收盘|开盘|下跌|上涨|逆回购|收报|净流入|净流出',a.get('title','')) ) and pa.date() != pb.date():
        return False
    return gap <= 48*3600 and (a.get('category') == b.get('category') or exact) and similar(a.get('title'), b.get('title'))


def reconcile(events):
    """Merge old duplicate anchors without inventing a new observation or breaking links."""
    result = []
    for event in sorted(events, key=lambda e: (e.get('first_seen') or '', e['id'])):
        target = next((e for e in result if e['articles'] and event['articles'] and same_event(e['articles'][0],event['articles'][0])), None)
        if not target:
            event.setdefault('aliases', [])
            result.append(event)
            continue
        target['aliases'] = sorted(set(target.get('aliases', []) + event.get('aliases', []) + [event['id']]) - {target['id']})
        articles = {a['id']:a for a in target['articles']}
        for a in event['articles']:
            if a['id'] not in articles or (a.get('updated_at') or '') > (articles[a['id']].get('updated_at') or ''):
                articles[a['id']] = a
        target['articles'] = list(articles.values())
        changes = target['changes'] + event['changes']
        target['changes'] = sorted({(c['at'], c['article_id'], c['type']):c for c in changes}.values(), key=lambda c:c['at'])
        target['last_activity'] = max(target['last_activity'], event['last_activity'])
    return result


def fingerprint(row):
    content = '\n'.join(re.sub(r'\s+', ' ', row.get(k) or '').strip()
                        for k in ('title', 'summary', 'reader_text'))
    return hashlib.sha256(content.encode()).hexdigest()[:20]


def compact(row):
    keys = ('id', 'title', 'url', 'source', 'category', 'published_at', 'fetched_at',
            'feed_id', 'kind', 'first_seen', 'updated_at', 'fingerprint', 'event_id',
            'source_type', 'distribution', 'content_type')
    result = {k: row.get(k) for k in keys}
    result['summary'] = (row.get('summary') or '')[:500]
    return result


def build_events(news, previous, now):
    current = stamp(now)
    cutoff = current - dt.timedelta(days=RETENTION_DAYS)
    events = [copy.deepcopy(e) for e in previous.get('events', [])
              if (stamp(e.get('last_activity')) or dt.datetime.min.replace(tzinfo=dt.timezone.utc)) >= cutoff]
    # Initial migration can remember the previous snapshot without inventing older history.
    if not previous.get('events') and previous.get('news'):
        seeded = build_events(copy.deepcopy(previous['news']), {}, previous.get('generated_at') or now)
        events = [e for e in seeded if (stamp(e['last_activity']) or current) >= cutoff]
    events = reconcile(events)
    by_id = {a['id']: (e, a) for e in events for a in e['articles']}
    by_url = {canonical_url(a.get('url')): e for e in events for a in e['articles'] if a.get('url')}
    for e in events:
        e['active'] = False
    for row in sorted(news, key=lambda n: (n.get('published_at') or '', n['id'])):
        known = by_id.get(row['id'])
        event = known[0] if known else by_url.get(canonical_url(row.get('url')))
        if not event:
            candidates = [e for e in events if e['articles'] and same_event(row, e['articles'][0])]
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
        by_url[canonical_url(row.get('url'))] = event
    for event in events:
        event['articles'].sort(key=lambda a: (a.get('first_seen') or '', a['id']))
        # Preserve the anchor title so later comparisons do not chain unrelated stories.
        if len(event['articles']) > 24:
            event['articles'] = event['articles'][:1] + event['articles'][-23:]
        event['changes'] = event['changes'][-48:]
        event['schema_version'] = 2
        event['aliases'] = event.get('aliases', [])
        for article in event['articles']:
            article['event_id'] = event['id']
        event['sources'] = sorted({a.get('source') or '未知来源' for a in event['articles']})
    return sorted(events, key=lambda e: e['last_activity'], reverse=True)[:MAX_EVENTS]
