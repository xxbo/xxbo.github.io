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
import urllib.error
import threading
import socket
import time
import copy
import xml.etree.ElementTree as ET
from leisure_sources import SOURCES as LEISURE_SOURCES, chinese_articles, ENTERTAINMENT, prepare_leisure
from entertainment_sources import five_eplay
from feed_images import feed_images
from intraday import CODES as MINUTE_CODES, candidates as minute_candidates, validate as validate_minutes
from event_digest import build_events, fingerprint, RETENTION_DAYS, MAX_EVENTS
from economic_calendar import calendar_candidates, SOURCES as CALENDAR_SOURCES
from calendar_results import collect_results
from global_markets import INSTRUMENTS, meta as global_meta
from market_adapters import NAMES, quote_candidates, history_candidates, session_key, mark_partial
from data_health import run_chain, validate_quote, validate_history, validate_news, validate_calendar, classify_news, date_time, finite

ROOT = pathlib.Path(__file__).resolve().parents[1]
NOW = dt.datetime.now(dt.timezone.utc).isoformat()
UA = 'Mozilla/5.0 (compatible; XXBOReader/1.0; personal dashboard)'
_responses = {}
_response_lock = threading.Lock()


def request(url):
    # One request per distinct URL per collection, including concurrent quote adapters.
    with _response_lock:
        future = _responses.get(url)
        owner = future is None
        if owner:
            future = concurrent.futures.Future()
            _responses[url] = future
    if not owner:
        return future.result()
    try:
        host = urllib.parse.urlparse(url).hostname or ''
        referer = 'https://finance.sina.com.cn/' if 'sina' in host else 'https://gu.qq.com/' if 'gtimg' in host or 'qq.com' in host else url
        req = urllib.request.Request(url, headers={'User-Agent': UA, 'Referer': referer})
        for attempt in range(2):
            try:
                with urllib.request.urlopen(req, timeout=10) as res:
                    body = res.read(8*1024*1024+1)
                    if len(body)>8*1024*1024:
                        raise ValueError('来源响应超过 8 MB 上限')
                future.set_result(body)
                return body
            except urllib.error.HTTPError as exc:
                if exc.code not in (500,502,503,504) or attempt:
                    raise
                time.sleep(.2)
            except (urllib.error.URLError, TimeoutError, socket.timeout):
                if attempt:
                    raise
                time.sleep(.2)
    except Exception as exc:
        future.set_exception(exc)
        raise


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
    return {'reader_text': text, 'reader_kind': 'rss',
            'reader_truncated': False, 'rss_url': rss_url,
            'summary': re.sub(r'\s+', ' ', text)[:180]}


def feed_publication(stamp, is_atom=False):
    try:
        return (dt.datetime.fromisoformat(stamp.replace('Z','+00:00')) if is_atom else email.utils.parsedate_to_datetime(stamp)).isoformat()
    except (TypeError,ValueError,AttributeError):
        match=re.search(r'(\d{1,2})\s+(\d{1,2})\s*月\s+(\d{4})\s+(\d{2}:\d{2}:\d{2})\s+([+-]\d{4})$',stamp or '')
        if match:
            day,month,year,clock,offset=match.groups()
            try:return dt.datetime.strptime(f'{year}-{month}-{day} {clock} {offset}','%Y-%m-%d %H:%M:%S %z').isoformat()
            except ValueError:pass
    return None


