import json
import unittest
from update_data import feed_publication,reader_fields,news_candidates
from leisure_sources import SOURCES,entertainment_category,prepare_leisure
from entertainment_sources import five_eplay,API_URL

class EntertainmentTests(unittest.TestCase):
    def test_localized_rss_date_keeps_explicit_clock_and_zone(self):
        self.assertEqual(feed_publication('週日, 18 10 月 2026 14:24:24 +0800'),'2026-10-18T14:24:24+08:00')
        self.assertIsNone(feed_publication('週日, 31 2 月 2026 14:24:24 +0800'))
        self.assertIsNone(feed_publication('2026年10月18日'))

    def test_all_five_topics_have_registered_sources(self):
        names={s[0] for s in SOURCES}
        self.assertTrue({'4gamers','gamereactor','cinephilia','agentm','blow','ysolife','animesdata'}<=names)
        self.assertIn('leisure:5eplay',news_candidates())
        self.assertEqual(entertainment_category({'source':'4Gamers','category':'游戏','title':'S16全球总决赛战队晋级'}),'电竞')
        self.assertEqual(entertainment_category({'source':'4Gamers','category':'游戏','title':'电竞螢幕新品發表'}),'数码')
        self.assertEqual(entertainment_category({'source':'4Gamers','category':'游戏','title':'全新动画剧场版预告公开'}),'动漫')
        self.assertEqual(entertainment_category({'source':'机核','category':'游戏','title':'电影票房创新纪录'}),'影视')
        self.assertEqual(entertainment_category({'source':'4Gamers','category':'游戏','title':'功夫电影般的武侠游戏体验'}),'游戏')
        self.assertEqual(entertainment_category({'source':'吹音乐','category':'音乐','title':'音乐世界冠军访谈'}),'音乐')
        rows=prepare_leisure([{'title':'Steam紳士戀愛新作','source':'4Gamers','category':'游戏'},{'title':'英雄联盟世界赛战队晋级','source':'4Gamers','category':'游戏'}],'4gamers')
        self.assertEqual(len(rows),1)

    def test_public_esports_body_is_scoped_and_complete(self):
        link='https://csgo.5eplay.com/article/test-news'
        payload={'data':{'list':[{'title':'电竞世界赛选手专访','jump_link':link,'dateline':'1793233331'},{'title':'外部链接','jump_link':'https://example.com/article/outside','dateline':'1793233331'}]}}
        body='<html><p>站外导航</p><div class="article-text"><p>'+('比赛内容。'*30)+'</p><div><p>第二段<img src="https://oss.5eplay.com/a.jpg"/></p></div><script>bad()</script></div><p>评论与推荐不应混入正文</p></html>'
        calls=[]
        def request(url):
            calls.append(url)
            return json.dumps(payload).encode() if url==API_URL else body.encode()
        rows=five_eplay(request,reader_fields,'2026-10-29T07:00:00+00:00')
        self.assertEqual(len(rows),1)
        row=rows[0]
        self.assertEqual(row['reader_kind'],'publisher')
        self.assertEqual(row['category'],'电竞')
        self.assertNotIn('站外导航',row['reader_text'])
        self.assertNotIn('bad()',row['reader_text'])
        self.assertNotIn('评论与推荐',row['reader_text'])
        self.assertIn('第二段',row['reader_text'])
        self.assertEqual(len(row['images']),1)
        self.assertEqual(calls,[API_URL,link])
