import datetime as dt
import json
import unittest
from intraday import validate,tencent,yahoo

NOW='2026-10-27T03:40:00+00:00'
class IntradayTests(unittest.TestCase):
    def test_source_points_are_validated_not_interpolated(self):
        payload={'data':{'sh000001':{'data':{'date':'20261027','data':['0930 100 1','0931 101 2','0931 102 3','1200 103 4','1550 104 5']},'qt':{'sh000001':['','','','','99']}}}}
        row=tencent('sh000001',json.dumps(payload));rows,_=validate([row],NOW)
        self.assertEqual(rows[0]['points'],[{'time':'09:30','price':100.0},{'time':'09:31','price':102.0}])
        self.assertEqual(rows[0]['previous_close'],99)
        with self.assertRaises(ValueError):validate([row],NOW,{'asof':'2026-10-27T10:00:00+08:00'})
        with self.assertRaises(ValueError):validate([{**row,'date':'2099-10-27'}],NOW)
    def test_us_timezone_and_one_minute_prices(self):
        stamp=int(dt.datetime.fromisoformat('2026-10-26T13:30:00+00:00').timestamp())
        payload={'chart':{'result':[{'meta':{'symbol':'^GSPC','chartPreviousClose':100},'timestamp':[stamp,stamp+60,stamp+120],'indicators':{'quote':[{'close':[101,None,102]}]}}]}}
        row=yahoo('usSPX',json.dumps(payload));rows,_=validate([row],NOW)
        self.assertEqual(rows[0]['date'],'2026-10-26');self.assertEqual([p['time'] for p in rows[0]['points']],['09:30','09:32'])
