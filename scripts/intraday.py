"""Source minute observations, separate from complete daily bars."""
import datetime as dt
import json
import math
import urllib.parse
from zoneinfo import ZoneInfo

CODES = ['sh000001','sz399006','sh000688','hkHSI','hkHSTECH','usSPX','usIXIC','usDJI']
SYMBOLS = {'usSPX':'^GSPC','usIXIC':'^IXIC','usDJI':'^DJI'}
SECIDS = {'sh000001':'1.000001','sz399006':'0.399006','sh000688':'1.000688','hkHSI':'100.HSI','hkHSTECH':'100.HSTECH','usSPX':'100.SPX','usIXIC':'100.IXIC','usDJI':'100.DJIA'}


def zone(code):
    return 'America/New_York' if code.startswith('us') else 'Asia/Shanghai'


def regular(code, minute):
    t = int(minute[:2])*60+int(minute[3:])
    return 570<=t<=960 if code.startswith('us') else (570<=t<=(720 if code.startswith('hk') else 690) or 780<=t<=(960 if code.startswith('hk') else 900))


def number(v):
    try:
        f=float(v)
        return f if math.isfinite(f) and f>0 else None
    except (ValueError,TypeError):
        return None


def tencent(code, payload):
    data=json.loads(payload)['data'][code]
    raw=data['data'];day=dt.datetime.strptime(raw['date'],'%Y%m%d').date().isoformat()
    points=[]
    for value in raw['data']:
        fields=value.split();clock=fields[0]
        if len(clock)==4 and clock.isdigit():
            points.append({'time':clock[:2]+':'+clock[2:],'price':number(fields[1])})
    quote=data.get('qt',{}).get(code,[])
    return {'id':code,'date':day,'timezone':zone(code),'points':points,'previous_close':number(quote[4]) if len(quote)>4 else None,'source':'腾讯财经分时'}


def eastmoney(code,payload):
    data=json.loads(payload)['data']
    if not data or data.get('code')!=SECIDS[code].split('.')[1]:
        raise ValueError('东方财富分时代码不匹配')
    points=[];day=None
    for value in data.get('trends',[]):
        fields=value.split(',');stamp=dt.datetime.strptime(fields[0],'%Y-%m-%d %H:%M')
        if day and day!=stamp.date().isoformat():raise ValueError('分时混入多日数据')
        day=stamp.date().isoformat();points.append({'time':stamp.strftime('%H:%M'),'price':number(fields[2])})
    return {'id':code,'date':day,'timezone':zone(code),'points':points,'previous_close':number(data.get('preClose')),'source':'东方财富分时'}


def yahoo(code,payload):
    data=json.loads(payload)['chart']['result'][0]
    if data['meta'].get('symbol')!=SYMBOLS[code]:raise ValueError('Yahoo 分时代码不匹配')
    prices=data['indicators']['quote'][0]['close'];points=[];day=None
    for epoch,price in zip(data.get('timestamp',[]),prices):
        stamp=dt.datetime.fromtimestamp(epoch,ZoneInfo(zone(code)))
        if not regular(code,stamp.strftime('%H:%M')) or not number(price):continue
        current=stamp.date().isoformat()
        if current!=day:points=[];day=current
        points.append({'time':stamp.strftime('%H:%M'),'price':number(price)})
    return {'id':code,'date':day,'timezone':zone(code),'points':points,'previous_close':number(data['meta'].get('chartPreviousClose')),'source':'Yahoo Finance 分时'}


def validate(rows,now,previous=None):
    if not rows or len(rows)!=1:raise ValueError('分时源未返回有效序列')
    row=dict(rows[0]);code=row['id']
    if code not in CODES:raise ValueError('分时代码无效')
    day=dt.date.fromisoformat(row['date']);current=dt.datetime.fromisoformat(now).astimezone(ZoneInfo(zone(code)))
    if day>current.date() or (current.date()-day).days>10:raise ValueError('分时日期无效或过旧')
    points={}
    for p in row.get('points',[]):
        try:
            clock=dt.datetime.strptime(p['time'],'%H:%M').strftime('%H:%M')
            if not regular(code,clock) or number(p.get('price')) is None:continue
            stamp=dt.datetime.fromisoformat(row['date']+'T'+clock+':00').replace(tzinfo=ZoneInfo(zone(code)))
            if stamp>current+dt.timedelta(minutes=2):continue
            points[clock]={'time':clock,'price':float(p['price'])}
        except (TypeError,ValueError,KeyError):continue
    if len(points)<2:raise ValueError('有效分钟点不足，不用单个报价伪造分时')
    row['points']=[points[k] for k in sorted(points)]
    row['asof']=dt.datetime.fromisoformat(row['date']+'T'+row['points'][-1]['time']+':00').replace(tzinfo=ZoneInfo(zone(code))).isoformat()
    if previous and previous.get('asof') and row['asof']<previous['asof']:raise ValueError('拒绝分时数据回退')
    return [row],[]


def candidates(code,request):
    def read(url,parser):return [parser(code,request(url))]
    em='https://push2his.eastmoney.com/api/qt/stock/trends2/get?'+urllib.parse.urlencode({'secid':SECIDS[code],'fields1':'f1,f2,f3,f4,f5,f6,f7,f8','fields2':'f51,f52,f53,f54,f55,f56,f57,f58','ndays':1,'iscr':0})
    if code in SYMBOLS:
        return [('Yahoo Finance 一分钟',lambda:read('https://query1.finance.yahoo.com/v8/finance/chart/'+urllib.parse.quote(SYMBOLS[code],safe='')+'?range=1d&interval=1m',yahoo)),('Yahoo Finance 一分钟备用通道',lambda:read('https://query2.finance.yahoo.com/v8/finance/chart/'+urllib.parse.quote(SYMBOLS[code],safe='')+'?range=1d&interval=1m',yahoo))]
    return [('腾讯财经一分钟',lambda:read('https://web.ifzq.gtimg.cn/appstock/app/minute/query?code='+code,tencent)),('东方财富一分钟',lambda:read(em,eastmoney))]