def publisher_feed(url, source, limit=8, category='科技', leisure=False):
    rows = []
    root = ET.fromstring(request(url))
    atom = '{http://www.w3.org/2005/Atom}'
    items = root.findall('./channel/item') or root.findall(atom+'entry')
    def markup(node):
        if node is None:return ''
        if not len(node):return node.text or ''
        cloned = copy.deepcopy(node)
        for child in cloned.iter():
            if child.tag.startswith('{http://www.w3.org/1999/xhtml}'):
                child.tag = child.tag.split('}',1)[1]
        return (cloned.text or '')+''.join(ET.tostring(child,encoding='unicode') for child in cloned)
    for item in items[:limit]:
        is_atom = item.tag == atom+'entry'
        content = item.find(atom+'content' if is_atom else '{http://purl.org/rss/1.0/modules/content/}encoded')
        if content is None:content = item.find(atom+'summary' if is_atom else 'description')
        raw = markup(content)
        title = clean(item.findtext(atom+'title' if is_atom else 'title'))
        fields = reader_fields(raw, url)
        if not title and leisure:title = re.sub(r'\s+', ' ', fields['reader_text'])[:80]
        link = next((x.get('href','') for x in item.findall(atom+'link') if x.get('rel','alternate')=='alternate'),'') if is_atom else (item.findtext('link') or '').strip()
        if not link:continue
        link = urllib.parse.urljoin(url,link)
        if link.startswith('http://'):link = 'https://' + link[7:]
        if not title or not link.startswith('https://'):continue
        stamp = (item.findtext(atom+'published') or item.findtext(atom+'updated')) if is_atom else item.findtext('pubDate')
        published = feed_publication(stamp,is_atom)
        rows.append({'id': 'rss:'+hashlib.sha256(link.encode()).hexdigest()[:20],
                     'title': title, 'url': link, 'source': source, 'category': category, 'leisure': leisure,
                     'published_at': published, 'fetched_at': NOW, 'kind': 'headline',
                     'selection': '轻松阅读 · RSS' if leisure else '科技媒体 RSS', **fields, **feed_images(item, raw, link)})
    if not rows:raise ValueError(source+' RSS 未返回条目')
    return chinese_articles(rows) if leisure else rows

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
                     'published_at': entry.findtext('a:published', namespaces=atom) or entry.findtext('a:updated', namespaces=atom), 'fetched_at': NOW, **reader_fields(entry.findtext('a:content', namespaces=atom) or entry.findtext('a:summary', namespaces=atom), ''), **feed_images(entry, entry.findtext('a:content', namespaces=atom) or entry.findtext('a:summary', namespaces=atom), link)})
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
        raw = item.findtext('{http://purl.org/rss/1.0/modules/content/}encoded') or item.findtext('description') or ''
        rows.append({'id': hashlib.sha256(link.encode()).hexdigest()[:20], 'title': title,
                     'url': link, 'source': source, 'category': category,
                     'published_at': published, 'fetched_at': NOW, **reader_fields(raw, ''), **feed_images(item, raw, link)})
    return rows


def google_news(category, query):
    url = 'https://news.google.com/rss/search?' + urllib.parse.urlencode({
        'q': query + ' when:2d', 'hl': 'zh-CN', 'gl': 'CN', 'ceid': 'CN:zh-Hans'})
    rows = rss_rows(request(url), category)
    for row in rows:
        row.update(distribution='search_index',kind='search',selection='检索聚合')
    return rows


def bbc_world(category):
    rows = rss_rows(request('https://feeds.bbci.co.uk/news/world/rss.xml'), category)
    if category=='政治':
        rows=[r for r in rows if re.search(r'government|election|president|minister|parliament|policy|Trump|China',r['title'],re.I)]
    for row in rows:
        row.update(source='BBC World',distribution='rss',kind='search',selection='国际报道备用（英文）')
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
                     **reader_fields(item.findtext('description'), 'https://dedicated.wallstreetcn.com/rss.xml'), **feed_images(item, item.findtext('description'), link)})
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


