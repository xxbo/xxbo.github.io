"""Explicit global instruments. Futures, FX and official daily yields retain their own units."""
import datetime as dt
import json
import math
import urllib.parse
import xml.etree.ElementTree as ET
from zoneinfo import ZoneInfo

INSTRUMENTS={
 'usSPX':dict(name='标普500',region='美股',symbol='^GSPC',timezone='America/New_York',asset_class='stocks',unit='点',currency='USD',close='16:00'),
 'usDJI':dict(name='道琼斯',region='美股',symbol='^DJI',timezone='America/New_York',asset_class='stocks',unit='点',currency='USD',close='16:00'),
 'jpN225':dict(name='日经225',region='日本',symbol='^N225',timezone='Asia/Tokyo',asset_class='stocks',unit='点',currency='JPY',close='15:30'),
 'deDAX':dict(name='德国DAX',region='欧洲',symbol='^GDAXI',timezone='Europe/Berlin',asset_class='stocks',unit='点',currency='EUR',close='17:30'),
 'ukFTSE':dict(name='英国富时100',region='欧洲',symbol='^FTSE',timezone='Europe/London',asset_class='stocks',unit='点',currency='GBP',close='16:30'),
 'inNIFTY':dict(name='印度NIFTY50',region='印度',symbol='^NSEI',timezone='Asia/Kolkata',asset_class='stocks',unit='点',currency='INR',close='15:30'),
 'auASX':dict(name='澳洲ASX200',region='澳大利亚',symbol='^AXJO',timezone='Australia/Sydney',asset_class='stocks',unit='点',currency='AUD',close='16:15'),
 'fxUSDCNY':dict(name='美元 / 人民币',region='外汇',symbol='CNY=X',timezone='Europe/London',asset_class='fx',unit='人民币/美元',currency='CNY',close='24:00',precision=4,note='USD/CNY 上升表示每美元可兑换更多人民币；数据商报价，不是银行结售汇价或人民币中间价。'),
 'fxEURUSD':dict(name='欧元 / 美元',region='外汇',symbol='EURUSD=X',timezone='Europe/London',asset_class='fx',unit='美元/欧元',currency='USD',close='24:00',precision=4,note='EUR/USD 上升表示欧元相对美元走强。数据商报价，不是银行成交保证价。'),
 'fxUSDJPY':dict(name='美元 / 日元',region='外汇',symbol='JPY=X',timezone='Europe/London',asset_class='fx',unit='日元/美元',currency='JPY',close='24:00',precision=3,note='USD/JPY 上升表示美元相对日元走强。'),
 'fxDXY':dict(name='美元指数',region='外汇',symbol='DX-Y.NYB',timezone='America/New_York',asset_class='fx',unit='点',currency='USD',close='24:00',note='美元指数不等于某一货币对；各汇率报价方向分别说明。'),
 'goldUS':dict(name='COMEX 黄金期货',region='商品',symbol='GC=F',timezone='America/New_York',asset_class='commodities',unit='美元/盎司',currency='USD',close='24:00',note='数据商所列近月期货，非现货金价；合约滚动可能造成价格与技术序列跳变。'),
 'oilWTI':dict(name='WTI 原油期货',region='商品',symbol='CL=F',timezone='America/New_York',asset_class='commodities',unit='美元/桶',currency='USD',close='24:00',note='数据商所列近月期货，非现货或加油站油价；合约滚动可能造成序列跳变。'),
 'oilBrent':dict(name='布伦特原油期货',region='商品',symbol='BZ=F',timezone='America/New_York',asset_class='commodities',unit='美元/桶',currency='USD',close='24:00',note='数据商所列布伦特期货，非现货报价；合约滚动可能造成序列跳变。'),
 'rateUS2Y':dict(name='美国2年期国债收益率',region='利率',symbol='BC_2YEAR',timezone='America/New_York',asset_class='rates',unit='%',precision=3,close='24:00',note='美国财政部每日国债平价收益率曲线，年化百分比；只提供观测日期，非实时债券价格。'),
 'rateUS10Y':dict(name='美国10年期国债收益率',region='利率',symbol='BC_10YEAR',timezone='America/New_York',asset_class='rates',unit='%',precision=3,close='24:00',note='美国财政部每日国债平价收益率曲线，年化百分比；收益率上升不代表债券价格上涨。')
}

def number(v):
 try:
  n=float(v);return n if math.isfinite(n) else None
 except (TypeError,ValueError):return None


def meta(code):
 d=INSTRUMENTS[code]
 return {k:d[k] for k in ('asset_class','unit','currency','precision','note') if k in d}


def base(code,source,url,now):
 d=INSTRUMENTS[code]
 return {'id':code,'name':d['name'],'region':d['region'],'symbol':d['symbol'],'source':source,'source_url':url,'fetched_at':now,'status':'ok','quote_timezone':d['timezone'],**meta(code)}


def yahoo_data(code,request,span='2y',alternate=False):
 symbol=INSTRUMENTS[code]['symbol'];host='query2' if alternate else 'query1'
 url='https://'+host+'.finance.yahoo.com/v8/finance/chart/'+urllib.parse.quote(symbol,safe='')+'?range='+span+'&interval=1d'
 data=json.loads(request(url)).get('chart',{}).get('result')
 if not data or data[0].get('meta',{}).get('symbol')!=symbol:raise ValueError('Yahoo 标的代码不匹配')
 return data[0]


