"""Official publication schedules only. No consensus forecasts or inferred release values."""
import datetime as dt
import hashlib
import html
import re
import urllib.parse
from zoneinfo import ZoneInfo

SH = ZoneInfo('Asia/Shanghai')
NY = ZoneInfo('America/New_York')
SOURCES = {
    'nbs': ('国家统计局', 'https://www.stats.gov.cn/xxgk/sjfb/fbrcb/'),
    'bls': ('美国劳工统计局 BLS', 'https://www.bls.gov/schedule/news_release/bls.ics'),
    'bea': ('美国经济分析局 BEA', 'https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics'),
    'fed': ('美联储 FOMC', 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'),
}


def clean(value):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]*>', ' ', value or ''))).strip()


def event(title, local, source_id, now, url=None, uid=None, end_date=None):
    source, source_url = SOURCES[source_id]
    timed = isinstance(local, dt.datetime)
    date = local.astimezone(SH).date() if timed else local
    source_date = local.date() if timed else local
    title_zh = title
    translations = [('State Employment and Unemployment', '美国各州就业与失业报告'),
                    ('Usual Weekly Earnings', '美国工资与薪金劳动者周薪报告'),
                    ('Metropolitan Area Employment', '美国都市区就业与失业报告'),
                    ('Quarterly Data Series on Business Employment Dynamics', '美国企业就业动态季度数据'),
                    ('Consumer Expenditures', '美国消费者支出报告'),
                    ('Productivity and Costs', '美国生产率与成本报告'),
                    ('Real Earnings', '美国实际收入报告'),
                    ('U.S. Import and Export Price Indexes', '美国进出口价格指数'),
                    ('Employer-Reported Workplace Injuries', '美国工作场所伤病年度报告'),
                    ('Activities of U.S. Multinational Enterprises', '美国跨国企业活动报告'),
                    ('County Employment and Wages', '美国县级就业与工资报告'),
                    ('GDP by County and Personal Income by County', '美国县级 GDP 与个人收入报告'),
                    ('Consumer Price Index', '美国消费者价格指数 CPI'),
                    ('Producer Price Index', '美国生产者价格指数 PPI'),
                    ('Employment Situation', '美国就业报告（含非农就业）'),
                    ('Job Openings and Labor Turnover', '美国职位空缺与劳动力流动调查 JOLTS'),
                    ('Employment Cost Index', '美国雇佣成本指数'),
                    ('Personal Income and Outlays', '美国个人收入与支出（含 PCE 数据）'),
                    ('Gross Domestic Product', '美国国内生产总值 GDP'),
                    ('GDP (', '美国国内生产总值 GDP'),
                    ('U.S. International Trade in Goods and Services', '美国国际货物与服务贸易')]
    for phrase, translation in translations:
        if title.startswith(phrase):
            title_zh = translation
            break
    if title_zh == '美国国内生产总值 GDP':
        if 'Advance Estimate' in title:
            title_zh += '（初值）'
        elif 'Second Estimate' in title:
            title_zh += '（第二次估算）'
        elif 'Third Estimate' in title:
            title_zh += '（第三次估算）'
    key = uid or title+'|'+source_date.isoformat()
    return {'id':'cal:'+source_id+':'+hashlib.sha256(key.encode()).hexdigest()[:18],
            'title':title_zh, 'original_title':title, 'country':'中国' if source_id=='nbs' else '美国',
            'date':date.isoformat(), 'time':local.astimezone(SH).strftime('%H:%M') if timed else '',
            'scheduled_at':local.isoformat() if timed else None,
            'timezone':'Asia/Shanghai' if timed else 'America/New_York',
            'source_timezone':str(local.tzinfo) if timed else 'America/New_York',
            'source_date':source_date.isoformat(), 'end_date':end_date,
            'date_only':not timed, 'source':source, 'url':url or source_url,
            'feed_id':'calendar:'+source_id, 'fetched_at':now,
            'previous':None, 'forecast':None, 'actual':None,
            'schedule_note':'官方计划可能调整；仅发布安排，不提供前值、预期值或公布值。'}


def unescape_ics(value):
    return re.sub(r'\\([nN,;\\])', lambda m: '\n' if m[1].lower()=='n' else m[1], value)


def parse_ics(payload, source_id, now):
    text = payload.decode('utf-8-sig') if isinstance(payload, bytes) else payload
    text = re.sub(r'\r?\n[ \t]', '', text)
    rows = []
    for block in re.findall(r'BEGIN:VEVENT\s*(.*?)END:VEVENT', text, re.S):
        props = {}
        for line in block.splitlines():
            if ':' not in line:
                continue
            field, value = line.split(':', 1)
            props[field.split(';')[0].upper()] = (field, value)
        if props.get('STATUS', ('',''))[1] == 'CANCELLED' or 'DTSTART' not in props or 'SUMMARY' not in props:
            continue
        field, start = props['DTSTART']
        if re.fullmatch(r'\d{8}', start):
            local = dt.datetime.strptime(start, '%Y%m%d').date()
        else:
            zone = re.search(r'TZID=([^;:]+)', field)
            tz = ZoneInfo({'US-Eastern':'America/New_York'}.get(zone[1], zone[1])) if zone else NY
            local = dt.datetime.strptime(start.rstrip('Z'), '%Y%m%dT%H%M%S').replace(tzinfo=dt.timezone.utc if start.endswith('Z') else tz)
        title = unescape_ics(props['SUMMARY'][1])
        uid = props.get('UID', ('',title+'|'+start))[1]
        rows.append(event(title, local, source_id, now, uid=uid))
    if not rows:
        raise ValueError('官方 ICS 未包含可识别事件')
    return rows


