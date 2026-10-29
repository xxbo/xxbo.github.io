"""5EPLAY's public news list and visible article body, without login or browser scripts."""
import concurrent.futures
import datetime as dt
import hashlib
import json
import urllib.parse
from html.parser import HTMLParser
from feed_images import feed_images
from leisure_sources import chinese_articles

API_URL='https://csgo.5eplay.com/api/article?page=1&type_id=0&time=0&order_by=0'

class ArticleBody(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.depth=0;self.done=False;self.parts=[]
    def handle_starttag(self,tag,attrs):
        if self.done:return
        if tag=='div':
            if not self.depth and 'article-text' in dict(attrs).get('class','').split():self.depth=1;return
            if self.depth:self.depth+=1
        if self.depth:self.parts.append(self.get_starttag_text())
    def handle_endtag(self,tag):
        if not self.depth:return
        if tag=='div':
            self.depth-=1
            if not self.depth:self.done=True;return
        self.parts.append('</'+tag+'>')
    def handle_startendtag(self,tag,attrs):
        if self.depth:self.parts.append(self.get_starttag_text())
    def handle_data(self,data):
        if self.depth:self.parts.append(data)
    def handle_entityref(self,name):
        if self.depth:self.parts.append('&'+name+';')
    def handle_charref(self,name):
        if self.depth:self.parts.append('&#'+name+';')


def five_eplay(request,reader_fields,now,limit=12):
    payload=json.loads(request(API_URL));items=(payload.get('data') or {}).get('list') or []
    def article(item):
        try:
            link=item.get('jump_link','');u=urllib.parse.urlsplit(link)
            if u.scheme!='https' or u.hostname!='csgo.5eplay.com' or not u.path.startswith('/article/') or u.username or u.password:return None
            title=str(item.get('title') or '').strip()
            stamp=dt.datetime.fromtimestamp(int(item['dateline']),dt.timezone.utc).isoformat()
            body=ArticleBody();body.feed(request(link).decode('utf-8',errors='replace'))
            if not body.done:return None
            raw=''.join(body.parts);fields=reader_fields(raw,'')
            if not title or len(fields['reader_text'])<60:return None
            return {'id':'5eplay:'+hashlib.sha256(link.encode()).hexdigest()[:20], 'title':title,'url':link,'source':'5EPLAY','category':'电竞','leisure':True,'kind':'headline','published_at':stamp,'fetched_at':now,'selection':'轻松阅读 · 电竞资讯',**fields,'reader_kind':'publisher','reader_scope':'full',**feed_images(None,raw,link)}
        except (ValueError,KeyError,TypeError,OSError):return None
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:rows=[r for r in pool.map(article,items[:limit]) if r]
    if not rows:raise ValueError('5EPLAY 未返回可读取的公开文章正文')
    return chinese_articles(rows)
