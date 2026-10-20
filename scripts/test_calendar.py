import unittest
from economic_calendar import parse_ics, parse_nbs, parse_fed, collect_calendar, SOURCES

NOW='2026-10-20T07:00:00+00:00'

class CalendarTests(unittest.TestCase):
    def test_dst_and_folded_ics_and_cancelled(self):
        text='''BEGIN:VCALENDAR
BEGIN:VEVENT
UID:one
DTSTART;TZID=US-Eastern:20261029T083000
SUMMARY:Personal Income and
  Outlays
END:VEVENT
BEGIN:VEVENT
UID:two
DTSTART;TZID=US-Eastern:20261125T083000
SUMMARY:Consumer Price Index
END:VEVENT
BEGIN:VEVENT
UID:cancelled
STATUS:CANCELLED
DTSTART:20261025T123000Z
SUMMARY:Cancelled
END:VEVENT
END:VCALENDAR'''
        rows=parse_ics(text,'bls',NOW)
        self.assertEqual(len(rows),2)
        self.assertEqual(rows[0]['time'],'20:30')
        self.assertEqual(rows[1]['time'],'21:30')
        self.assertEqual(rows[0]['original_title'],'Personal Income and Outlays')
        self.assertIsNone(rows[0]['forecast'])

    def test_utc_converts_to_next_day_and_date_only_stays_unknown(self):
        text='''BEGIN:VCALENDAR
BEGIN:VEVENT
UID:one
DTSTART:20261029T220000Z
SUMMARY:Test
END:VEVENT
BEGIN:VEVENT
UID:two
DTSTART;VALUE=DATE:20261030
SUMMARY:Date only
END:VEVENT
END:VCALENDAR'''
        a,b=parse_ics(text,'bea',NOW)
        self.assertEqual((a['date'],a['time']),('2026-10-30','06:00'))
        self.assertTrue(b['date_only']);self.assertEqual(b['time'],'');self.assertIsNone(b['scheduled_at'])

    def test_nbs_rowspans_keep_times_in_right_month(self):
        raw='<table><tr><td>序号</td><td>内容</td>'+''.join('<td>'+str(m)+'月</td>' for m in range(1,13))+'</tr>'
        for i in range(4):
            raw+='<tr><td rowspan="2">'+str(i+1)+'</td><td rowspan="2">指标'+str(i)+'</td>'
            raw+=''.join('<td rowspan="2">……</td>' if m==2 else '<td>15/一</td>' for m in range(1,13))+'</tr>'
            raw+='<tr>'+''.join('<td>10:00</td>' if m==8 else '<td>9:30</td>' for m in range(1,13) if m!=2)+'</tr>'
        raw+='</table>'
        rows=parse_nbs(raw,2026,NOW,'https://www.stats.gov.cn/example')
        self.assertEqual(len(rows),44)
        self.assertFalse(any(r['date'][5:7]=='02' for r in rows))
        self.assertEqual(next(r['time'] for r in rows if r['date']=='2026-08-15'),'10:00')
        self.assertEqual(next(r['time'] for r in rows if r['date']=='2026-03-15'),'09:30')

    def test_fed_does_not_invent_statement_hour(self):
        html='''<h4>2026 FOMC Meetings</h4><div class="fomc-meeting__month col"><strong>October</strong></div><div class="fomc-meeting__date col">27-28</div>'''
        row=parse_fed(html,NOW)[0]
        self.assertEqual(row['date'],'2026-10-27');self.assertEqual(row['end_date'],'2026-10-28')
        self.assertEqual(row['time'],'');self.assertTrue(row['date_only'])

    def test_invalid_response_is_not_an_empty_success(self):
        with self.assertRaises(ValueError):parse_ics('<html>Access denied</html>','bea',NOW)
        with self.assertRaises(ValueError):parse_nbs('<html>Missing</html>',2026,NOW,'x')
        with self.assertRaises(ValueError):parse_fed('<html>Missing</html>',NOW)

    def test_valid_schedule_with_no_window_events_is_success(self):
        data=b'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x\nDTSTART:20270101T123000Z\nSUMMARY:Future outside window\nEND:VEVENT\nEND:VCALENDAR'
        self.assertEqual(collect_calendar('bea',lambda url:data,NOW),[])

if __name__=='__main__':unittest.main()
