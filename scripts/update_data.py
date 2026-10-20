"""Build a small public dashboard snapshot. Standard library only; no secrets."""
import concurrent.futures
import datetime as dt
import email.utils
import hashlib
import html
from html.parser import HTMLParser
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
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Referer': 'https://gu.qq.com/' if 'gtimg.cn' in url else 'https://finance.eastmoney.com/'})
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
    from zoneinfo import ZoneInfo
    code = market['id']
    history_code = 'us.IXIC' if code=='usIXIC' else code
    url = f'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={history_code},day,,,320,qfq'
    prior = market.get('history', [])
    local = dt.datetime.now(ZoneInfo('America/New_York') if market['region']=='美股' else ZoneInfo('Asia/Shanghai'))
    close_hour = 15 if market['region']=='A股' else 16
    for bar in prior:
        bar['partial'] = bar['date']==local.date().isoformat() and local.hour<close_hour
    session_key = local.date().isoformat() + ('-closed' if local.hour>=close_hour else '-open')
    try:
        fetched = dt.datetime.fromisoformat(market.get('history_fetched_at', ''))
        age = (dt.datetime.now(dt.timezone.utc)-fetched).total_seconds()
        if len(prior)>=120 and market.get('history_session_key')==session_key and 0<=age<6*3600 and market.get('history_status')=='ok':
            return market
    except (TypeError, ValueError):
        pass
    try:
        payload = json.loads(request(url))
        data = payload.get('data', {}).get(history_code, {})
        bars = data.get('day') or data.get('qfqday') or []
        local = dt.datetime.now(ZoneInfo('America/New_York') if market['region']=='美股' else ZoneInfo('Asia/Shanghai'))
        close_hour = 15 if market['region']=='A股' else 16
        parsed = []
        for b in bars:
            if len(b)<6 or not number(b[2]) or number(b[2])<=0:
                continue
            parsed.append({'date': b[0], 'open': number(b[1]), 'close': number(b[2]),
                           'high': number(b[3]), 'low': number(b[4]), 'volume': number(b[5]),
                           'partial': b[0]==local.date().isoformat() and local.hour<close_hour})
        if not parsed or len(parsed)<min(len(prior),20):
            raise ValueError('daily history is incomplete')
        market['history'] = sorted({b['date']:b for b in parsed}.values(), key=lambda b:b['date'])[-320:]
        market['history_status'] = 'ok'
        market['history_fetched_at'] = NOW
        market['history_session_key'] = session_key
        market['volume_basis'] = '来源原始单位，仅做同指数内相对比较'
    except Exception:
        market['history'] = prior
        market['history_status'] = 'unavailable' if not prior else 'stale'
    return market


def clean(value):
    return re.sub(r'\s+', ' ', html.unescape(re.sub('<[^>]*>', '', value or ''))).strip()