def news_candidates():
    result = {}
    publishers = {
        'editorial:ifanr': ('爱范儿 RSS', lambda: publisher_feed('https://www.ifanr.com/feed', '爱范儿'), 'site:ifanr.com', '科技'),
        'editorial:geekpark': ('极客公园 RSS', lambda: publisher_feed('https://www.geekpark.net/rss', '极客公园'), 'site:geekpark.net', '科技'),
        'editorial:cls': ('财联社首页', cls_headlines, 'site:cls.cn', '金融'),
        'editorial:wsc': ('华尔街见闻 RSS', wallstreet_headlines, 'site:wallstreetcn.com', '金融')}
    for key,(name,fn,query,category) in publishers.items():
        result[key]=[(name,fn),('Google 新闻 / 原媒体报道索引',lambda c=category,q=query:google_news(c,q))]
    result['wire:eastmoney']=[('东方财富快讯',flash_feed),('华尔街见闻财经报道（非快讯）',wallstreet_headlines)]
    queries={'科技':'大模型 OR 半导体 OR OpenAI OR 英伟达','金融':'A股 OR 港股 OR 美股 OR 利率','全球':'俄乌 OR 中东 OR 地缘政治','政治':'国务院 OR 央行 OR 财政部 OR 中国政策'}
    for category,query in queries.items():
        chain=[('Google 新闻检索',lambda c=category,q=query:google_news(c,q))]
        if category=='科技':
            chain += [('爱范儿 RSS',lambda:publisher_feed('https://www.ifanr.com/feed','爱范儿')),('The Verge RSS',lambda:rss_rows(request('https://www.theverge.com/rss/index.xml'),'科技'))]
        elif category=='金融':chain += [('东方财富快讯',flash_feed),('华尔街见闻 RSS',wallstreet_headlines)]
        else:chain += [('BBC World RSS（英文）',lambda c=category:bbc_world(c))]
        result['news:'+category]=chain
    for slug,name,url,category,query in LEISURE_SOURCES:
        def fallback(c=category,q=query):
            rows=google_news(c,q)
            for r in rows:r.update(leisure=True,kind='headline',selection='轻松阅读 · 检索备用')
            return chinese_articles(rows)
        result['leisure:'+slug]=[(name+' RSS',lambda u=url,n=name,c=category,s=slug:prepare_leisure(publisher_feed(u,n,80 if s in ENTERTAINMENT else 10,c,True),s)),('Google 新闻检索备用',fallback)]
    def esports_index():
        rows=google_news('电竞','site:csgo.5eplay.com 赛事 OR 选手 OR CS2')
        for r in rows:r.update(leisure=True,kind='headline',selection='电竞检索备用',reader_kind='index',reader_scope='excerpt')
        return chinese_articles(rows)
    result['leisure:5eplay']=[('5EPLAY 公开资讯与正文',lambda:five_eplay(request,reader_fields,NOW)),('Google 新闻检索备用',esports_index)]
    return result


