"""Build a small public dashboard snapshot. Standard library only; no secrets."""
import concurrent.futures
import datetime as dt
import email.utils
import hashlib
import html
import json
import pathlib
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[1]
NOW = dt.datetime.now(dt.timezone.utc).isoformat()
UA = 'Mozilla/5.0 (compatible; XXBOReader/1.0; personal dashboard)'
MARKETS = [
    ('sh000001', '上证指数', '1.000001', 'A股'),
    ('sz399006', '创业板指', '0.399006', 'A股'),
    ('sh000688', '科创50', '1.000688', 'A股'),
    ('hkHSI', '恒生指数', '100.HSI', '港股'),
    ('hkHSTECH', '恒生科技', '100.HSTECH', '港股'),
    ('usIXIC', '纳斯达克', '100.NDX', '美股'),
]


def request(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Referer': 'https://finance.eastmoney.com/'})
    with urllib.request.urlopen(req, timeout=18) as res:
        return res.read()


def number(value):
    try:
        n = float(value)
        return n if abs(n) < 1e16 else None
    except (TypeError, ValueError):
        return None


def market_snapshot():
    # Fetch a single batch, following CNEquity's snapshot reuse approach.
    url = 'https://qt.gtimg.cn/q=' + ','.join(m[0] for m in MARKETS)
    text = request(url).decode('gb18030', errors='replace')
    result = []
    for code, name, secid, region in MARKETS:
        match = re.search(r'v_' + re.escape(code) + r'="([^"]*)"', text)
        fields = match.group(1).split('~') if match else []
        row = {'id': code, 'name': name, 'region': region, 'secid': secid,
               'source': '腾讯财经', 'source_url': 'https://gu.qq.com/' + code,
               'fetched_at': NOW, 'status': 'unavailable', 'history': []}
        if len(fields) > 33 and number(fields[3]) is not None:
            row.update(price=number(fields[3]), change=number(fields[31]),
                       change_pct=number(fields[32]), quote_time=fields[30], status='ok')
        result.append(row)
    if not any(x['status'] == 'ok' for x in result):
        raise ValueError('行情接口未返回有效报价')
    return result


def history(market):
    # Daily close only, unadjusted index data. Failure does not invalidate quotes.
    code = market['id']
    if not code.startswith(('sh', 'sz')):
        return market
    url = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?' + urllib.parse.urlencode({'param': f'{code},day,,,40,qfq'})
    try:
        payload = json.loads(request(url))
        data = payload.get('data', {}).get(code, {})
        bars = data.get('day') or data.get('qfqday') or []
        market['history'] = [{'date': b[0], 'close': float(b[2])} for b in bars if len(b) > 2][-30:]
    except Exception:
        pass
    return market


def clean(value):
    return re.sub(r'\s+', ' ', html.unescape(re.sub('<[^>]*>', '', value or ''))).strip()


def rss_rows(payload, category):
    root = ET.fromstring(payload)
    atom = {'a': 'http://www.w3.org/2005/Atom'}
    rows = []
    for entry in root.findall('a:entry', atom)[:18]:
        title = clean(entry.findtext('a:title', namespaces=atom))
        links = entry.findall('a:link', atom)
        link = next((x.get('href', '') for x in links if x.get('rel', 'alternate') == 'alternate'), '')
        rows.append({'id': hashlib.sha256(link.encode()).hexdigest()[:20], 'title': title,
                     'url': link, 'source': 'The Verge', 'category': category,
                     'published_at': entry.findtext('a:published', namespaces=atom), 'fetched_at': NOW})
    for item in root.findall('./channel/item')[:24]:
        title = clean(item.findtext('title'))
        source = clean(item.findtext('source')) or 'BBC 中文'
        if source and title.endswith(' - ' + source):
            title = title[:-(len(source) + 3)]
        link = item.findtext('link') or ''
        if not title or not link.startswith('https://'):
            continue
        try:
            published = email.utils.parsedate_to_datetime(item.findtext('pubDate')).isoformat()
        except (TypeError, ValueError):
            published = None
        rows.append({'id': hashlib.sha256(link.encode()).hexdigest()[:20], 'title': title,
                     'url': link, 'source': source, 'category': category,
                     'published_at': published, 'fetched_at': NOW})
    return rows


def news_feed(category, query):
    url = 'https://news.google.com/rss/search?' + urllib.parse.urlencode({
        'q': query + ' when:2d', 'hl': 'zh-CN', 'gl': 'CN', 'ceid': 'CN:zh-Hans'})
    try:
        rows = rss_rows(request(url), category)
        if rows:
            return rows
    except Exception:
        pass
    if category == '科技':
        rows = rss_rows(request('https://www.theverge.com/rss/index.xml'), category)
    elif category == '金融':
        url = 'https://np-listapi.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&pageSize=18&sortEnd=&req_trace=1'
        data = json.loads(request(url))
        rows = []
        for item in (data.get('data') or {}).get('fastNewsList', []):
            code = str(item.get('code') or '')
            if not code:
                continue
            rows.append({'id': 'em:' + code, 'title': clean(item.get('title')),
                         'url': 'https://finance.eastmoney.com/a/' + code + '.html',
                         'source': '东方财富快讯', 'category': category,
                         'published_at': str(item.get('showTime') or '').replace(' ', 'T') + '+08:00',
                         'fetched_at': NOW})
    else:
        rows = rss_rows(request('https://feeds.bbci.co.uk/zhongwen/simp/rss.xml'), category)
        politics = ('政府', '选举', '总统', '政策', '习近平', '特朗普', '议会', '中国', '政治')
        rows = [n for n in rows if any(k in n['title'] for k in politics) == (category == '政治')]
    if not rows:
        raise ValueError('新闻源未返回条目')
    return rows


def calendar_snapshot():
    params = {'reportName': 'RPT_ECONOMICCALENDAR',
              'columns': 'PUBLISH_DATE,TIME,COUNTRY,INDICATOR,STAR,FORECAST,PREVIOUS,ACTUAL,UNIT',
              'pageSize': 500, 'pageNumber': 1, 'sortColumns': 'PUBLISH_DATE,TIME', 'sortTypes': '-1,-1',
              'source': 'WEB', 'client': 'WEB'}
    raw = json.loads(request('https://datacenter-web.eastmoney.com/api/data/v1/get?' + urllib.parse.urlencode(params)))
    records = (raw.get('result') or {}).get('data')
    if not isinstance(records, list):
        raise ValueError('经济日历接口未返回有效列表')
    today = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).date()
    end = today + dt.timedelta(days=7)
    rows = []
    for r in records:
        day = str(r.get('PUBLISH_DATE') or '')[:10]
        if not today.isoformat() <= day <= end.isoformat():
            continue
        rows.append({'date': day, 'time': str(r.get('TIME') or ''),
                     'country': str(r.get('COUNTRY') or ''), 'title': str(r.get('INDICATOR') or ''),
                     'importance': number(r.get('STAR')), 'previous': r.get('PREVIOUS'),
                     'forecast': r.get('FORECAST'), 'actual': r.get('ACTUAL'), 'unit': r.get('UNIT'),
                     'source': '东方财富', 'url': 'https://data.eastmoney.com/cjrl/default.html',
                     'fetched_at': NOW})
    return sorted(rows, key=lambda x: (x['date'], x['time']))[:30]


