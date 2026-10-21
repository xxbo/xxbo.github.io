import json
import unittest
from data_health import run_chain, validate_quote
from market_adapters import eastmoney_quote

NOW='2026-10-21T07:32:00+00:00'

def quote(stamp, price=3713.03):
    return [{'id':'sh000001','region':'A股','price':price,'change':-22.34,'change_pct':-.6,'quote_at':stamp}]

class FreshQuoteTests(unittest.TestCase):
    def run_sources(self, rows, now=NOW):
        chain=[(name,lambda r=r:r) for name,r in rows]
        return run_chain('quote:sh000001',chain,[],{},now,lambda r:validate_quote(r,now),prefer_latest=True)

    def test_stale_success_checks_backup(self):
        rows,state=self.run_sources([('primary',quote('2026-10-21T13:22:00+08:00')),('backup',quote('2026-10-21T15:00:00+08:00'))])
        self.assertEqual(state['mode'],'backup');self.assertEqual(state['selected_source'],'backup')
        self.assertEqual(rows[0]['quote_at'],'2026-10-21T15:00:00+08:00')
        self.assertEqual(len(state['attempts']),2)

    def test_preclose_quote_does_not_pass_as_closing_quote(self):
        _,state=self.run_sources([('primary',quote('2026-10-21T14:56:00+08:00')),('backup',quote('2026-10-21T15:00:00+08:00'))])
        self.assertEqual(state['selected_source'],'backup')

    def test_all_old_keep_newest_with_holiday_uncertainty(self):
        rows,state=self.run_sources([('primary',quote('2026-10-20T15:00:00+08:00')),('backup',quote('2026-10-20T15:01:00+08:00'))])
        self.assertEqual(state['status'],'ok');self.assertTrue(state['quality']['issues'])
        self.assertIn('可能休市',state['quality']['issues'][0]);self.assertEqual(rows[0]['quote_at'],'2026-10-20T15:01:00+08:00')

    def test_lunch_uses_morning_close(self):
        _,state=self.run_sources([('primary',quote('2026-10-21T11:30:00+08:00')),('backup',quote('2026-10-21T11:31:00+08:00'))], '2026-10-21T04:15:00+00:00')
        self.assertEqual(len(state['attempts']),1)

    def test_eastmoney_decimal_scale_and_source_timestamp(self):
        raw=json.dumps({'data':{'f57':'000001','f59':2,'f43':371303,'f169':-2234,'f170':-60,'f86':1792566000}}).encode()
        row=eastmoney_quote('sh000001',lambda u:raw,NOW)[0]
        self.assertEqual(row['price'],3713.03);self.assertEqual(row['change'],-22.34);self.assertEqual(row['change_pct'],-.6)
        self.assertEqual(row['quote_at'],'2026-10-21T15:00:00+08:00')
        validate_quote([row],NOW)

if __name__=='__main__':unittest.main()
