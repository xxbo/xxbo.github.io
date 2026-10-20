"""Index-specific quote and whole-series history adapters. No cross-source bar splicing."""
import datetime as dt
import json
import re
import urllib.parse
from zoneinfo import ZoneInfo

SYMBOLS={'sh000001':'000001.SS','sz399006':'399006.SZ','sh000688':'000688.SS','hkHSI':'^HSI','hkHSTECH':'HSTECH.HK','usIXIC':'^IXIC'}
NAMES={'sh000001':('上证指数','A股'),'sz399006':('创业板指','A股'),'sh000688':('科创50','A股'),'hkHSI':('恒生指数','港股'),'hkHSTECH':('恒生科技','港股'),'usIXIC':('纳斯达克','美股')}
TENCENT_URL='https://qt.gtimg.cn/q='+','.join(NAMES)
SINA_URL='https://hq.sinajs.cn/list='+','.join(code for code in NAMES if code!='usIXIC')


def number(value):
    try:return float(value)
    except (ValueError,TypeError):return None


def zone(code):return ZoneInfo('America/New_York' if code=='usIXIC' else 'Asia/Shanghai')


def base(code,source,url,now):
    name,region=NAMES[code]
    return {'id':code,'name':name,'region':region,'source':source,'source_url':url,'fetched_at':now,'status':'ok','quote_timezone':str(zone(code))}


def tencent_quote(code,request,now):
    payload=request(TENCENT_URL).decode('gb18030',errors='replace')
    match=re.search(r'v_'+re.escape(code)+r'="([^"]*)"',payload)
    fields=match[1].split('~') if match else []
    if len(fields)<34:raise ValueError('腾讯报价缺少该指数')
    stamp=fields[30]
    parsed=None
    for pattern in ('%Y%m%d%H%M%S','%Y/%m/%d %H:%M:%S','%Y-%m-%d %H:%M:%S'):
        try:parsed=dt.datetime.strptime(stamp,pattern).replace(tzinfo=zone(code));break
        except ValueError:pass
    row=base(code,'腾讯财经','https://gu.qq.com/'+code,now)
    row.update(price=number(fields[3]),change=number(fields[31]),change_pct=number(fields[32]),quote_time=stamp,quote_at=parsed.isoformat() if parsed else None)
    return [row]


def sina_quote(code,request,now):
    text=request(SINA_URL).decode('gb18030',errors='replace')
    match=re.search(r'hq_str_'+re.escape(code)+r'="([^"]*)"',text)
    fields=match[1].split(',') if match else []
    if code.startswith('hk'):
        if len(fields)<19:raise ValueError('新浪港股报价缺少该指数')
        price,change,pct=map(number,(fields[6],fields[7],fields[8]));stamp=fields[17]+' '+fields[18]
        parsed=dt.datetime.strptime(stamp,'%Y/%m/%d %H:%M').replace(tzinfo=zone(code))
    else:
        if len(fields)<32:raise ValueError('新浪 A 股报价缺少该指数')
        price,previous=number(fields[3]),number(fields[2]);change=price-previous if price and previous else None
        pct=change/previous*100 if change is not None and previous else None
        stamp=fields[30]+' '+fields[31];parsed=dt.datetime.strptime(stamp,'%Y-%m-%d %H:%M:%S').replace(tzinfo=zone(code))
    row=base(code,'新浪财经','https://finance.sina.com.cn/',now)
    row.update(price=price,change=change,change_pct=pct,quote_time=stamp,quote_at=parsed.isoformat())
    return [row]


def yahoo_data(code,request,span):
    symbol=SYMBOLS[code]
    url='https://query1.finance.yahoo.com/v8/finance/chart/'+urllib.parse.quote(symbol,safe='')+'?range='+span+'&interval=1d'
    payload=json.loads(request(url));data=payload.get('chart',{}).get('result')
    if not data or data[0].get('meta',{}).get('symbol')!=symbol:raise ValueError('Yahoo 指数代码未匹配')
    return data[0]


def yahoo_quote(code,request,now):
    meta=yahoo_data(code,request,'1d')['meta'];price=number(meta.get('regularMarketPrice'));prior=number(meta.get('chartPreviousClose'))
    stamp=dt.datetime.fromtimestamp(meta['regularMarketTime'],zone(code))
    change=price-prior if price and prior else None
    row=base(code,'Yahoo Finance','https://finance.yahoo.com/quote/'+urllib.parse.quote(SYMBOLS[code],safe='')+'/',now)
    row.update(price=price,change=change,change_pct=change/prior*100 if change is not None and prior else None,quote_time=stamp.strftime('%Y-%m-%d %H:%M:%S'),quote_at=stamp.isoformat())
    return [row]


def quote_candidates(code,request,now):
    result=[('腾讯财经',lambda:tencent_quote(code,request,now))]
    if code!='usIXIC':result.append(('新浪财经',lambda:sina_quote(code,request,now)))
    result.append(('Yahoo Finance',lambda:yahoo_quote(code,request,now)))
    return result


def tencent_history(code,request,alternate=False):
    ident='us.IXIC' if code=='usIXIC' else code
    host='https://proxy.finance.qq.com/ifzqgtimg' if alternate else 'https://web.ifzq.gtimg.cn'
    url=host+f'/appstock/app/fqkline/get?param={ident},day,,,320,qfq'
    data=json.loads(request(url)).get('data',{}).get(ident,{})
    return [{'date':b[0],'open':number(b[1]),'close':number(b[2]),'high':number(b[3]),'low':number(b[4]),'volume':number(b[5])} for b in (data.get('day') or data.get('qfqday') or []) if len(b)>=6]


def sina_history(code,request):
    url='https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?'+urllib.parse.urlencode({'symbol':code,'scale':240,'ma':'no','datalen':320})
    data=json.loads(request(url))
    if not isinstance(data,list):raise ValueError('新浪未返回日线列表')
    return [{'date':r['day'][:10],**{k:number(r.get(k)) for k in ('open','close','high','low','volume')}} for r in data]


def yahoo_history(code,request):
    data=yahoo_data(code,request,'2y');quotes=data['indicators']['quote'][0];rows=[]
    for i,epoch in enumerate(data.get('timestamp',[])):
        row={'date':dt.datetime.fromtimestamp(epoch,zone(code)).date().isoformat()}
        row.update({k:number(quotes.get(k,[])[i]) for k in ('open','close','high','low','volume')})
        rows.append(row)
    return rows


def history_candidates(code,request):
    result=[('腾讯日线',lambda:tencent_history(code,request))]
    if NAMES[code][1]=='A股':result.append(('新浪日线',lambda:sina_history(code,request)))
    if code in ('hkHSI','usIXIC'):result.append(('Yahoo Finance 日线',lambda:yahoo_history(code,request)))
    result.append(('腾讯日线备用通道',lambda:tencent_history(code,request,True)))
    return result


def session_key(code,now):
    local=dt.datetime.fromisoformat(now).astimezone(zone(code));close_hour=15 if NAMES[code][1]=='A股' else 16
    return local.date().isoformat()+('-closed' if local.hour>=close_hour else '-open')


def mark_partial(rows,code,now):
    local=dt.datetime.fromisoformat(now).astimezone(zone(code));close_hour=15 if NAMES[code][1]=='A股' else 16
    for row in rows:row['partial']=row['date']==local.date().isoformat() and local.hour<close_hour
    return rows