def main():
    path = ROOT / 'data/dashboard.json'
    try:
        previous = json.loads(path.read_text())
    except (OSError, ValueError):
        previous = {}
    result = {'generated_at': NOW, 'markets': previous.get('markets', []),
              'news': [], 'calendar': previous.get('calendar', []), 'sources': []}
    jobs = {'markets': market_snapshot, 'calendar': calendar_snapshot}
    queries = {'科技': '人工智能 科技', '金融': '财经 股市', '全球': '国际 局势', '政治': '中国 政策 经济'}
    for category, query in queries.items():
        jobs['news:' + category] = lambda c=category, q=query: news_feed(c, q)
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(fn): key for key, fn in jobs.items()}
        for future in concurrent.futures.as_completed(futures):
            key = futures[future]
            try:
                rows = future.result()
                if key.startswith('news:'):
                    result['news'].extend(rows)
                else:
                    result[key] = rows
                result['sources'].append({'id': key, 'status': 'ok', 'last_success': NOW,
                                          'count': len(rows), 'error': None})
            except Exception as e:
                old = next((s for s in previous.get('sources', []) if s['id'] == key), {})
                if key.startswith('news:'):
                    result['news'].extend(n for n in previous.get('news', []) if n['category'] == key[5:])
                result['sources'].append({'id': key, 'status': 'error',
                                          'last_success': old.get('last_success'), 'error': str(e)[:160]})
                print(f'{key}: unavailable ({type(e).__name__})', flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        result['markets'] = list(pool.map(history, result['markets']))
    result['news'].sort(key=lambda n: n.get('published_at') or '', reverse=True)
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(f"Snapshot: {len(result['markets'])} markets, {len(result['news'])} headlines, {len(result['calendar'])} calendar events", flush=True)


if __name__ == '__main__':
    main()
