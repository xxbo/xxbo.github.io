'use strict';
// One event per story. Source timestamps stay separate from calendar plans and quotes.
const HomeFeed=(()=>{
 const time=v=>Number.isFinite(Date.parse(v||''))?Date.parse(v):0;
 const title=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
 function url(value){try{const u=new URL(value);u.hash='';for(const k of [...u.searchParams.keys()])if(/^(utm_|spm|from$|source$|fbclid$)/i.test(k))u.searchParams.delete(k);return u.href;}catch{return '';}}
 const chinese=n=>{const t=String(n.title||''),han=(t.match(/[\p{Script=Han}]/gu)||[]).length,latin=(t.match(/[A-Za-z]/g)||[]).length;return han>=2&&han>=latin*.2;};
 const hasValue=v=>v!==null&&v!==undefined&&String(v).trim()!=='';
 function stories(data,now=Date.now()){
  const news=new Map((data.news||[]).filter(n=>!n.leisure).map(n=>[n.id,n])),pool=[],linked=new Set();
  const recent=n=>n?.title&&time(n.published_at)>now-7*86400000&&time(n.published_at)<=now+5*60000;
  for(const event of data.events||[]){
   if(event.active===false)continue;
   const reports=(event.articles||[]).map(n=>news.get(n.id)||n).filter(n=>!n.leisure&&recent(n));
   const articles=reports.filter(n=>n.kind==='headline'||n.featured).sort((a,b)=>time(b.published_at)-time(a.published_at));
   if(!articles.length)continue;
   const article=articles[0],groups=new Set(reports.map(n=>title(n.title))),multiple=groups.size>1||(event.changes||[]).some(c=>c.type==='content_updated');
   reports.forEach(n=>linked.add(n.id));
   pool.push({key:'story:'+event.id,type:multiple?'event':'news',article,event,at:article.published_at});
  }
  for(const n of news.values())if(!linked.has(n.id)&&recent(n)&&(n.kind==='headline'||n.featured))pool.push({key:'news:'+n.id,type:'news',article:n,at:n.published_at});
  // A few recent wire items supplement reported stories without filling the feed with alerts.
  for(const n of [...news.values()].filter(n=>n.kind==='flash'&&recent(n)&&time(n.published_at)>now-12*3600000).sort((a,b)=>time(b.published_at)-time(a.published_at)).slice(0,2))pool.push({key:'news:'+n.id,type:'news',article:n,at:n.published_at});
  pool.sort((a,b)=>time(b.at)-time(a.at)||a.key.localeCompare(b.key));
  const ids=new Set(),titles=new Set(),urls=new Set();
  const unique=pool.filter(item=>{const n=item.article,t=title(n.title),u=url(n.url);if(ids.has(n.id)||titles.has(t)||(u&&urls.has(u)))return false;ids.add(n.id);titles.add(t);if(u)urls.add(u);return true;});
  const reported=unique.filter(i=>i.article.kind!=='flash'),wires=unique.filter(i=>i.article.kind==='flash');
  if(!reported.length)return unique;
  wires.forEach((item,i)=>reported.splice(Math.min(2+i*5,reported.length),0,item));
  return reported;
 }
 function calendar(data,now=Date.now()){
  const important=/CPI|PPI|GDP|PMI|PCE|非农|失业|就业|利率|议息|消费|零售|工业增加|央行|通胀|国内生产|国民经济|采购经理/i;
  const rows=(data.calendar||[]).filter(e=>e.title&&important.test(e.title));
  const score=e=>(['中国','美国'].includes(e.country)?4:0)+(e.forecast!==null&&e.forecast!==undefined?2:0)+(e.record_type==='indicator'?1:0);
  const released=rows.filter(e=>hasValue(e.actual)&&time(e.scheduled_at||e.date)>now-7*86400000&&time(e.scheduled_at||e.date)<=now).sort((a,b)=>(['中国','美国'].includes(b.country)?1:0)-(['中国','美国'].includes(a.country)?1:0)||time(b.scheduled_at||b.date)-time(a.scheduled_at||a.date)||score(b)-score(a));
  const future=rows.filter(e=>!hasValue(e.actual)&&(e.scheduled_at?time(e.scheduled_at)>=now:(e.end_date||e.source_date||e.date)>=new Date(now).toLocaleDateString('sv-SE',{timeZone:e.source_timezone||'America/New_York'}))).sort((a,b)=>time(a.scheduled_at||a.date)-time(b.scheduled_at||b.date)||score(b)-score(a));
  return {released:released.slice(0,2),future:future.slice(0,1)};
 }
 function compose(data,{now=Date.now(),watch=[]}={}){
  const news=stories(data,now),cal=calendar(data,now),markets=data.markets||[];
  const seen=new Set(news.flatMap(i=>[url(i.article.url),title(i.article.title)])),leisure=[];
  const pool=(data.news||[]).filter(n=>n.leisure&&chinese(n)&&time(n.published_at)>now-30*86400000&&time(n.published_at)<=now+5*60000).sort((a,b)=>time(b.published_at)-time(a.published_at)),sources=[...new Set(pool.map(n=>n.source))];
  while(pool.length){for(const source of sources){const index=pool.findIndex(n=>n.source===source);if(index<0)continue;const n=pool.splice(index,1)[0],u=url(n.url),t=title(n.title);if(seen.has(u)||seen.has(t))continue;seen.add(u);seen.add(t);leisure.push({key:'leisure:'+n.id,type:'leisure',article:n,at:n.published_at});}}
  const technical=watch.map(id=>markets.find(m=>m.id===id)).filter(m=>m&&m.asset_class!=='rates'&&m.history?.length>=35).slice(0,2);
  const items=[{key:'market:overview',type:'market',region:'selected'}];
  const inserts=[...cal.released.map(row=>({key:'calendar:'+row.id,type:'calendar',row})),...cal.future.map(row=>({key:'calendar:'+row.id,type:'calendar',row}))];
  news.slice(0,72).forEach((item,i)=>{
   items.push(item);
   if(i>=4&&(i-4)%6===0&&leisure.length)items.push(leisure.shift());
   if(i===1&&inserts[0])items.push(inserts[0]);
   if(i===3&&technical[0])items.push({key:'technical:'+technical[0].id,type:'technical',market:technical[0]});
   if(i===6&&inserts[1])items.push(inserts[1]);
   if(i===8)items.push({key:'market:world',type:'market',region:'world'});
   if(i===10&&inserts[2])items.push(inserts[2]);
   if(i===13&&technical[1])items.push({key:'technical:'+technical[1].id,type:'technical',market:technical[1]});
  });
  for(const item of [...inserts,...technical.map(m=>({key:'technical:'+m.id,type:'technical',market:m}))])if(!items.some(x=>x.key===item.key))items.push(item);
  items.push(...leisure);
  return items;
 }
 function select(items,filter){return items.filter(i=>filter==='all'||filter==='market'&&['market','technical'].includes(i.type)||i.type===filter);}
 return {stories,calendar,compose,select,title,url};
})();
if(typeof module!=='undefined')module.exports=HomeFeed;
