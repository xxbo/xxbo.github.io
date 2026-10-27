import unittest
from unittest.mock import patch
from leisure_sources import SOURCES,chinese_articles
from update_data import publisher_feed,news_candidates
from data_health import validate_news,DataInvalid

class LeisureTests(unittest.TestCase):
    def test_registry_is_diverse_and_chinese_only(self):
        self.assertGreaterEqual(len(SOURCES),12)
        self.assertGreaterEqual(len({r[3] for r in SOURCES}),8)
        self.assertFalse(any('dpreview' in r[2] for r in SOURCES))
        self.assertEqual(len({r[0] for r in SOURCES}),len(SOURCES))
        rows=chinese_articles([{'title':'English news only'},{'title':'你不知道的城市故事'},{'title':'繁體中文文章也保留'}])
        self.assertEqual(len(rows),2)
        self.assertTrue(all(r['language']=='zh' for r in rows))
        with self.assertRaises(ValueError):chinese_articles([{'title':'Only English'}])
        self.assertNotIn('leisure:dpreview',news_candidates())

    def test_atom_full_xhtml_images_dates_and_source_name_survive(self):
        payload='''<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>中文见闻</title><link rel="alternate" href="https://example.com/article"/><updated>2026-10-23T00:06:16Z</updated><content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>第一段</p><img src="https://example.com/picture.jpg"/><p>第二段</p></div></content></entry></feed>'''
        with patch('update_data.request',return_value=payload.encode()):row=publisher_feed('https://example.com/feed','自定义来源',10,'见闻',True)[0]
        self.assertEqual(row['source'],'自定义来源')
        self.assertEqual(row['reader_text'],'第一段\n\n第二段')
        self.assertEqual(row['published_at'],'2026-10-23T00:06:16+00:00')
        self.assertEqual(row['images'][0]['url'],'https://example.com/picture.jpg')
        self.assertEqual(row['images'][0]['after_paragraph'],1)
        self.assertTrue(row['leisure'])

    def test_untitled_chinese_note_uses_its_own_text_as_heading(self):
        payload='<rss><channel><item><title></title><link>https://example.com/note</link><description>&lt;p&gt;这是一则中文文化随笔。&lt;/p&gt;</description></item></channel></rss>'
        with patch('update_data.request',return_value=payload.encode()):row=publisher_feed('https://example.com/feed','来源',10,'文化',True)[0]
        self.assertEqual(row['title'],'这是一则中文文化随笔。')
        self.assertEqual(row['reader_text'],'这是一则中文文化随笔。')

    def test_long_form_window_does_not_change_actual_dates_or_news_window(self):
        row={'id':'story','title':'中文长篇故事','url':'https://example.com/story','published_at':'2026-10-06T00:00:00+00:00'}
        rows,_=validate_news([row],'2026-10-27T00:00:00+00:00',30)
        self.assertEqual(rows[0]['published_at'],row['published_at'])
        with self.assertRaises(DataInvalid):validate_news([row],'2026-10-27T00:00:00+00:00')

    def test_empty_link_and_non_chinese_entries_are_not_published(self):
        payload='''<rss><channel><item><title>中文但没有链接</title></item><item><title>English title</title><link>https://example.com/en</link></item><item><title>有用的中文文章</title><link>https://example.com/zh</link><pubDate>Tue, 27 Oct 2026 04:00:00 GMT</pubDate><description>内容</description></item></channel></rss>'''
        with patch('update_data.request',return_value=payload.encode()):rows=publisher_feed('https://example.com/feed','来源',10,'生活',True)
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['url'],'https://example.com/zh')
