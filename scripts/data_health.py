"""Validated failover with explicit live/backup/cache states and bounded audit history."""
import copy
import datetime as dt
import hashlib
import json
import math
import re
import time
import urllib.error
import urllib.parse
from zoneinfo import ZoneInfo


class DataInvalid(ValueError):
    pass


def date_time(value):
    try:
        result=dt.datetime.fromisoformat(str(value).replace('Z','+00:00'))
        return result if result.tzinfo else None
    except (TypeError,ValueError):
        return None


def error_type(exc):
    if isinstance(exc,DataInvalid):return 'validation'
    if isinstance(exc,urllib.error.HTTPError):return 'http_'+str(exc.code)
    if isinstance(exc,(TimeoutError,urllib.error.URLError)):return 'network'
    return 'parse'


def run_chain(key, candidates, previous, old, now, validator, signature=None):
    attempts=[];selected=None;rows=None;issues=[]
    for index,(name,fn) in enumerate(candidates):
        started=time.monotonic()
        try:
            rows,issues=validator(fn())
            selected=(index,name)
            attempts.append({'source':name,'status':'ok','duration_ms':round((time.monotonic()-started)*1000)})
            break
        except Exception as exc:
            rows=None
            attempts.append({'source':name,'status':'error','kind':error_type(exc),
                             'error':str(exc)[:180],'duration_ms':round((time.monotonic()-started)*1000)})
    prior_mode=old.get('mode') or ('primary' if old.get('status')=='ok' else 'cache')
    if selected:
        rows=copy.deepcopy(rows)
        mode='primary' if selected[0]==0 else 'backup'
        name=selected[1];status='ok';last_success=now;count_fail=0
        raw=signature(rows) if signature else rows
        sig=hashlib.sha256(json.dumps(raw,ensure_ascii=False,sort_keys=True,default=str).encode()).hexdigest()[:20]
        changed=sig!=old.get('signature')
        last_changed=now if changed else old.get('last_changed',now)
        for row in rows:
            row['feed_id']=key;row['adapter']=name;row['data_state']='live'
    else:
        rows=copy.deepcopy(previous);mode='cache' if rows else 'unavailable';name=old.get('selected_source') or ' / '.join(sorted({str(r.get('source')) for r in rows if r.get('source')})) or None
        status='error';last_success=old.get('last_success');sig=old.get('signature');last_changed=old.get('last_changed')
        count_fail=old.get('consecutive_failures',0)+1
        for row in rows:
            row['data_state']='cached'
    audit=list(old.get('health_history',[]))[-11:]
    audit.append({'at':now,'status':status,'mode':mode,'source':name,'failed_attempts':sum(a['status']=='error' for a in attempts)})
    transitions=list(old.get('transitions',[]))[-11:]
    if old and (mode!=prior_mode or (name and name!=old.get('selected_source') and old.get('selected_source'))):
        transitions.append({'at':now,'from':prior_mode,'to':mode,'source':name})
    state={'id':key,'status':status,'mode':mode,'selected_source':name,'primary_source':candidates[0][0],
           'backup_sources':[n for n,_ in candidates[1:]],'last_success':last_success,'checked_at':now,
           'last_changed':last_changed,'signature':sig,'count':len(rows),'consecutive_failures':count_fail,
           'error':None if selected else '; '.join(a['source']+': '+a.get('error','') for a in attempts)[:400],
           'attempts':attempts,'quality':{'status':'warning' if issues else 'ok','issues':issues[:12]},
           'health_history':audit,'transitions':transitions[-12:]}
    return rows,state


def finite(value):
    return isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value)


def validate_quote(rows, now, previous=None):
    if not isinstance(rows,list) or len(rows)!=1:raise DataInvalid('单个指数报价结构不完整')
    row=rows[0]
    if row.get('asset_class')=='rates':
        if not finite(row.get('price')) or not -10<=row['price']<=40 or not finite(row.get('change')):raise DataInvalid('日度收益率或变化值非法')
        try:day=dt.date.fromisoformat(row['quote_date'])
        except (ValueError,KeyError):raise DataInvalid('收益率缺少观测日期')
        current=date_time(now).astimezone(ZoneInfo('America/New_York')).date()
        if day>current or (current-day).days>10:raise DataInvalid('收益率观测日期在未来或超过十天')
        if previous and previous.get('quote_date') and day<dt.date.fromisoformat(previous['quote_date']):raise DataInvalid('收益率观测日期回退')
        observations=row.get('observations',[])
        if len(observations)<2 or observations[-1].get('date')!=row['quote_date'] or observations[-1].get('value')!=row['price']:raise DataInvalid('收益率观测序列与当前值不一致')
        if any(not finite(r.get('value')) or not -10<=r['value']<=40 for r in observations):raise DataInvalid('收益率序列含非法数值')
        if abs(row['change']-(observations[-1]['value']-observations[-2]['value']))>1e-8:raise DataInvalid('收益率变化与前一有效观测不一致')
        dates=[r.get('date','') for r in observations]
        if dates!=sorted(set(dates)) or any(d>row['quote_date'] for d in dates):raise DataInvalid('收益率观测日期重复、乱序或晚于当前观测')
        if not row.get('quote_date_only') or row.get('quote_at'):raise DataInvalid('日度观测不得补造报价时刻')
        return rows,[]
    if not finite(row.get('price')) or row['price']<=0 or not finite(row.get('change_pct')) or abs(row['change_pct'])>100:
        raise DataInvalid('点位或涨跌幅非法')
    stamp=date_time(row.get('quote_at'))
    if not stamp:raise DataInvalid('缺少可核验的源端报价时间')
    current=date_time(now)
    if stamp>current+dt.timedelta(minutes=15):raise DataInvalid('报价时间在未来')
    if current-stamp>dt.timedelta(days=10):raise DataInvalid('源端报价超过十天未更新')
    if previous and date_time(previous.get('quote_at')) and stamp<date_time(previous['quote_at']):
        raise DataInvalid('报价时间回退，拒绝覆盖较新记录')
    issues=[]
    if current-stamp>dt.timedelta(days=4):issues.append('源端报价较早；可能为休市，未据此确认接口故障')
    return rows,issues