def table_grid(payload):
    """Expand rowspan/colspan so NBS dates and times keep their month columns."""
    text = payload.decode('utf-8') if isinstance(payload, bytes) else payload
    table = re.search(r'<table\b[^>]*>(.*?)</table>', text, re.S|re.I)
    if not table:
        raise ValueError('国家统计局未返回日程表格')
    spans, grid = {}, []
    for raw in re.findall(r'<tr\b[^>]*>(.*?)</tr>', table[1], re.S|re.I):
        row = {col:value for col,(left,value) in spans.items()}
        spans = {col:(left-1,value) for col,(left,value) in spans.items() if left>1}
        col=0
        for attrs,body in re.findall(r'<t[dh]\b([^>]*)>(.*?)</t[dh]>',raw,re.S|re.I):
            while col in row:
                col+=1
            def span(name):
                match=re.search(name+r'\s*=\s*[\"\x27]?(\d+)',attrs,re.I)
                return int(match[1]) if match else 1
            width,height=span('colspan'),span('rowspan')
            value=clean(body)
            for offset in range(width):
                row[col+offset]=value
                if height>1:
                    spans[col+offset]=(height-1,value)
            col+=width
        grid.append([row.get(i,'') for i in range(max(row.keys(),default=-1)+1)])
    return grid


def parse_nbs(payload, year, now, url):
    rows,grid=[],table_grid(payload)
    for index,cells in enumerate(grid):
        if len(cells)!=14 or not cells[0].isdigit():
            continue
        for month,cell in enumerate(cells[2:],1):
            days=re.findall(r'(\d{1,2})\s*/\s*[一二三四五六日天]',cell)
            for day in days:
                nextcell=grid[index+1][month+1] if index+1<len(grid) and len(grid[index+1])==14 else ''
                clock=re.search(r'(\d{1,2}):(\d{2})', nextcell)
                date=dt.date(year,month,int(day))
                if not clock:
                    # The NBS grid should provide times; fail visibly instead of guessing.
                    raise ValueError('国家统计局日程缺少可核验的发布时间')
                local=dt.datetime.combine(date,dt.time(int(clock[1]),int(clock[2])),SH)
                rows.append(event(cells[1],local,'nbs',now,url))
    if len(rows)<30:
        raise ValueError('国家统计局年度日程解析结果不完整')
    return rows


def parse_fed(payload, now):
    text=payload.decode('utf-8') if isinstance(payload,bytes) else payload
    sections=list(re.finditer(r'(\d{4}) FOMC Meetings',text))
    months={name:i+1 for i,name in enumerate(('January','February','March','April','May','June','July','August','September','October','November','December'))}
    rows=[]
    for index,section in enumerate(sections):
        year=int(section[1]);end=sections[index+1].start() if index+1<len(sections) else len(text)
        block=text[section.end():end]
        pairs=re.findall(r'fomc-meeting__month[^>]*>(.*?)</div>\s*<div[^>]*fomc-meeting__date[^>]*>(.*?)</div>',block,re.S)
        for month_text,days_text in pairs:
            month_name=clean(month_text);days=clean(days_text)
            names=month_name.split('/')
            if not all(name in months for name in names):
                continue
            match=re.fullmatch(r'(\d{1,2})\s*-\s*(\d{1,2})\*?',days)
            if not match:
                continue
            start=dt.date(year,months[names[0]],int(match[1]));end_day=dt.date(year,months[names[-1]],int(match[2]))
            rows.append(event('美联储 FOMC 议息会议',start,'fed',now,uid=start.isoformat(),end_date=end_day.isoformat()))
    if not rows:
        raise ValueError('美联储页面未返回可识别会议安排')
    return rows


def collect_calendar(key, request, now):
    source,url=SOURCES[key]
    if key=='nbs':
        year=dt.datetime.fromisoformat(now).astimezone(SH).year
        index=request(url).decode('utf-8')
        match=re.search(r'<a\b[^>]*href=[\"\x27]([^\"\x27]+)[\"\x27][^>]*>\s*'+str(year)+r'年国家统计局主要统计信息发布日程表',index,re.S)
        if not match:
            raise ValueError('尚未找到本年度国家统计局发布日程表')
        target=urllib.parse.urljoin(url,match[1])
        rows=parse_nbs(request(target),year,now,target)
    elif key in ('bls','bea'):
        rows=parse_ics(request(url),key,now)
    else:
        rows=parse_fed(request(url),now)
    today=dt.datetime.fromisoformat(now).astimezone(SH).date()
    end=today+dt.timedelta(days=45)
    # A valid schedule can legitimately have zero releases in this window.
    return sorted({r['id']:r for r in rows if today<=dt.date.fromisoformat(r.get('end_date') or r['date']) and dt.date.fromisoformat(r['date'])<=end}.values(), key=lambda r:(r['date'],r['time'],r['id']))
