import copy
import unittest
from event_digest import build_events, similar, same_event, canonical_url

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
        self.assertFalse(similar('央行宣布政策利率调整至1.5%以维护流动性稳定', '央行宣布政策利率调整至15%以维护流动性稳定'))
        self.assertFalse(similar('机构上调某公司股票目标价至100元并维持评级', '机构下调某公司股票目标价至100元并维持评级'))
        self.assertFalse(similar('苹果新款手机正式发布', '苹果新款电脑正式发布'))

    def test_migration_archive_expiry_and_no_mutation(self):
        previous = {'news':[article()], 'generated_at':T0}
        original = copy.deepcopy(previous)
        events = build_events([article()], previous, T1)
        self.assertEqual(events[0]['first_seen'], T0)
        self.assertEqual(previous, original)
        carried = build_events([], {'events':events}, T2)
        self.assertFalse(carried[0]['active'])
        self.assertEqual(build_events([], {'events':events}, '2026-11-20T08:00:00+00:00'), [])

    def test_reconcile_old_clusters_preserves_identity_and_observation_times(self):
        a, b = article(), article('b', '央行宣布下调存款准备金率，释放长期流动性')
        one, two = build_events([a],{},T0), build_events([b],{},T1)
        original = copy.deepcopy(one+two)
        merged = build_events([article(),article('b',b['title'])],{'events':one+two},T2)
        self.assertEqual(len(merged),1)
        self.assertEqual(merged[0]['id'],one[0]['id'])
        self.assertIn(two[0]['id'],merged[0]['aliases'])
        self.assertEqual(merged[0]['first_seen'],T0)
        self.assertEqual(merged[0]['last_activity'],T1)
        self.assertEqual(len(merged[0]['changes']),2)
        self.assertEqual(one+two,original)
        again=build_events([article(),article('b',b['title'])],{'events':merged},T2)
        self.assertEqual(again,merged)

    def test_suffix_reprint_url_and_recurring_bulletins(self):
        self.assertTrue(similar('财政部：国库现金定存中标利率1个月期1.44% 3个月期1.50%', '财政部：国库现金定存中标利率1个月期1.44% 3个月期1.50%_公司新闻_财经'))
        a=article(title='1 分钟售罄、发货排到明年，iPhone Duo 卖爆背后的真相')
        b=article('b',a['title']);b['published_at']='2026-10-16T08:00:00Z'
        self.assertTrue(same_event(a,b))
        b=article('b','欧洲半导体股下跌1-3%');a=article('a',b['title']);b['published_at']='2026-10-20T08:00:00Z'
        self.assertFalse(same_event(a,b))
        a=article(title='央行宣布政策利率调整至1.5%以维护流动性稳定')
        self.assertFalse(same_event(a,article('b','央行宣布政策利率调整至15%以维护流动性稳定')))
        self.assertEqual(canonical_url('https://EXAMPLE.com/a?utm_source=x&id=7#top'),'https://example.com/a?id=7')
        self.assertNotEqual(canonical_url('https://example.com/a?id=7'),canonical_url('https://example.com/a?id=8'))

if __name__ == '__main__':
    unittest.main()
