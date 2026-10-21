import datetime as dt
import json
import unittest
from global_markets import INSTRUMENTS,yahoo_quote,yahoo_history,treasury_rows,treasury_quote
from market_adapters import NAMES,mark_partial,session_key,quote_candidates,history_candidates
from data_health import validate_quote,validate_history,DataInvalid
NOW='2026-10-21T02:00:00+00:00'
XML=b'''<feed xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata" xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices"><entry><m:properties><d:NEW_DATE>2026-10-19T00:00:00</d:NEW_DATE><d:BC_2YEAR>4.20</d:BC_2YEAR><d:BC_10YEAR>5.10</d:BC_10YEAR></m:properties></entry><entry><m:properties><d:NEW_DATE>2026-10-20T00:00:00</d:NEW_DATE><d:BC_2YEAR>4.22</d:BC_2YEAR><d:BC_10YEAR>5.15</d:BC_10YEAR></m:properties></entry></feed>'''
class GlobalTests(unittest.TestCase):
 def test_catalog(self):
  self.assertEqual(len(NAMES),22);self.assertEqual(len(INSTRUMENTS),16)
  self.assertEqual(INSTRUMENTS['fxUSDCNY']['unit'],'人民币/美元')
  self.assertEqual(INSTRUMENTS['goldUS']['asset_class'],'commodities')
  self.assertIn('同源',quote_candidates('jpN225',None,NOW)[1][0]);self.assertEqual(len(history_candidates('jpN225',None)),2)
 def test_quote_symbol_time_and_precision_metadata(self):
  payload={'chart':{'result':[{'meta':{'symbol':'EURUSD=X','regularMarketPrice':1.1234,'chartPreviousClose':1.1,'regularMarketTime':int(dt.datetime(2026,10,21,1,tzinfo=dt.timezone.utc).timestamp()),'exchangeDataDelayedBy':10}}]}}
  row=yahoo_quote('fxEURUSD',lambda u:json.dumps(payload).encode(),NOW)[0]
  self.assertEqual(row['price'],1.1234);self.assertEqual(row['quote_timezone'],'Europe/London');self.assertEqual(row['unit'],'美元/欧元');self.assertAlmostEqual(row['change_pct'],(1.1234/1.1-1)*100)
  validate_quote([row],NOW)
  with self.assertRaises(ValueError):yahoo_quote('jpN225',lambda u:json.dumps(payload).encode(),NOW)
 def test_missing_previous_close_is_not_zero_change(self):
  payload={'chart':{'result':[{'meta':{'symbol':'^N225','regularMarketPrice':100,'regularMarketTime':1}}]}}
  with self.assertRaises(ValueError):yahoo_quote('jpN225',lambda u:json.dumps(payload).encode(),NOW)
 def test_official_daily_no_fake_clock_or_ohlc(self):
  self.assertEqual(treasury_rows(XML,'rateUS10Y')[-1]['value'],5.15)
  row=treasury_quote('rateUS10Y',lambda u:XML,NOW)[0];validate_quote([row],NOW)
  self.assertEqual(row['quote_date'],'2026-10-20');self.assertTrue(row['quote_date_only']);self.assertNotIn('quote_at',row);self.assertNotIn('history',row);self.assertAlmostEqual(row['change']*100,5)
  self.assertIsNone(row['change_pct']);self.assertNotIn('open',row['observations'][0])
  with self.assertRaises(DataInvalid):validate_quote([{**row,'quote_at':NOW}],NOW)
  with self.assertRaises(DataInvalid):validate_quote([row],NOW,{**row,'quote_date':'2026-10-21'})
  with self.assertRaises(DataInvalid):validate_quote([{**row,'price':5.5}],NOW)
 def test_close_only_series_does_not_invent_ohlc(self):
  start=dt.date(2026,5,1);rows=[{'date':(start+dt.timedelta(days=i)).isoformat(),'close':100+i*.01,'close_only':True} for i in range(170)]
  clean,issues=validate_history(rows,NOW);self.assertTrue(issues);self.assertNotIn('high',clean[-1]);self.assertNotIn('volume',clean[-1])
  with self.assertRaises(DataInvalid):validate_history([{**r,'high':r['close']} for r in rows],NOW)
  with self.assertRaises(DataInvalid):validate_history([*rows,{'date':'2026-10-20','close':100,'open':100,'high':100,'low':100}],NOW)
 def test_exchange_close_minute_and_dst(self):
  rows=[{'date':'2026-10-21'}];self.assertTrue(mark_partial(rows,'jpN225','2026-10-21T06:10:00+00:00')[0]['partial'])
  self.assertFalse(mark_partial(rows,'jpN225','2026-10-21T06:40:00+00:00')[0]['partial'])
  self.assertTrue(session_key('deDAX','2026-10-21T15:00:00+00:00').endswith('-open'))
  self.assertTrue(session_key('deDAX','2026-12-21T16:40:00+00:00').endswith('-closed'))
  self.assertTrue(mark_partial([{'date':'2026-10-20'}],'goldUS','2026-10-21T02:00:00+00:00')[0]['partial'])
if __name__=='__main__':unittest.main()
