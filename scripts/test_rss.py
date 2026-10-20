import unittest
from update_data import reader_fields

class RSSReaderTests(unittest.TestCase):
    def test_html_is_inert_and_paragraphs_survive(self):
        data = reader_fields('<p>市场 &amp; 行情</p><script>alert(1)</script><style>bad</style><p>第二段<img src=x onerror=bad></p>', 'https://example.com/rss')
        self.assertEqual(data['reader_text'], '市场 & 行情\n\n第二段')
        self.assertFalse(data['reader_truncated'])
    def test_length_is_bounded_and_disclosed(self):
        data = reader_fields('<p>'+'字'*15000+'</p>', 'https://example.com/rss')
        self.assertEqual(len(data['reader_text']), 14000)
        self.assertTrue(data['reader_truncated'])
        self.assertEqual(len(data['summary']), 180)

if __name__ == '__main__':
    unittest.main()
