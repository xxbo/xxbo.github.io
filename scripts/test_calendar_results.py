import datetime as dt
import json
import unittest
from urllib.parse import parse_qs, urlsplit
from calendar_results import collect_results, parse_results, value
from data_health import DataInvalid, run_chain, validate_calendar

NOW = '2026-10-21T04:00:00+00:00'


def record(**changes):
    row = {'id': 'release-1', 'name': 'CPI:当月同比', 'country': '中国',
           'indicatorId': 'cpi-yoy', 'showTime': '2026-10-20 09:30:00',
           'publishedValue': '0', 'predictiveValue': '0.2', 'previousValue': '-0.1', 'unit': '%'}
    row.update(changes)
    return row


def payload(rows, **changes):
    body = {'total': len(rows), 'economicEventList': rows, 'importantEventList': []}
    body.update(changes)
    return json.dumps({'success': 1, 'data': body})


class ResultTests(unittest.TestCase):
    def test_zero_and_negative_values_and_unit_are_preserved(self):
        row = parse_results(payload([record()]), NOW)[0]
        self.assertEqual(row['actual'], '0')
        self.assertEqual(row['previous'], '-0.1')
        self.assertEqual(row['forecast'], '0.2')
        self.assertEqual(row['unit'], '%')
        self.assertEqual(row['source_timezone'], 'Asia/Shanghai')
        self.assertEqual(row['scheduled_at'], '2026-10-20T09:30:00+08:00')
        self.assertEqual(row['record_type'], 'indicator')
        self.assertIsNone(row['reference_period'])

    def test_unknown_time_and_absent_values_are_not_invented(self):
        row = parse_results(payload([record(showTime='2026-10-22 23:59:59', publishedValue=None, predictiveValue='--')]), NOW)[0]
        self.assertTrue(row['date_only'])
        self.assertEqual(row['time'], '')
        self.assertIsNone(row['scheduled_at'])
        self.assertIsNone(row['actual'])
        self.assertIsNone(row['forecast'])
        self.assertEqual(validate_calendar([row], NOW)[0][0]['id'], row['id'])

    def test_future_actuals_and_truncated_results_are_rejected(self):
        with self.assertRaises(DataInvalid):
            parse_results(payload([record(showTime='2026-10-22 20:30:00')]), NOW)
        with self.assertRaises(DataInvalid):
            parse_results(payload([record()], total=3), NOW)
        with self.assertRaises(DataInvalid):
            parse_results('{"success":1,"data":null}', NOW)
        with self.assertRaises(DataInvalid):
            parse_results(payload([record(showTime='not-a-date')]), NOW)

    def test_recent_history_is_kept_but_expired_records_are_removed(self):
        rows = parse_results(payload([record(), record(id='old', showTime='2026-08-20 09:30:00')]), NOW)
        cleaned, _ = validate_calendar(rows, NOW)
        self.assertEqual(len(cleaned), 1)

    def test_revision_history_and_failover_cache_keep_value_timestamp(self):
        def request(url):
            query = parse_qs(urlsplit(url).query)
            return payload([record()] if query['startDate'][0] <= '2026-10-20' <= query['endDate'][0] else [])
        rows = collect_results(request, NOW)
        self.assertEqual(rows[0]['actual_first_seen_at'], NOW)
        later = '2026-10-21T05:00:00+00:00'
        def revised(url):
            return request(url).replace('"publishedValue": "0"', '"publishedValue": "0.1"')
        fresh = collect_results(revised, later, rows)
        self.assertEqual(fresh[0]['actual_first_seen_at'], NOW)
        self.assertEqual(fresh[0]['value_revisions'], [{'at': later, 'from': '0', 'to': '0.1'}])
        def fail():
            raise TimeoutError('offline')
        cached, status = run_chain('calendar:results', [('results', fail)], fresh, {}, later, lambda r: validate_calendar(r, later))
        self.assertEqual(status['mode'], 'cache')
        self.assertEqual(cached[0]['actual'], '0.1')
        self.assertEqual(cached[0]['values_checked_at'], later)
        self.assertEqual(cached[0]['data_state'], 'cached')

    def test_infinite_values_are_rejected(self):
        for raw in ['1e999', 'Infinity', '-inf']:
            with self.assertRaises(DataInvalid):
                value(raw)


if __name__ == '__main__':
    unittest.main()
