'use strict';
// Local, bounded, explainable ranking. Opening an article is a weak signal, not proof of reading.
const Reading=(()=>{
 const time=v=>Number.isFinite(Date.parse(v))?Date.parse(v):0,chronological=(a,b)=>time(b.item.published_at)-time(a.item.published_at)||a.item.id.localeCompare(b.item.id);
 const DAY=864e5,decay=(at,now,half=14)=>Math.exp(-Math.LN2*Math.max(0,now-Date.parse(at))/DAY/half);
 const validAt=(at,now)=>Number.isFinite(Date.parse(at))&&Date.parse(at)<=now&&now-Date.parse(at)<=90*DAY;
 const categoryKeys=['科技','金融','全球','政治','数码','游戏','摄影','科学','人文','见闻','工具','生活','故事','设计','影视','阅读','社会','文化'];
 function clean(input,now=Date.now()){
  const p=input&&typeof input==='object'?input:{};
  return {version:1,learning:p.learning!==false,sort:p.sort==='time'?'time':'personal',
   reads:(Array.isArray(p.reads)?p.reads:[]).filter(r=>r&&typeof r.key==='string'&&validAt(r.at,now)).slice(-400).map(r=>({key:r.key.slice(0,180),at:r.at,category:String(r.category||'').slice(0,20),topics:Array.isArray(r.topics)?r.topics.filter(t=>typeof t==='string').slice(0,5):[],source:String(r.source||'').slice(0,120)})),
   feedback:Object.fromEntries(Object.entries(p.feedback||{}).filter(([k,v])=>k.length<180&&v&&[-1,1].includes(v.value)&&validAt(v.at,now)).slice(-200).map(([k,v])=>[k,{value:v.value,at:v.at,articleId:String(v.articleId||'').slice(0,160),category:String(v.category||'').slice(0,20),topics:Array.isArray(v.topics)?v.topics.filter(t=>typeof t==='string').slice(0,5):[]} ])),
   manual:Object.fromEntries(Object.entries(p.manual||{}).filter(([k,v])=>/^(topic|category|source):/.test(k)&&k.length<160&&[-1,1].includes(v)).slice(-100))};
 }
 function record(profile,item,now=Date.now(),aliases={}){
  const p=clean(profile,now);if(!p.learning)return p;
  const key=aliases[item.key]||item.key,day=new Date(now+8*3600e3).toISOString().slice(0,10);
  if(p.reads.some(r=>(aliases[r.key]||r.key)===key&&new Date(Date.parse(r.at)+8*3600e3).toISOString().slice(0,10)===day))return p;
  p.reads.push({key,category:item.category,topics:item.topics||[],source:item.source||'',at:new Date(now).toISOString()});p.reads=p.reads.slice(-400);return p;
 }
 function feedback(profile,item,value,now=Date.now()){
  const p=clean(profile,now);if(value===0)delete p.feedback[item.key];else if([-1,1].includes(value))p.feedback[item.key]={value,at:new Date(now).toISOString(),articleId:item.id,category:item.category,topics:item.topics||[]};return clean(p,now);
 }
 function affinity(profile,options={},now=Date.now()){
  const p=clean(profile,now),learned=new Map(),explicit=new Map(),aliases=options.aliases||{},canonical=k=>aliases[k]||k;
  const add=(map,key,value)=>map.set(key,(map.get(key)||0)+value);
  const uniqueReads=new Map();for(const r of p.reads){const day=new Date(Date.parse(r.at)+8*3600e3).toISOString().slice(0,10);uniqueReads.set(canonical(r.key)+'|'+day,r);}
  const uniqueFeedback=new Map();for(const [key,f] of Object.entries(p.feedback)){const id=canonical(key),old=uniqueFeedback.get(id);if(!old||old.at<f.at)uniqueFeedback.set(id,f);}
  p.feedback=Object.fromEntries(uniqueFeedback);
  // Cap implicit interest so many opens cannot overpower a manual preference.
  for(const r of uniqueReads.values()){const w=decay(r.at,now);add(learned,'category:'+r.category,.3*w);for(const t of r.topics)add(learned,'topic:'+t,.6*w/Math.max(1,r.topics.length));add(learned,'source:'+r.source,.12*w);}
  for(const [key,v] of learned)learned.set(key,Math.min(v,key.startsWith('source:')?.6:1.8));
  for(const [id,f] of Object.entries(p.feedback)){const w=2.5*f.value*decay(f.at,now,30);if(f.topics.length)for(const t of f.topics)add(explicit,'topic:'+t,w/f.topics.length);else add(explicit,'category:'+f.category,w);}
  for(const a of options.saved||[]){add(explicit,'category:'+a.category,.6);for(const t of a.topics||[])add(explicit,'topic:'+t,1.5/Math.max(1,a.topics.length));}
  for(const t of options.followedTopics||[])add(explicit,'topic:'+t,1);
  for(const a of options.followedEvents||[])for(const t of a.topics||[])add(explicit,'topic:'+t,1/Math.max(1,a.topics.length));
  for(const [key,v] of explicit)explicit.set(key,Math.max(-3,Math.min(3,v)));
  const seen=new Map();for(const [key,at] of Object.entries(options.eventSeen||{})){const id=canonical(key);seen.set(id,Math.max(seen.get(id)||0,time(at)));}
  return {profile:p,learned,explicit,canonical,seen,following:new Set((options.followedEvents||[]).map(e=>canonical(e.key)))};
 }
 function score(item,model,options={},now=Date.now()){
  const p=model.profile,key=model.canonical(item.key),keys=['category:'+item.category,...(item.topics||[]).map(t=>'topic:'+t),'source:'+item.source];
  const manual=keys.filter(k=>p.manual[k]).map(k=>({key:k,value:p.manual[k]*4})),learned=keys.map(k=>({key:k,value:(model.learned.get(k)||0)+(model.explicit.get(k)||0)})).filter(x=>x.value!==0);
  const interest=Math.max(-5,Math.min(5,manual.reduce((s,x)=>s+x.value,0)+learned.reduce((s,x)=>s+x.value,0)));
  const hours=Math.max(0,(now-Date.parse(item.published_at))/3600e3),freshness=Number.isFinite(hours)?3*Math.exp(-hours/36):0;
  const followed=model.following.has(key),isNew=followed&&item.last_activity&&Date.parse(item.last_activity)>(model.seen.get(key)||0);
  const dismissed=p.feedback[key]?.value===-1;
  let reason='近期发布';const positive=manual.find(x=>x.value>0)||learned.sort((a,b)=>b.value-a.value).find(x=>x.value>.15);
  if(isNew)reason='你追踪的事件有未读记录';else if(followed)reason='你正在追踪这个事件';else if(positive){const [type,...label]=positive.key.split(':'),name=type==='topic'?(options.topicNames?.[label.join(':')]||label.join(':')):label.join(':');reason=manual.some(x=>x.key===positive.key&&x.value>0)?'你设为“多看”的'+name:(type==='source'?'近期常打开的来源：':'根据近期阅读、收藏或关注：')+name;}
  return {item,score:freshness+interest+(isNew?4:followed?2:0)-(item.read?1.2:0),reason,dismissed,interest};
 }
 function ranked(items,profile,options={},now=Date.now()){
  const model=affinity(profile,options,now);return items.map(item=>score(item,model,options,now)).sort((a,b)=>b.score-a.score||chronological(a,b));
 }
 function select(items,profile,options={},now=Date.now(),limit=6){
  const model=affinity(profile,options,now),time=model.profile.sort==='time';
  let pool=items.map(item=>score(item,model,options,now)).filter(r=>!r.dismissed&&validAt(r.item.published_at,now)&&now-Date.parse(r.item.published_at)<=3*DAY);
  pool.sort((a,b)=>time?chronological(a,b):b.score-a.score||chronological(a,b));
  const picked=[],keys=new Set(),sources=new Map();
  const accept=r=>!keys.has(model.canonical(r.item.key))&&(sources.get(r.item.source)||0)<2;
  function take(r,reason){picked.push({...r,reason:reason||r.reason});keys.add(model.canonical(r.item.key));sources.set(r.item.source,(sources.get(r.item.source)||0)+1);}
  for(const r of pool){if(picked.length>=Math.max(0,limit-2))break;if(accept(r))take(r,time?'按发布时间选入':undefined);}
  const categories=new Set(picked.map(r=>r.item.category));
  // Reserve the remaining places for fresh items outside the categories already selected.
  for(const r of [...pool].sort((a,b)=>chronological(a,b))){if(picked.length>=limit)break;if(accept(r)&&!categories.has(r.item.category)){take(r,time?'按时间补充其他主题':'换个视角：补充'+r.item.category+'主题');categories.add(r.item.category);}}
  for(const r of pool){if(picked.length>=limit)break;if(accept(r))take(r,time?'按发布时间选入':undefined);}
  if(time)picked.sort((a,b)=>chronological(a,b));
  return picked;
 }
 return {clean,record,feedback,affinity,ranked,select,categoryKeys,decay};
})();
if(typeof module!=='undefined')module.exports=Reading;
