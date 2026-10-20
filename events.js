'use strict';
// Event identity and report deduplication; source statements are never promoted to verified facts.
const EventTrack=(()=>{
 const title=s=>(s||'').normalize('NFKC').toLowerCase().replace(/_(?:公司新闻|财经新闻|新闻中心|财经)(?:_[^_]{1,12})*$/,'').replace(/[^\p{L}\p{N}.%+\-]/gu,'');
 function resolve(events,id){return events.find(e=>e.id===id||e.aliases?.includes(id));}
 function groups(event){const groups=[];for(const a of event.articles||[]){const g=groups.find(g=>g.some(b=>(a.url&&a.url===b.url)||title(a.title)===title(b.title)));if(g)g.push(a);else groups.push([a]);}return groups;}
 function unread(event,seen){const dates=[event.id,...(event.aliases||[])].map(id=>Date.parse(seen[id])||0);return (Date.parse(event.last_activity)||0)>Math.max(...dates);}
 function allocate(data,topics,entries,limit=2){
  const pool=topics.map(t=>({topic:t,rows:entries(data,t),picked:[]})),used=new Set();
  // Give each topic a turn before filling its second slot; a story appears once on the home page.
  for(let round=0;round<limit;round++)for(const item of pool){const next=item.rows.find(x=>!used.has(x.event.id));if(next){item.picked.push(next);used.add(next.event.id);}}
  return pool;
 }
 return {title,resolve,groups,unread,allocate};
})();
if(typeof module!=='undefined')module.exports=EventTrack;
