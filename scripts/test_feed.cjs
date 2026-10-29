const assert=require('node:assert/strict'),F=require('../feed.js');
const now=Date.parse('2026-10-26T04:00:00Z');
function article(id,title,date='2026-10-26T02:00:00Z',extra={}){return {id,title,published_at:date,kind:'headline',category:'科技',source:'source',url:'https://example.com/'+id,...extra};}
const a=article('a','芯片供应取得新进展'),b=article('b','芯片供应取得新进展'),c=article('c','后续：公司公布正式方案','2026-10-26T03:00:00Z');
const data={news:[a,b,c,article('stale','旧消息','2026-10-01T00:00:00Z'),article('future','未来的新闻','2099-01-01T00:00:00Z')],events:[{id:'event',active:true,articles:[a,b,c]}],markets:[],calendar:[]};
const stories=F.stories(data,now);assert.equal(stories.length,1);assert.equal(stories[0].type,'event');assert.equal(stories[0].article.id,'c');assert.equal(stories[0].at,c.published_at);
const syndicated=F.stories({news:[a,b],events:[{id:'e',articles:[a,b],active:true}]},now);assert.equal(syndicated.length,1);assert.equal(syndicated[0].type,'news','same title reposts stay a single news card');
const tracked=article('tracked','完全不同的标题',a.published_at,{url:'https://example.com/a?utm_source=feed'});
assert.equal(F.stories({news:[a,tracked]},now).length,1,'tracking parameters do not make a second story');
const many=Array.from({length:25},(_,i)=>article('n'+i,'不同的消息'+i,'2026-10-26T02:00:00Z'));
const release={id:'r',title:'美国 CPI',date:'2026-10-26',scheduled_at:'2026-10-26T09:30:00+08:00',country:'美国',record_type:'indicator',actual:'0',forecast:null};
const upcoming={id:'f',title:'美联储议息会议',date:'2026-10-27',end_date:'2026-10-28',source_date:'2026-10-27',source_timezone:'America/New_York',date_only:true,actual:null};
const items=F.compose({news:many,calendar:[release,upcoming],markets:[]},{now});assert.equal(items[0].type,'market');assert(items.some(i=>i.type==='calendar'&&i.row.actual==='0'));assert(items.some(i=>i.key==='market:world'));assert.equal(items.length,new Set(items.map(i=>i.key)).size);
assert(F.select(items,'news').every(i=>i.type==='news'));assert(F.select(items,'market').every(i=>['market','technical'].includes(i.type)));assert(F.select(items,'calendar').every(i=>i.type==='calendar'));
assert(F.calendar({calendar:[upcoming]},Date.parse('2026-10-29T02:00:00Z')).future.length,'date-only US meetings retain their final local day');
assert.equal(F.compose({news:[],events:[],markets:[],calendar:[]},{now}).length,1,'empty data retains one honest market placeholder');
console.log('Feed checks passed: event deduplication, source dates, zero releases, history bounds and single-item filters.');
const leisure=Array.from({length:9},(_,i)=>article('l'+i,'休闲内容'+i,'2026-10-26T03:00:00Z',{leisure:true,category:['数码','游戏','摄影'][i%3]}));
const mixed=F.compose({news:[...many,...leisure],markets:[],calendar:[]},{now});assert(!F.stories({news:leisure},now).length);assert(F.select(mixed,'leisure').length===9);assert.equal(new Set(F.select(mixed,'leisure').slice(0,3).map(i=>i.article.category)).size,3);assert(mixed.slice(0,18).filter(i=>i.type==='leisure').length<=3);assert(F.compose({news:leisure,markets:[]},{now}).some(i=>i.type==='leisure'));

const wide=Array.from({length:45},(_,i)=>article('wide'+i,'有趣的中文文章'+i,'2026-10-26T03:00:00Z',{leisure:true,source:'source'+(i%9),category:'生活'}));
const cnOnly=F.select(F.compose({news:[...wide,article('en','An English article','2026-10-26T03:00:00Z',{leisure:true,source:'DPReview'})]},{now}),'leisure');assert.equal(cnOnly.length,45,'all available Chinese leisure items are reachable beyond the old twelve-item cap');assert.equal(new Set(cnOnly.slice(0,9).map(i=>i.article.source)).size,9,'rotate sources even when they share a topic');assert(!cnOnly.some(i=>i.article.id==='en'));
const fiveTopics=['电竞','游戏','影视','音乐','动漫'];
const themed=F.compose({news:fiveTopics.map((category,i)=>article('topic'+i,'中文兴趣主题'+i,'2026-10-26T03:00:00Z',{leisure:true,source:'主题源'+i,category}))},{now});
for(const topic of fiveTopics){const rows=F.select(themed,'leisure',topic);assert.equal(rows.length,1);assert.equal(rows[0].article.category,topic);}assert.equal(F.select(themed,'leisure','other').length,0);assert.equal(F.select(themed,'leisure').length,5);
