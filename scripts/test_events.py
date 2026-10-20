import copy
import unittest
from event_digest import build_events, similar

T0 = '2026-10-19T08:00:00+00:00'
T1 = '2026-10-19T08:20:00+00:00'
T2 = '2026-10-19T08:40:00+00:00'

def article(id='a', title='央行宣布下调存款准备金率释放长期流动性', **kw):
    return dict(id=id, title=title, category='金融', url='https://example.com/'+id,
                summary='来源摘要', source='媒体甲', published_at=T0, **kw)

class EventTests(unittest.TestCase):
    def test_repeat_fetch_does_not_create_progress(self):
        a = article()
        first = build_events([a], {}, T0)
        b = article(); b['fetched_at'] = T1
        second = build_events([b], {'events': first}, T1)
        self.assertEqual(second[0]['last_activity'], T0)
        self.assertEqual(len(second[0]['changes']), 1)
        self.assertEqual(b['first_seen'], T0)

    def test_same_story_sources_merge_but_topic_alone_does_not(self):
        rows = [article(), article('b', '央行宣布下调存款准备金率，释放长期流动性', source_unused=True),
                article('c', '央行今日开展公开市场逆回购操作维护流动性稳定')]
        rows[1]['source']='媒体乙'
        events = build_events(rows, {}, T0)
        self.assertEqual(len(events), 2)
        merged = next(e for e in events if len(e['articles'])==2)
        self.assertEqual(len(merged['sources']), 2)

    def test_content_revision_and_new_report_distinguished(self):
        first = build_events([article()], {}, T0)
        changed = article(); changed['summary'] = '来源修订摘要'
        second = build_events([changed], {'events': first}, T1)
        self.assertEqual(second[0]['changes'][-1]['type'], 'content_updated')
        self.assertEqual(second[0]['changes'][-1]['at'], T1)
        self.assertEqual(changed['first_seen'], T0)
        third = build_events([article('b')], {'events': second}, T2)
        self.assertEqual(third[0]['changes'][-1]['type'], 'report_added')

    def test_no_transitive_topic_chain_or_different_numbers(self):
        self.assertFalse(similar('央行今日宣布下调政策利率25基点以支持经济增长', '央行今日宣布下调政策利率50基点以支持经济增长'))
        self.assertFalse(similar('苹果新款手机正式发布', '苹果新款电脑正式发布'))

    def test_migration_archive_expiry_and_no_mutation(self):
        previous = {'news':[article()], 'generated_at':T0}
        original = copy.deepcopy(previous)
        events = build_events([article()], previous, T1)
        self.assertEqual(events[0]['first_seen'], T0)
        self.assertEqual(previous, original)
        carried = build_events([], {'events':events}, T2)
        self.assertFalse(carried[0]['active'])
        self.assertEqual(build_events([], {'events':events}, '2026-10-28T08:00:00+00:00'), [])

if __name__ == '__main__':
    unittest.main()