def collect_dashboard(previous,now):
    old_states={s['id']:s for s in previous.get('sources',[])}
    old_markets={m['id']:m for m in previous.get('markets',[])}
    result={'generated_at':now,'markets':[],'news':[],'calendar':[],'sources':[]}
    jobs={}
    for code in NAMES:
        old=old_markets.get(code,{})
        key='quote:'+code
        if key not in old_states and old.get('fetched_at'):
            old_states[key]={'status':old.get('quote_status',old.get('status','ok')),'mode':'primary','selected_source':old.get('source'),'last_success':old.get('fetched_at')}
        jobs[key]=(quote_candidates(code,request,now),[old] if finite(old.get('price')) and (old['price']>0 or old.get('asset_class')=='rates') else [],lambda rows,o=old:validate_quote(rows,now,o),lambda rows:[{k:r.get(k) for k in ('id','price','change','change_pct','quote_at','quote_date')} for r in rows])
    for code in MINUTE_CODES:
        old=old_markets.get(code,{}).get('intraday') or {}
        jobs['minute:'+code]=(minute_candidates(code,request),[old] if old.get('points') else [],lambda rows,o=old:validate_minutes(rows,now,o),None)
    for key,chain in news_candidates().items():
        prior=[r for r in previous.get('news',[]) if r.get('feed_id')==key]
        jobs[key]=(chain,prior,(lambda rows:validate_news(chinese_articles(rows),now,30)) if key.startswith('leisure:') else (lambda rows:validate_news(rows,now)),lambda rows:sorted((n['id'],fingerprint(n)) for n in rows))
    for cal in CALENDAR_SOURCES:
        key='calendar:'+cal;prior=[r for r in previous.get('calendar',[]) if r.get('feed_id')==key]
        jobs[key]=(calendar_candidates(cal,request,now,prior),prior,lambda rows:validate_calendar(rows,now),lambda rows:sorted((r['id'],r['date'],r['time'],r.get('end_date')) for r in rows))
    key='calendar:results';prior=[r for r in previous.get('calendar',[]) if r.get('feed_id')==key]
    jobs[key]=([('东方财富 / 经济指标与公布值',lambda p=prior:collect_results(request,now,p))],prior,lambda rows:validate_calendar(rows,now),lambda rows:sorted((r['id'],r.get('actual'),r.get('forecast'),r.get('previous')) for r in rows))
    def collect(key,job):
        chain,prior,validator,signature=job
        return run_chain(key,chain,prior,old_states.get(key,{}),now,validator,signature,prefer_latest=key in ('quote:sh000001','quote:sz399006','quote:sh000688'))
    minute_rows={}
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        futures={pool.submit(collect,key,job):key for key,job in jobs.items()}
        for future in concurrent.futures.as_completed(futures):
            key=futures[future];rows,status=future.result()
            if key.startswith('quote:'):
                if rows:
                    row=rows[0];row['quote_status']='ok' if status['status']=='ok' else 'stale'
                    result['markets'].append(row)
                else:
                    code=key.split(':',1)[1];name,region=NAMES[code]
                    result['markets'].append({'id':code,'name':name,'region':region,'status':'unavailable','quote_status':'unavailable','history':[]})
            elif key.startswith('minute:'):
                if rows:
                    minute_rows[key.split(':',1)[1]]={**rows[0],'status':'ok' if status['status']=='ok' else 'cached','fetched_at':status.get('last_success')}
            elif key.startswith('calendar:'):
                # Expiry is housekeeping, not a successful source check.
                rows,_=validate_calendar(rows,now)
                status['count']=len(rows)
                result['calendar'].extend(rows)
                notes=sorted({r['coverage_note'] for r in rows if r.get('coverage_note')})
                status['coverage_note']=' '.join(notes)
            else:
                for row in rows:classify_news(row)
                result['news'].extend(rows)
            result['sources'].append(status)
            print(f"{key}: {status['mode']} ({status['selected_source'] or 'none'}, {len(rows)})",flush=True)
    for market in result['markets']:
        if market['id'] in minute_rows:market['intraday']=minute_rows[market['id']]
        market.update(global_meta(market['id']) if market['id'] in INSTRUMENTS else {'asset_class':'stocks','unit':'点','currency':'USD' if market['id']=='usIXIC' else 'HKD' if market['id'].startswith('hk') else 'CNY'})
    result['markets'].sort(key=lambda m:list(NAMES).index(m['id']))
    # Each index is evaluated independently. Reuse valid history only within its collection window/session.
    def collect_history(market):
        code=market['id'];key='history:'+code;old=old_markets.get(code,{})
        if market.get('asset_class')=='rates':
            source=next((s for s in result['sources'] if s['id']=='quote:'+code),{})
            market.update(history=[],history_source=market.get('source'),history_status='not_applicable',history_fetched_at=market.get('fetched_at'),volume_basis='官方日度观测，无盘中 OHLC 或成交量')
            return {**source,'id':key,'count':len(market.get('observations',[])),'observation_only':True}

        prior=old.get('history',[]);prior_state=old_states.get(key) or {'status':old.get('history_status','ok'),'mode':'primary','selected_source':old.get('history_source') or '腾讯日线','last_success':old.get('history_fetched_at')}
        fetched=date_time(old.get('history_fetched_at'));age=(date_time(now)-fetched).total_seconds() if fetched else float('inf')
        if len(prior)>=120 and old.get('history_session_key')==session_key(code,now) and 0<=age<6*3600 and old.get('history_status')=='ok':
            try:
                rows,issues=validate_history(copy.deepcopy(prior),now)
                status={**prior_state,'id':key,'status':'ok','mode':prior_state.get('mode','primary'),'cache_reuse':True,'reused_at':now,
                        'last_success':old.get('history_fetched_at'),'selected_source':prior_state.get('selected_source') or old.get('history_source') or '腾讯日线',
                        'count':len(rows),'quality':{'status':'warning' if issues else 'ok','issues':issues}}
            except ValueError:
                rows,status=run_chain(key,history_candidates(code,request),prior,prior_state,now,lambda r:validate_history(r,now,prior))
        else:
            rows,status=run_chain(key,history_candidates(code,request),prior,prior_state,now,lambda r:validate_history(r,now,prior),lambda rows:[{k:r.get(k) for k in ('date','open','close','high','low','volume')} for r in rows])
        for bar in rows:
            for field in ('feed_id','adapter','data_state'):bar.pop(field,None)
        market['history']=mark_partial(rows,code,now)
        market['history_status']='ok' if status['status']=='ok' else 'stale' if rows else 'unavailable'
        market['history_source']=status.get('selected_source');market['history_fetched_at']=status.get('last_success')
        market['history_session_key']=session_key(code,now) if status['status']=='ok' else old.get('history_session_key')
        market['volume_basis']='来源原始单位；整段日线使用同一家来源，不拼接跨源量能'
        return status
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        result['sources'].extend(pool.map(collect_history,result['markets']))
    quotes=[s for s in result['sources'] if s['id'].startswith('quote:')]
    dates=[s.get('last_success') for s in quotes if s.get('last_success')]
    result['sources'].append({'id':'markets','status':'ok' if all(s['status']=='ok' for s in quotes) else 'error',
        'mode':'backup' if any(s['mode']=='backup' for s in quotes) else 'primary',
        'last_success':min(dates) if len(dates)==len(NAMES) else None,'checked_at':now,'count':sum(s['status']=='ok' for s in quotes),
        'error':'部分指数报价暂不可用，已逐项标明' if any(s['status']!='ok' for s in quotes) else None,'aggregate':True})
    unique={};priority={'headline':3,'flash':2,'search':1}
    for row in result['news']:
        old=unique.get(row['id'])
        if old is None or (row.get('data_state')!='cached',priority.get(row.get('kind'),0))>(old.get('data_state')!='cached',priority.get(old.get('kind'),0)):
            unique[row['id']]=row
    result['news']=sorted(unique.values(),key=lambda n:n.get('published_at') or '',reverse=True)
    result['calendar']=sorted({r['id']:r for r in result['calendar']}.values(),key=lambda r:(r['date'],r['time'],r['id']))
    result['calendar_coverage']={'days':45,'past_days':30,'result_future_days':14,'timezone':'Asia/Shanghai','schedule_only':False,
        'note':'已知时刻统一北京时间；仅日期条目保留来源当地日期。备用源覆盖范围可能不同，逐项标明。'}
    result['events']=build_events([n for n in result['news'] if not n.get('leisure')],previous,now)
    result['event_retention']={'days':RETENTION_DAYS,'max_events':MAX_EVENTS,'max_reports':24,'max_changes':48,
        'truncated': bool(previous.get('event_retention',{}).get('truncated')) or len(result['events']) >= MAX_EVENTS or (not previous.get('event_retention') and len(previous.get('events',[])) >= 300)}
    result['event_tracking_since']=previous.get('event_tracking_since') or previous.get('generated_at') or now
    result['desk_history']=previous.get('desk_history',[])
    result['desk_history_policy']=previous.get('desk_history_policy',{})
    result['source_policy_version']=2
    return result


def main():
    path=ROOT/'data/dashboard.json'
    try:previous=json.loads(path.read_text())
    except (OSError,ValueError):previous={}
    _responses.clear()
    result=collect_dashboard(previous,NOW)
    path.parent.mkdir(exist_ok=True)
    # Atomic replacement prevents a partially-written snapshot becoming a published success.
    temporary=path.with_suffix('.tmp')
    temporary.write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False)+'\n')
    temporary.replace(path)
    print(f"Snapshot: {len(result['markets'])} markets, {len(result['news'])} headlines, {len(result['calendar'])} calendar events",flush=True)


if __name__=='__main__':main()
