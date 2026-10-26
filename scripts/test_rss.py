import unittest
from update_data import reader_fields, publisher_feed
from unittest.mock import patch

class RSSReaderTests(unittest.TestCase):
    def test_html_is_inert_and_paragraphs_survive(self):
        data = reader_fields('<p>市场 &amp; 行情</p><script>alert(1)</script><style>bad</style><p>第二段<img src=x onerror=bad></p>', 'https://example.com/rss')
        self.assertEqual(data['reader_text'], '市场 & 行情\n\n第二段')
        self.assertFalse(data['reader_truncated'])
    def test_publisher_http_links_are_upgraded(self):
        payload = b'<rss><channel><item><title>Test</title><link>http://www.geekpark.net/news/1</link><description>&lt;p&gt;Content&lt;/p&gt;</description></item></channel></rss>'
        with patch('update_data.request', return_value=payload):
            row = publisher_feed('https://www.geekpark.net/rss', 'GeekPark')[0]
        self.assertEqual(row['url'], 'https://www.geekpark.net/news/1')
        self.assertEqual(row['reader_text'], 'Content')

    def test_full_text_is_preserved(self):
        data = reader_fields('<p>'+'字'*15000+'</p>', 'https://example.com/rss')
        self.assertEqual(len(data['reader_text']), 15000)
        self.assertFalse(data['reader_truncated'])
        self.assertEqual(len(data['summary']), 180)

if __name__ == '__main__':
    unittest.main()