def yahoo_quote(code,request,now,alternate=False):
 data=yahoo_data(code,request,'1d',alternate);m=data['meta'];price=number(m.get('regularMarketPrice'));prior=number(m.get('chartPreviousClose'))
 if price is None or prior is None or prior<=0:raise ValueError('缺少源端价格或前收盘，不能补写涨跌幅')
 stamp=dt.datetime.fromtimestamp(m['regularMarketTime'],ZoneInfo(INSTRUMENTS[code]['timezone']))
 row=base(code,'Yahoo Finance','https://finance.yahoo.com/quote/'+urllib.parse.quote(INSTRUMENTS[code]['symbol'],safe='')+'/',now)
 row.update(price=price,change=price-prior,change_pct=(price/prior-1)*100,quote_time=stamp.strftime('%Y-%m-%d %H:%M:%S'),quote_at=stamp.isoformat(),quote_delay_minutes=number(m.get('exchangeDataDelayedBy')),frequency='provider_quote',comparison_basis='相对来源所列前收盘',exchange=m.get('fullExchangeName'),contract_name=m.get('shortName') if row['asset_class']=='commodities' else None)
 if row.get('contract_name'):row['note']+=' 当前来源合约：'+row['contract_name']+'。'
 return [row]


def yahoo_history(code,request,alternate=False):
 data=yahoo_data(code,request,'2y',alternate);quotes=data['indicators']['quote'][0];rows=[]
 for i,epoch in enumerate(data.get('timestamp',[])):
  row={'date':dt.datetime.fromtimestamp(epoch,ZoneInfo(INSTRUMENTS[code]['timezone'])).date().isoformat()}
  row.update({k:number(quotes.get(k,[])[i]) if i<len(quotes.get(k,[])) else None for k in ('open','close','high','low','volume')})
  if any(row.get(k) is not None for k in ('open','close','high','low')):rows.append(row)
 return rows


def yahoo_close_history(code,request):
 # Preserve genuine source closes when its FX OHLC fields fail consistency checks.
 rows=yahoo_history(code,request)
 return [{'date':r['date'],'close':r['close'],'close_only':True} for r in rows if number(r.get('close')) is not None and r['close']>0]


def treasury_rows(payload,code):
 root=ET.fromstring(payload);field=INSTRUMENTS[code]['symbol'];rows={}
 for props in root.findall('.//{http://schemas.microsoft.com/ado/2007/08/dataservices/metadata}properties'):
  values={x.tag.rsplit('}',1)[-1]:x.text for x in props};day=(values.get('NEW_DATE') or '')[:10];value=number(values.get(field))
  try:dt.date.fromisoformat(day)
  except ValueError:continue
  if value is not None and -10<=value<=40:rows[day]={'date':day,'value':value}
 if not rows:raise ValueError('财政部未返回该期限的有效日度观测')
 return sorted(rows.values(),key=lambda r:r['date'])[-320:]


def treasury_quote(code,request,now,monthly=False):
 local=dt.datetime.fromisoformat(now).astimezone(ZoneInfo('America/New_York'))
 key='field_tdr_date_value_month' if monthly else 'field_tdr_date_value';period=local.strftime('%Y%m') if monthly else str(local.year)
 url='https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&'+key+'='+period
 rows=treasury_rows(request(url),code)
 if len(rows)<2: # First business day: same official feed, previous month/year.
  previous=(local.replace(day=1)-dt.timedelta(days=1)).strftime('%Y%m') if monthly else str(local.year-1)
  prior=treasury_rows(request(url.rsplit('=',1)[0]+'='+previous),code)
  rows=sorted({r['date']:r for r in prior+rows}.values(),key=lambda r:r['date'])[-320:]
 if len(rows)<2:raise ValueError('官方日度观测不足，无法比较前一有效观测')
 last,prior=rows[-1],rows[-2];row=base(code,'美国财政部','https://home.treasury.gov/resource-center-data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve&field_tdr_date_value='+str(local.year),now)
 # Date-only observations never acquire an invented source clock time or OHLC bars.
 row.update(price=last['value'],change=last['value']-prior['value'],change_pct=None,quote_time=last['date'],quote_date=last['date'],quote_date_only=True,observations=rows,previous_observation_date=prior['date'],frequency='official_daily',comparison_basis='相对前一有效日度观测，变化以 bp 展示')
 return [row]


def quote_candidates(code,request,now):
 if INSTRUMENTS[code]['asset_class']=='rates':return [('美国财政部年度 XML',lambda:treasury_quote(code,request,now)),('美国财政部月度 XML（同源备用）',lambda:treasury_quote(code,request,now,True))]
 return [('Yahoo Finance',lambda:yahoo_quote(code,request,now)),('Yahoo Finance 备用通道（同源）',lambda:yahoo_quote(code,request,now,True))]


def history_candidates(code,request):
 result=[('Yahoo Finance 日线',lambda:yahoo_history(code,request)),('Yahoo Finance 日线备用通道（同源）',lambda:yahoo_history(code,request,True))]
 if INSTRUMENTS[code]['asset_class']=='fx':result.append(('Yahoo Finance 日收盘序列（无 OHLC）',lambda:yahoo_close_history(code,request)))
 return result
