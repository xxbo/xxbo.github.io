"""Public Eastmoney economic releases; values stay in their publisher units."""
import concurrent.futures
import datetime as dt
import hashlib
import json
import math
import re
import urllib.parse
from economic_calendar import SH
from data_health import DataInvalid

RESULT_SOURCE = '东方财富经济日历'
RESULT_URL = 'https://emrnweb.eastmoney.com/cjrl/home'
API_URL = 'https://np-listapi.eastmoney.com/sec/economiccalendar/findByDateRange'
PAST_DAYS = 30
FUTURE_DAYS = 14


def value(raw):
    if raw is None or isinstance(raw, bool):
        return None
    text = str(raw).strip()
    if text.lower() in ('', '-', '--', '—', 'null', 'none', 'nan', '待公布', '未公布'):
        return None
    if len(text) > 80 or re.search(r'[<>]', text):
        raise DataInvalid('经济指标数值字段异常')
    try:
        numeric = float(text.replace(',', '').rstrip('%'))
    except ValueError:
        numeric = None  # Text such as a target-rate range remains source text.
    if numeric is not None and not math.isfinite(numeric):
        raise DataInvalid('经济指标包含非有限数值')
    return text


def parse_results(payload, now):
    data = json.loads(payload)
    if not isinstance(data, dict) or data.get('success') != 1 or not isinstance(data.get('data'), dict):
        raise DataInvalid('经济日历未返回有效数据对象')
    body = data['data']
    records = body.get('economicEventList')
    if not isinstance(records, list):
        raise DataInvalid('经济日历结果列表字段变化')
    # This endpoint includes separate important-event rows in total; never silently accept a truncated response.
    received = len(records) + len(body.get('importantEventList') or [])
    if not isinstance(body.get('total'), int) or body['total'] > received:
        raise DataInvalid('经济日历分页结果不完整')
    current = dt.datetime.fromisoformat(now).astimezone(SH)
    rows = []
    for item in records:
        if not isinstance(item, dict) or not all(item.get(k) for k in ('id', 'name', 'showTime', 'country', 'indicatorId')):
            raise DataInvalid('经济指标缺少身份或日期字段')
        try:
            stamp = dt.datetime.strptime(item['showTime'], '%Y-%m-%d %H:%M:%S').replace(tzinfo=SH)
        except (ValueError, TypeError) as exc:
            raise DataInvalid('经济指标发布时间格式变化') from exc
        # The publisher itself hides 23:59 placeholders in its calendar UI.
        date_only = stamp.strftime('%H:%M') == '23:59'
        actual = value(item.get('publishedValue'))
        if actual is not None and (stamp.date() > current.date() if date_only else stamp > current + dt.timedelta(minutes=5)):
            raise DataInvalid('经济指标在未来计划时点之前包含公布值')
        country = item['country']
        for region in ('中国香港', '中国澳门', '中国台湾'):
            if item['name'].startswith(region + ':'):
                country = region
                break
        ident = hashlib.sha256(str(item['id']).encode()).hexdigest()[:24]
        rows.append({
            'id': 'cal:em:' + ident, 'title': item['name'], 'original_title': item['name'],
            'country': country, 'date': stamp.date().isoformat(),
            'time': '' if date_only else stamp.strftime('%H:%M'),
            'scheduled_at': None if date_only else stamp.isoformat(),
            'date_only': date_only, 'timezone': 'Asia/Shanghai', 'source_timezone': 'Asia/Shanghai',
            'source_date': stamp.date().isoformat(), 'feed_id': 'calendar:results',
            'source': RESULT_SOURCE, 'source_type': 'media', 'url': RESULT_URL,
            'fetched_at': now, 'values_checked_at': now,
            'actual': actual, 'forecast': value(item.get('predictiveValue')),
            'previous': value(item.get('previousValue')), 'unit': value(item.get('unit')) or '',
            'indicator_id': str(item['indicatorId']), 'provider_event_id': str(item['id']),
            'record_type': 'indicator', 'result_source': RESULT_SOURCE, 'result_url': RESULT_URL,
            'reference_period': None,
            'coverage_note': '公布值、预期和前值来自东方财富整理；单位沿用来源，统计期未提供。',
            'schedule_note': '时间为来源日历的北京时间；具体时刻未提供时仅显示日期。',
        })
    return rows


def collect_results(request, now, previous=()):
    today = dt.datetime.fromisoformat(now).astimezone(SH).date()
    start, end = today - dt.timedelta(days=PAST_DAYS), today + dt.timedelta(days=FUTURE_DAYS)
    windows = []
    while start <= end:
        last = min(start + dt.timedelta(days=6), end)
        windows.append((start, last))
        start = last + dt.timedelta(days=1)

    def one(window):
        first, last = window
        query = urllib.parse.urlencode({'startDate': first.isoformat(), 'endDate': last.isoformat(),
                                      'req_trace': int(dt.datetime.fromisoformat(now).timestamp() * 1000)})
        rows = parse_results(request(API_URL + '?' + query), now)
        if any(not first.isoformat() <= r['date'] <= last.isoformat() for r in rows):
            raise DataInvalid('经济日历返回了查询窗口外的条目')
        return rows

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        rows = [row for group in pool.map(one, windows) for row in group]
    if not rows:
        raise DataInvalid('近期经济指标全部为空，保留上次成功数据')
    if len(rows) > 3000:
        raise DataInvalid('经济指标条目超过容量上限')
    old = {r['id']: r for r in previous}
    for row in rows:
        prior = old.get(row['id'], {})
        changes = list(prior.get('value_revisions', []))[-5:]
        if prior.get('actual_first_seen_at') or row['actual'] is not None:
            row['actual_first_seen_at'] = prior.get('actual_first_seen_at') or now
        if prior.get('actual') is not None and row['actual'] is not None and prior['actual'] != row['actual']:
            changes.append({'at': now, 'from': prior['actual'], 'to': row['actual']})
        row['value_revisions'] = changes[-6:]
    return sorted({r['id']: r for r in rows}.values(), key=lambda r: (r['date'], r['time'], r['id']))
