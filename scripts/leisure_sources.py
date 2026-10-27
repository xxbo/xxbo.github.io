"""Chinese-language reading sources; no translation or article-page crawling."""
import re

SOURCES = [
    ('sspai','少数派','https://sspai.com/feed','数码','site:sspai.com 数码 OR 应用'),
    ('gcores','机核','https://www.gcores.com/rss','游戏','site:gcores.com 游戏'),
    ('solidot','奇客 Solidot','https://www.solidot.org/index.rss','科学','site:solidot.org 科学'),
    ('pansci','泛科学','https://pansci.asia/feed','科学','site:pansci.asia 科普'),
    ('sinica','研之有物','https://research.sinica.edu.tw/feed/','人文','site:research.sinica.edu.tw 研究'),
    ('ruanyifeng','阮一峰的网络日志','https://www.ruanyifeng.com/blog/atom.xml','见闻','site:ruanyifeng.com 科技爱好者周刊'),
    ('appinn','小众软件','https://www.appinn.com/feed/','工具','site:appinn.com 软件'),
    ('toodaylab','理想生活实验室','https://www.toodaylab.com/feed','生活','site:toodaylab.com 生活'),
    ('yystv','游研社','https://www.yystv.cn/rss/feed','游戏','site:yystv.cn 游戏'),
    ('bookfere','书伴','https://bookfere.com/feed','阅读','site:bookfere.com 阅读'),
    ('yitianshijie','一天世界','https://blog.yitianshijie.net/feed/','文化','site:blog.yitianshijie.net 文化'),
    ('chuapp','触乐','https://www.chuapp.com/feed','故事','site:chuapp.com 故事'),
]


def chinese_articles(rows):
    result=[]
    for row in rows:
        title=str(row.get('title') or '')
        han=len(re.findall(r'[\u3400-\u9fff]',title))
        latin=len(re.findall('[A-Za-z]',title))
        if han>=2 and han>=latin*.2:
            result.append({**row,'language':'zh'})
    if not result:raise ValueError('来源未返回中文标题，不以英文内容补位')
    return result
