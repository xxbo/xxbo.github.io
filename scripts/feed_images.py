"""Extract publisher-supplied feed images; never crawl article pages or fetch images."""
import html
import ipaddress
import re
import urllib.parse
from html.parser import HTMLParser

MAX_IMAGES = 6
MEDIA = 'http://search.yahoo.com/mrss/'
ATOM = 'http://www.w3.org/2005/Atom'


def image_url(value, base=''):
    value = html.unescape(str(value or '')).strip()
    if not value or len(value) > 4096:
        return ''
    try:
        url = urllib.parse.urlsplit(urllib.parse.urljoin(base, value))
        if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password:
            return ''
        host = url.hostname.lower()
        if host == 'localhost' or host.endswith(('.localhost', '.local')):
            return ''
        try:
            if not ipaddress.ip_address(host).is_global:
                return ''
        except ValueError:
            pass
        if re.search(r'(?:^|[/_.-])(?:pixel|spacer|tracking|beacon|favicon|logo)(?:[/_.-]|$)', url.path, re.I):
            return ''
        # Avoid mixed content on the HTTPS site. Unsupported HTTPS images fail closed in the UI.
        return urllib.parse.urlunsplit(('https', url.netloc, url.path, url.query, ''))
    except ValueError:
        return ''


def small(attrs):
    for key in ('width', 'height'):
        value = str(attrs.get(key) or '').strip().lower().removesuffix('px')
        try:
            if 0 <= float(value) <= 32:
                return True
        except ValueError:
            pass
    return False


class Images(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows, self.skip, self.parts = [], 0, []

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'iframe', 'object'):
            self.skip += 1
        if not self.skip and tag in ('p', 'div', 'br', 'li', 'h1', 'h2', 'h3', 'blockquote', 'tr'):
            self.parts.append('\n')
        attrs = dict(attrs)
        if not self.skip and tag == 'img' and not small(attrs):
            # Prefer lazy-loaded originals over placeholder src values.
            src = attrs.get('data-src') or attrs.get('data-original') or attrs.get('src')
            if src:
                self.rows.append({'url': src, 'alt': attrs.get('alt', ''), 'after_paragraph': sum(bool(line.strip()) for line in ''.join(self.parts).split('\n'))})

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'iframe', 'object'):
            self.skip = max(0, self.skip - 1)
        elif not self.skip and tag in ('p', 'div', 'li', 'h1', 'h2', 'h3', 'blockquote', 'tr'):
            self.parts.append('\n')

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def feed_images(item, raw='', base=''):
    candidates = []
    if item is not None:
        for node in item.iter():
            if node.tag in (f'{{{MEDIA}}}content', f'{{{MEDIA}}}thumbnail'):
                mime = node.get('type', '')
                if small(node.attrib) or (mime and not mime.startswith('image/')) or node.get('medium', 'image') != 'image':
                    continue
                candidates.append({'url': node.get('url'),
                                   'alt': node.findtext(f'{{{MEDIA}}}title') or '',
                                   'caption': node.findtext(f'{{{MEDIA}}}description') or '',
                                   'credit': node.findtext(f'{{{MEDIA}}}credit') or ''})
            elif (node.tag == 'enclosure' or (node.tag == f'{{{ATOM}}}link' and node.get('rel') == 'enclosure')) and node.get('type', '').startswith('image/'):
                candidates.append({'url': node.get('url') or node.get('href')})
    parser = Images()
    parser.feed(raw or '')
    candidates.extend(parser.rows)
    # Some feeds put their only image in description while encoded contains text.
    if item is not None:
        description = item.findtext('description') or ''
        if description and description != raw:
            extra = Images(); extra.feed(description); candidates.extend(extra.rows)
    result, seen = [], {}
    for row in candidates:
        url = image_url(row.get('url'), base)
        if not url:
            continue
        if url in seen:
            if 'after_paragraph' in row:
                seen[url].setdefault('after_paragraph', row['after_paragraph'])
            continue
        if len(result) == MAX_IMAGES:
            continue
        clean = {'url': url}
        if 'after_paragraph' in row:
            clean['after_paragraph'] = row['after_paragraph']
        seen[url] = clean
        for key in ('alt', 'caption', 'credit'):
            text = re.sub(r'\s+', ' ', html.unescape(re.sub('<[^>]*>', '', row.get(key) or ''))).strip()
            if text:
                clean[key] = text[:500]
        result.append(clean)
    return {'image_url': result[0]['url'], 'images': result} if result else {}
