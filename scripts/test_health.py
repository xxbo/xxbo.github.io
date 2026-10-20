import copy
import datetime as dt
import unittest
import urllib.error
from unittest.mock import patch
from data_health import (DataInvalid,run_chain,validate_news,validate_quote,validate_history,validate_calendar,classify_news)
from economic_calendar import parse_fred,canonical_calendar,parse_ics,collect_calendar

NOW='2026-10-20T08:30:00+00:00'

def fail():raise TimeoutError('offline')
def news():return [{'id':'n','title':'公开报道','url':'https://example.com/n','published_at':NOW,'fetched_at':NOW}]
def quote(code='sh000001',time='2026-10-20T08:00:00+00:00'):
    return {'id':code,'name':code,'region':'A股' if code.startswith('sh') else '港股','price':100,'change':1,'change_pct':1,'quote_at':time,'quote_time':'20261020160000','fetched_at':NOW,'status':'ok'}
def bars(volume=1):
    start=dt.date(2026,6,1)
    return [{'date':(start+dt.timedelta(days=i)).isoformat(),'open':100,'close':101,'high':102,'low':99,'volume':volume} for i in range(140)]

class HealthTests(unittest.TestCase):
    def test_fallback_then_primary_recovery(self):
        chain=[('primary',fail),('backup',news)]
        rows,status=run_chain('news:x',chain,[],{},NOW,lambda r:validate_news(r,NOW))
        self.assertEqual(status['mode'],'backup');self.assertEqual(status['status'],'ok')
        self.assertEqual([a['status'] for a in status['attempts']],['error','ok'])
        self.assertEqual(rows[0]['adapter'],'backup')
        recovered=NOW.replace('08:30','08:50')
        with patch('builtins.print'):
            rows2,next_status=run_chain('news:x',[('primary',news),('backup',fail)],rows,status,recovered,lambda r:validate_news(r,recovered))
        self.assertEqual(next_status['mode'],'primary');self.assertEqual(len(next_status['attempts']),1)
        self.assertEqual(next_status['transitions'][-1]['from'],'backup')
        self.assertEqual(next_status['last_success'],recovered)

    def test_schema_failure_also_switches(self):
        _,status=run_chain('news:x',[('bad',lambda:[]),('good',news)],[],{},NOW,lambda r:validate_news(r,NOW))
        self.assertEqual(status['mode'],'backup');self.assertEqual(status['attempts'][0]['kind'],'validation')

    def test_all_failed_preserves_data_and_original_time(self):
        prior=news();prior[0]['fetched_at']='2026-10-19T08:00:00+00:00'
        original=copy.deepcopy(prior)
        old={'selected_source':'old','status':'ok','mode':'primary','last_success':prior[0]['fetched_at'],'signature':'sig','last_changed':'old'}
        rows,state=run_chain('news:x',[('p',fail),('b',fail)],prior,old,NOW,lambda r:validate_news(r,NOW))
        self.assertEqual(prior,original);self.assertEqual(rows[0]['fetched_at'],original[0]['fetched_at'])
        self.assertEqual(rows[0]['data_state'],'cached');self.assertEqual(state['last_success'],old['last_success'])
        self.assertEqual(state['mode'],'cache');self.assertEqual(state['consecutive_failures'],1)
        _,again=run_chain('news:x',[('p',fail)],rows,state,NOW,lambda r:validate_news(r,NOW))
        self.assertEqual(again['consecutive_failures'],2)

    def test_empty_valid_calendar_is_not_failure(self):
        _,state=run_chain('calendar:x',[('p',lambda:[])],[],{},NOW,lambda r:validate_calendar(r,NOW))
        self.assertEqual(state['status'],'ok');self.assertEqual(state['count'],0)

    def test_quote_nan_future_and_rollback_are_rejected(self):
        for changes in [{'price':float('nan')},{'price':0},{'change_pct':float('inf')},{'quote_at':'2026-10-21T08:00:00Z'},{'quote_at':None}]:
            with self.assertRaises(DataInvalid):validate_quote([{**quote(),**changes}],NOW)
        newer=quote(time='2026-10-20T08:15:00Z')
        with self.assertRaises(DataInvalid):validate_quote([quote()],NOW,newer)

    def test_news_age_timestamp_and_provenance(self):
        old=news();old[0]['published_at']='2023-01-01T00:00:00Z'
        with self.assertRaises(DataInvalid):validate_news(old,NOW)
        rows,issues=validate_news(news()+old,NOW)
        self.assertEqual(len(rows),1);self.assertTrue(issues)
        row=classify_news({'url':'https://www.pbc.gov.cn/a','title':'发布公告','summary':'简报'})
        self.assertEqual(row['source_type'],'official');self.assertEqual(row['content_type'],'excerpt')

    def test_history_constraints_and_whole_series_replacement(self):
        invalid=bars();invalid[0]['high']=1
        rows,issues=validate_history(invalid,NOW)
        self.assertEqual(len(rows),139);self.assertTrue(issues)
        for r in invalid[:15]:r['low']=200
        with self.assertRaises(DataInvalid):validate_history(invalid,NOW)
        with self.assertRaises(DataInvalid):validate_history(bars()[:30],NOW)
        prior=bars(volume=99)
        rows,state=run_chain('history:x',[('bad',fail),('new',lambda:bars(volume=2))],prior,{},NOW,lambda r:validate_history(r,NOW,prior))
        self.assertEqual(state['mode'],'backup');self.assertEqual({r['volume'] for r in rows},{2})
        self.assertEqual({r['volume'] for r in prior},{99})

    def test_audit_is_bounded(self):
        state={};rows=[]
        for i in range(20):rows,state=run_chain('n',[('p',news)],rows,state,NOW,lambda r:validate_news(r,NOW))
        self.assertEqual(len(state['health_history']),12)

    def test_fred_uses_chicago_and_keeps_limited_scope(self):
        raw='''Sort By: <table><tr><td><span>Tuesday November 10, 2026</span></td></tr><tr><td>7:30 am</td><td><a href="/release?rid=10">Consumer Price Index</a></td></tr></table> All times are US Central Time.'''
        row=parse_fred(raw,NOW,'https://fred.stlouisfed.org/releases/calendar',10)[0]
        self.assertEqual(row['time'],'21:30');self.assertEqual(row['source_timezone'],'America/Chicago')
        self.assertIn('不包含全部',row['coverage_note']);self.assertIn('FRED',row['source'])

    def test_core_calendar_keeps_partial_results_and_unknown_hours(self):
        from economic_calendar import collect_fred
        from urllib.parse import urlparse,parse_qs
        def request(url):
            rid=int(parse_qs(urlparse(url).query)['rid'][0])
            if rid==11 or (rid==10 and 'alfred.' not in url):raise TimeoutError('fixture timeout')
            return ('Sort By: <table><tr><td>Tuesday November 10, 2026</td></tr>'
                    '<tr><td>7:30 am</td><td><a href="/release?rid='+str(rid)+'&rd=2026-11-10">Title</a></td></tr></table>'
                    +('' if 'alfred.' in url else ' All times are US Central Time.'))
        rows=collect_fred(request,NOW)
        self.assertEqual(len(rows),4)
        self.assertTrue(all(r.get('component_warning') for r in rows))
        alfred=next(r for r in rows if 'ALFRED' in r['source'])
        self.assertEqual(alfred['time'],'');self.assertTrue(alfred['date_only'])
        self.assertEqual(alfred['source_timezone'],'')
        _,warnings=validate_calendar(rows,NOW);self.assertTrue(warnings)

    def test_media_weekly_backup_marks_scope_and_ignores_forecasts(self):
        from economic_calendar import collect_forexfactory
        import json
        raw=json.dumps([{'title':'Housing Starts','country':'USD','date':'2026-10-20T08:30:00-04:00','forecast':'123','previous':'456'}, {'title':'Other','country':'EUR','date':'2026-10-20T08:30:00-04:00'}]).encode()
        rows=collect_forexfactory(lambda u:raw,NOW)
        self.assertEqual(len(rows),1);self.assertEqual(rows[0]['time'],'20:30')
        self.assertEqual(rows[0]['source_type'],'media');self.assertIn('本周',rows[0]['coverage_note'])
        self.assertIsNone(rows[0]['forecast']);self.assertIsNone(rows[0]['previous'])
        _,state=run_chain('calendar:bls',[('official',fail),('media weekly',lambda:rows)],[],{},NOW,lambda r:validate_calendar(r,NOW))
        self.assertEqual(state['mode'],'backup');self.assertEqual(state['status'],'ok')

    def test_expired_schedule_is_not_healthy_empty(self):
        raw=b'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x\nDTSTART:20230101T123000Z\nSUMMARY:Old\nEND:VEVENT\nEND:VCALENDAR'
        with self.assertRaises(DataInvalid):collect_calendar('bea',lambda url:raw,NOW)

    def test_calendar_ids_stable_across_adapter_formats(self):
        from economic_calendar import event
        d=dt.datetime(2026,10,29,12,30,tzinfo=dt.timezone.utc)
        a=event('Personal Income and Outlays, September 2026',d,'bea',NOW,uid='ics-uid')
        b=event('Personal Income and Outlays',d,'bea',NOW,uid='json-uid')
        self.assertEqual(canonical_calendar([a])[0]['id'],canonical_calendar([b])[0]['id'])

    def test_partial_quote_failure_is_isolated(self):
        import update_data as U
        def chains(code,request,now):return [('p',lambda:[quote(code)])] if code=='sh000001' else [('p',fail),('b',lambda:[quote(code)])]
        with patch.object(U,'NAMES',{'sh000001':('上证指数','A股'),'hkHSI':('恒生指数','港股')}),patch.object(U,'quote_candidates',chains),patch.object(U,'news_candidates',lambda:{}),patch.object(U,'CALENDAR_SOURCES',{}),patch.object(U,'history_candidates',lambda c,r:[('history',lambda:bars())]),patch('builtins.print'):
            data=U.collect_dashboard({},NOW)
        sources={s['id']:s for s in data['sources']}
        self.assertEqual(sources['quote:sh000001']['mode'],'primary')
        self.assertEqual(sources['quote:hkHSI']['mode'],'backup')
        self.assertEqual(len(data['markets']),2)
        self.assertEqual(sources['markets']['status'],'ok')

if __name__=='__main__':unittest.main()
