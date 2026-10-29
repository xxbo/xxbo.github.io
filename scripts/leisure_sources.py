"""Chinese-language source registry and deterministic topic labels."""
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
    ('4gamers','4Gamers','https://www.4gamers.com.tw/rss/latest-news','游戏','site:4gamers.com.tw 游戏 OR 電競 OR 動畫'),
    ('gamereactor','Gamereactor 中文版','https://www.gamereactor.cn/rss/rss.php','游戏','site:gamereactor.cn 游戏 OR 电竞'),
    ('cinephilia','迷影','https://cinephilia.net/feed','影视','site:cinephilia.net 电影'),
    ('agentm','电影神搜','https://news.agentm.tw/feed/','影视','site:news.agentm.tw 電影'),
    ('blow','吹音乐','https://blow.streetvoice.com/feed/','音乐','site:blow.streetvoice.com 音樂'),
    ('ysolife','乐手巢','https://ysolife.com/feed/','音乐','site:ysolife.com 音樂'),
    ('animesdata','动漫资料库','https://www.animesdata.com/news/rss','动漫','site:animesdata.com 动漫'),
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


ENTERTAINMENT = {'4gamers','gamereactor','cinephilia','agentm','blow','ysolife','animesdata'}
MIXED_GAME_MEDIA = {'4Gamers','Gamereactor 中文版','机核','游研社','触乐'}


def entertainment_category(row):
    default=row.get('category')
    if row.get('source') not in MIXED_GAME_MEDIA:return default
    title=row.get('title') or ''
    if re.search(r'iPhone|MacBook|iPad|RTX[ \d]|显卡|顯卡|显示器|顯示器|螢幕|笔记本|筆電|键盘|鍵盤|鼠标|滑鼠',title,re.I):return '数码'
    if re.search(r'电竞|電競|\b(?:LPL|LCK|LEC|LCS|VCT|PGL|ESL|IEM)\b|S(?:1[6-9]|2[0-9]).*(?:赛|賽)|全球[总總][决決][赛賽]|世界[赛賽]|[战戰][队隊]|[选選]手|Major.*(?:晋级|晉級|名额|名額|淘汰)',title,re.I) and not re.search(r'电竞[屏椅]|電競(?:螢幕|筆電)|电竞(?:显示器|鼠标|键盘|笔记本)',title):return '电竞'
    if re.search(r'动漫|動漫|动画|動畫|漫画|漫畫|番剧|番劇|声优|聲優|新番|剧场版|劇場版|VTuber|hololive',title,re.I):return '动漫'
    if re.search(r'专辑|專輯|演唱会|演唱會|歌手|樂團|乐队|樂隊|原声带|原聲帶|音樂祭|音乐节',title):return '音乐'
    if re.search(r'电影|電影|影评|影評|电视剧|電視劇|影集|剧集|劇集|票房|奧斯卡|奥斯卡',title) and not re.search(r'电影般|電影般|游戏|遊戲',title):return '影视'
    return default


def prepare_leisure(rows,slug):
    if slug in ENTERTAINMENT:
        rows=[r for r in rows if not re.search(r'R-?18|18禁|成人[游遊][戏戲]|紳士(?:RPG|戀愛)|三人行瑟瑟',r.get('title',''),re.I)]
    for row in rows:
        row['category']=entertainment_category(row)
        if slug in {'cinephilia','agentm','animesdata'}:row['reader_scope']='excerpt'
    if slug in ENTERTAINMENT:
        # Give each available topic a turn before this source fills the remaining slots.
        pool=list(rows);topics=list(dict.fromkeys(r['category'] for r in pool));picked=[]
        while pool and len(picked)<30:
            for topic in topics:
                index=next((i for i,r in enumerate(pool) if r['category']==topic),None)
                if index is not None:picked.append(pool.pop(index))
                if len(picked)==30:break
        return picked
    return rows