def validate_history(rows, now, previous=None):
    if not isinstance(rows,list):raise DataInvalid('日线不是列表')
    close_only=bool(rows) and all(r.get('close_only') is True for r in rows)
    if any(r.get('close_only') for r in rows) and not close_only:raise DataInvalid('不能混用日收盘序列与 OHLC 日线')
    clean={};bad=0;duplicates=0;current=date_time(now).astimezone(dt.timezone(dt.timedelta(hours=8))).date()
    for row in rows:
        try:
            day=dt.date.fromisoformat(row['date'])
            if day>current:raise ValueError()
            o,c,h,l=(row.get(k) for k in ('open','close','high','low'))
            if close_only:
                if not finite(c) or c<=0 or any(v is not None for v in (o,h,l)):raise ValueError()
            elif not all(finite(v) and v>0 for v in (o,c,h,l)) or h<max(o,c,l) or l>min(o,c,h):raise ValueError()
            if row.get('volume') is not None and (not finite(row['volume']) or row['volume']<0):raise ValueError()
            if day.isoformat() in clean:duplicates+=1
            clean[day.isoformat()]=row
        except (KeyError,ValueError,TypeError):bad+=1
    if bad>max(1,len(rows)*.05):raise DataInvalid('日线存在过多无效 OHLC 或日期')
    result=sorted(clean.values(),key=lambda r:r['date'])[-320:]
    if len(result)<120:raise DataInvalid('完整日线不足 120 条')
    if previous and result[-1]['date']<previous[-1]['date']:raise DataInvalid('日线末日回退')
    if (current-dt.date.fromisoformat(result[-1]['date'])).days>14:raise DataInvalid('最新日线超过十四天未更新')
    issues=[]
    if close_only:issues.append('只采用来源真实收盘值；无开高低或成交量，不计算 ATR、量价指标')
    if bad:issues.append(f'已剔除 {bad} 条非法日线')
    if duplicates:issues.append(f'已去重 {duplicates} 条同日期日线')
    if any((dt.date.fromisoformat(b['date'])-dt.date.fromisoformat(a['date'])).days>10 for a,b in zip(result,result[1:])):
        issues.append('日线有超过十个自然日的间隔，尚未核对交易所休市日历')
    return result,issues


def validate_news(rows, now):
    if not isinstance(rows,list) or not rows:raise DataInvalid('新闻源未返回有效列表')
    current=date_time(now);good={};bad=0
    for row in rows:
        stamp=date_time(row.get('published_at'))
        url=urllib.parse.urlparse(row.get('url') or '')
        if not row.get('id') or not str(row.get('title') or '').strip() or url.scheme!='https' or not url.netloc or not stamp or stamp>current+dt.timedelta(minutes=15):
            bad+=1;continue
        if current-stamp>dt.timedelta(days=7):
            bad+=1;continue
        good[row['id']]=row
    if not good:raise DataInvalid('新闻缺少有效日期，或全部超过七天；拒绝把旧 RSS 当新资讯')
    issues=[]
    if bad:issues.append(f'已剔除 {bad} 条过旧、未来日期或字段不完整的报道')
    if max(date_time(n['published_at']) for n in good.values())<current-dt.timedelta(hours=72):
        issues.append('最新报道超过 72 小时，来源可能更新较慢')
    return list(good.values()),issues


def validate_calendar(rows, now):
    if not isinstance(rows,list):raise DataInvalid('日历不是列表')
    current=date_time(now).astimezone(dt.timezone(dt.timedelta(hours=8))).date();end=current+dt.timedelta(days=45)
    clean={}
    for row in rows:
        try:
            day=dt.date.fromisoformat(row['date']);last=dt.date.fromisoformat(row.get('end_date') or row['date'])
            if not row.get('title') or not row.get('id') or last<day:raise ValueError()
            if row.get('date_only'):
                if row.get('time') or row.get('scheduled_at'):raise ValueError()
            else:
                stamp=date_time(row.get('scheduled_at'))
                if not stamp:raise ValueError()
                beijing=stamp.astimezone(dt.timezone(dt.timedelta(hours=8)))
                if beijing.date()!=day or beijing.strftime('%H:%M')!=row['time']:raise ValueError()
            if last>=current-dt.timedelta(days=30) and day<=end:clean[row['id']]=row
        except (ValueError,KeyError,TypeError):raise DataInvalid('日程日期、时刻或时区不一致')
    warnings=sorted({r['component_warning'] for r in clean.values() if r.get('component_warning')})
    return sorted(clean.values(),key=lambda r:(r['date'],r.get('time',''),r['id'])),warnings


def classify_news(row):
    host=urllib.parse.urlparse(row.get('url') or '').hostname or ''
    official=host.endswith('.gov.cn') or host.endswith('.gov') or host in ('www.cninfo.com.cn','www.hkexnews.hk')
    opinion=bool(re.search(r'评论|社评|观点|专栏',row.get('title') or ''))
    row['source_type']='official' if official else 'commentary' if opinion else 'wire' if row.get('kind')=='flash' else 'media'
    row['content_type']='rss' if row.get('reader_text') else 'excerpt' if row.get('summary') else 'title'
    row.setdefault('distribution','publisher')
    return row
