import unittest
import xml.etree.ElementTree as ET
from unittest.mock import patch
from feed_images import feed_images, image_url
from update_data import publisher_feed, rss_rows
from event_digest import compact, fingerprint


class FeedImagesTests(unittest.TestCase):
    def test_media_enclosure_and_body_deduplicate_in_priority_order(self):
        item = ET.fromstring('''<item xmlns:media="http://search.yahoo.com/mrss/">
          <media:content url="https://cdn.example.com/cover.jpg" type="image/jpeg"><media:credit>摄影师</media:credit><media:description>新闻现场</media:description></media:content>
          <enclosure url="https://cdn.example.com/second.jpg" type="image/jpeg"/>
          <enclosure url="https://cdn.example.com/audio.mp3" type="audio/mpeg"/>
          <media:thumbnail url="https://cdn.example.com/tiny.jpg" width="1" height="1"/>
        </item>''')
        data = feed_images(item, '<img src="https://cdn.example.com/cover.jpg"><img data-src="/third.jpg" src="data:image/gif;base64,x" alt="第三张">', 'https://example.com/news/1')
        self.assertEqual(len(data['images']), 3)
        self.assertEqual(data['image_url'], 'https://cdn.example.com/cover.jpg')
        self.assertEqual(data['images'][0]['credit'], '摄影师')
        self.assertEqual(data['images'][2], {'url': 'https://example.com/third.jpg', 'alt': '第三张', 'after_paragraph': 0})

    def test_rejects_inert_protocols_tracking_private_and_duplicates(self):
        for value in ('javascript:alert(1)', 'data:image/png,x', 'https://user:password@example.com/a.jpg', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://localhost/a', 'https://cdn.example.com/pixel.gif'):
            self.assertEqual(image_url(value), '', value)
        raw = '<script><img src="https://example.com/bad.jpg"></script><img src="https://example.com/small.jpg" width="1"><img src="https://example.com/a.jpg" onerror="evil()">'
        self.assertEqual(feed_images(None, raw)['images'], [{'url': 'https://example.com/a.jpg', 'after_paragraph': 0}])
        self.assertEqual(feed_images(None, '<p>文字</p>'), {})
        self.assertEqual(len(feed_images(None, ''.join(f'<img src="https://example.com/{i}.jpg">' for i in range(20)))['images']), 6)

    def test_existing_rss_and_atom_entry_points_preserve_images(self):
        rss = b'''<rss><channel><item><title>Test</title><link>https://example.com/a</link><description>&lt;p&gt;Text&lt;/p&gt;&lt;img src="/a.jpg"&gt;</description></item></channel></rss>'''
        with patch('update_data.request', return_value=rss):
            row = publisher_feed('https://example.com/feed', 'Publisher')[0]
        self.assertEqual(row['image_url'], 'https://example.com/a.jpg')
        self.assertEqual(row['reader_text'], 'Text')
        self.assertEqual(row['images'][0]['after_paragraph'], 1)
        self.assertEqual(rss_rows(rss, '全球')[0]['image_url'], row['image_url'])
        atom = '''<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom</title><link href="https://example.com/article"/><link rel="enclosure" type="image/jpeg" href="https://example.com/enclosure.jpg"/><content type="html">&lt;img src="/body.jpg"&gt;</content></entry></feed>'''
        images = rss_rows(atom, '科技')[0]['images']
        self.assertEqual([x['url'] for x in images], ['https://example.com/enclosure.jpg', 'https://example.com/body.jpg'])
        self.assertEqual(compact(row)['images'], row['images'])
        self.assertEqual(fingerprint(row), fingerprint({**row, 'images': []}), 'image enrichment must not invent a textual event revision')

if __name__ == '__main__':
    unittest.main()