class FeedText(HTMLParser):
    """Convert publisher-provided RSS HTML to inert, paragraph-separated text."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.skip = [], 0
    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'iframe', 'object'):
            self.skip += 1
        if not self.skip and tag in ('p', 'div', 'br', 'li', 'h1', 'h2', 'h3', 'blockquote', 'tr'):
            self.parts.append('\n')
    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'iframe', 'object'):
            self.skip = max(0, self.skip - 1)
        elif not self.skip and tag in ('p', 'div', 'li', 'h1', 'h2', 'h3', 'blockquote', 'tr'):
            self.parts.append('\n')
    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def reader_fields(raw, rss_url):
    parser = FeedText()
    parser.feed(raw or '')
    lines = [re.sub(r'\s+', ' ', line).strip() for line in ''.join(parser.parts).split('\n')]
    text = '\n\n'.join(line for line in lines if line)
    return {'reader_text': text[:14000], 'reader_kind': 'rss',
            'reader_truncated': len(text)>14000, 'rss_url': rss_url,
            'summary': re.sub(r'\s+', ' ', text)[:180]}


def publisher_feed(url, source, limit=8):
    rows = []
    root = ET.fromstring(request(url))
    for item in root.findall('./channel/item')[:limit]:
        title, link = clean(item.findtext('title')), (item.findtext('link') or '').strip()
        if not title or not link.startswith('https://'):
            continue
        try:
            published = email.utils.parsedate_to_datetime(item.findtext('pubDate')).isoformat()
        except (TypeError, ValueError):
            published = None
        raw = item.findtext('{http://purl.org/rss/1.0/modules/content/}encoded') or item.findtext('description') or ''
        rows.append({'id': 'rss:'+hashlib.sha256(link.encode()).hexdigest()[:20],
                     'title': title, 'url': link, 'source': source, 'category': '科技',
                     'published_at': published, 'fetched_at': NOW, 'kind': 'headline',
                     'selection': '科技媒体 RSS', **reader_fields(raw, url)})
    if not rows:
        raise ValueError(source+' RSS 未返回条目')
    return rows

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


def classify(title):
    if any(w in title for w in ('AI', '人工智能', '大模型', 'OpenAI', '芯片', '半导体', '苹果', '英伟达', '算力')):
        return '科技'
    if any(w in title for w in ('俄', '乌克兰', '伊朗', '中东', '战争', '以色列')):
        return '全球'
    if any(w in title for w in ('国务院', '证监会', '吴清', '潘功胜', '政策', '央行', '财政部')):
        return '政治'
    return '金融'


def cls_headlines():
    content = request('https://www.cls.cn/').decode('utf-8')
    match = re.search(r'<script[^>]+id="__NEXT_DATA__"[^>]*>(.*?)</script>', content, re.S)
    if not match:
        raise ValueError('财联社首页结构发生变化')
    props = json.loads(match.group(1))['props']['pageProps']
    top = props.get('assembleData', {}).get('top_article', [])
    hot = props.get('hotArticleData', [])
    rows, seen = [], set()
    for label, articles in [('首页头条', top), ('热门报道', hot[:10])]:
        for item in articles:
            ident = str(item.get('id') or '')
            if not ident or ident in seen or item.get('is_ad'):
                continue
            seen.add(ident)
            title = clean(item.get('title'))
            if not title:
                continue
            published = dt.datetime.fromtimestamp(item['ctime'], dt.timezone.utc).isoformat() if item.get('ctime') else None
            rows.append({'id': 'cls:'+ident, 'title': title, 'summary': clean(item.get('brief'))[:180],
                         'url': 'https://www.cls.cn/detail/'+ident, 'source': '财联社',
                         'category': classify(title), 'published_at': published, 'fetched_at': NOW,
                         'kind': 'headline', 'selection': label, 'featured': label=='首页头条'})
    if not rows:
        raise ValueError('财联社未提供头条列表')
    return rows


def wallstreet_headlines():
    root = ET.fromstring(request('https://dedicated.wallstreetcn.com/rss.xml'))
    rows = []
    for item in root.findall('./channel/item')[:16]:
        title, link = clean(item.findtext('title')), item.findtext('link') or ''
        promotional = any(word in title for word in ('见闻历', '早鸟', '最后优惠', '限时优惠', '免费领取', '报名通道', '会员专享'))
        if not title or promotional or not link.startswith('https://wallstreetcn.com/'):
            continue
        try:
            published = email.utils.parsedate_to_datetime(item.findtext('pubDate')).isoformat()
        except (TypeError, ValueError):
            published = None
        rows.append({'id': 'wsc:'+hashlib.sha256(link.encode()).hexdigest()[:16],
                     'title': title, 'summary': clean(item.findtext('description'))[:180],
                     'url': link, 'source': '华尔街见闻', 'category': classify(title),
                     'published_at': published, 'fetched_at': NOW, 'kind': 'headline',
                     'selection': '媒体资讯', 'featured': False,
                     **reader_fields(item.findtext('description'), 'https://dedicated.wallstreetcn.com/rss.xml')})
    if not rows:
        raise ValueError('华尔街见闻 RSS 未返回条目')
    return rows


def flash_feed():
    url = 'https://np-listapi.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&pageSize=30&sortEnd=&req_trace=1'
    data = json.loads(request(url))
    rows = []
    for item in (data.get('data') or {}).get('fastNewsList', []):
        code = str(item.get('code') or '')
        if code:
            rows.append({'id':'em:'+code,'title':clean(item.get('title')),'summary':clean(item.get('summary'))[:180],
                         'url':'https://finance.eastmoney.com/a/'+code+'.html','source':'东方财富快讯',
                         'category':'金融','published_at':str(item.get('showTime') or '').replace(' ', 'T')+'+08:00',
                         'fetched_at':NOW,'kind':'flash','selection':'即时快讯'})
    if not rows:
        raise ValueError('快讯源无有效数据')
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
    jobs = {'markets': market_snapshot, 'calendar': calendar_snapshot,
            'editorial:ifanr': lambda: publisher_feed('https://www.ifanr.com/feed', '爱范儿'),
            'editorial:geekpark': lambda: publisher_feed('https://www.geekpark.net/rss', '极客公园'),
            'editorial:cls': cls_headlines, 'editorial:wsc': wallstreet_headlines, 'wire:eastmoney': flash_feed}
    queries = {'科技': '大模型 OR 半导体 OR OpenAI OR 英伟达', '金融': 'A股 OR 港股 OR 美股 OR 利率', '全球': '俄乌 OR 中东 OR 地缘政治', '政治': '国务院 OR 央行 OR 财政部 OR 中国政策'}
    for category, query in queries.items():
        jobs['news:' + category] = lambda c=category, q=query: news_feed(c, q)
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(fn): key for key, fn in jobs.items()}
        for future in concurrent.futures.as_completed(futures):
            key = futures[future]
            try:
                rows = future.result()
                if key.startswith(('news:', 'editorial:', 'wire:')):
                    for row in rows:
                        row.setdefault('kind', 'search')
                        row['feed_id'] = key
                    result['news'].extend(rows)
                else:
                    result[key] = rows
                result['sources'].append({'id': key, 'status': 'ok', 'last_success': NOW,
                                          'count': len(rows), 'error': None})
            except Exception as e:
                old = next((s for s in previous.get('sources', []) if s['id'] == key), {})
                if key.startswith(('news:', 'editorial:', 'wire:')):
                    result['news'].extend(n for n in previous.get('news', []) if n.get('feed_id')==key)
                result['sources'].append({'id': key, 'status': 'error',
                                          'last_success': old.get('last_success'), 'error': str(e)[:160]})
                print(f'{key}: unavailable ({type(e).__name__})', flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for market in result['markets']:
            old_market = next((m for m in previous.get('markets', []) if m['id']==market['id']), {})
            if not market.get('history'):
                market['history'] = old_market.get('history', [])
                for key in ('history_fetched_at', 'history_status', 'history_session_key', 'volume_basis'):
                    if key in old_market:
                        market[key] = old_market[key]
        result['markets'] = list(pool.map(history, result['markets']))
    unique = {}
    priority = {'headline': 3, 'flash': 2, 'search': 1}
    for item in result['news']:
        old = unique.get(item['id'])
        if old is None or priority.get(item.get('kind'), 0)>priority.get(old.get('kind'), 0):
            unique[item['id']] = item
    result['news'] = list(unique.values())
    result['news'].sort(key=lambda n: n.get('published_at') or '', reverse=True)
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + '\n')
    print(f"Snapshot: {len(result['markets'])} markets, {len(result['news'])} headlines, {len(result['calendar'])} calendar events", flush=True)


if __name__ == '__main__':
    main()
