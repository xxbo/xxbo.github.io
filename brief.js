'use strict';
// Pure interpretation helpers. No model calls or inferred news causality.
const Brief = (()=>{
 const time=v=>{const n=v?Date.parse(v):NaN;return Number.isFinite(n)?n:null;};
 function age(value,now=Date.now()){const t=time(value);if(t===null)return null;return Math.max(0,(now-t)/60000);}
 function freshness(value,status='ok',now=Date.now()){
  const minutes=age(value,now);
  if(status!=='ok')return {level:'error',label:minutes===null?'来源失败，暂无成功记录':'来源失败，沿用旧数据',minutes};
  if(minutes===null)return {level:'unknown',label:'采集时间未知',minutes};
  if(minutes>120)return {level:'error',label:'采集已超过 2 小时',minutes};
  if(minutes>45)return {level:'warn',label:'采集已超过 45 分钟',minutes};
  return {level:'ok',label:'最近采集正常',minutes};
 }
 function sourceFor(data,id){return (data.sources||[]).find(s=>s.id===id);}
 function sourceHealth(source,fallbackDate,now=Date.now()){
  const health=freshness(source?.last_success||fallbackDate,source?.status||'ok',now);
  if(source?.cache_reuse&&source.status==='ok'&&health.minutes!==null&&health.minutes<360)return {level:'ok',label:'日线按计划复用',minutes:health.minutes};
  if(health.level!=='ok')return health;
  if(source?.mode==='backup')return {...health,level:'warn',label:'备用来源接管'};
  if(source?.quality?.issues?.length)return {...health,level:'warn',label:'数据校验有提醒'};
  return health;
 }
 function articleHealth(data,n,now=Date.now()){
  const source=sourceFor(data,n.feed_id);
  if(n.data_state==='cached')return freshness(n.fetched_at,'error',now);
  return sourceHealth(source,n.fetched_at,now);
 }
 function events(data){return data.events?.length?data.events:(data.news||[]).map(n=>({id:n.event_id||'fallback:'+n.id,title:n.title,category:n.category,first_seen:n.first_seen,last_activity:n.updated_at,active:true,articles:[n],sources:[n.source],changes:[]}));}
 function eventFor(data,n){return events(data).find(e=>e.id===n.event_id||e.articles.some(a=>a.id===n.id));}
 function representative(data,event){const rows=event.articles.map(a=>(data.news||[]).find(n=>n.id===a.id)||a);return rows.sort((a,b)=>Number(!!b.featured)-Number(!!a.featured)||Number(b.kind==='headline')-Number(a.kind==='headline')||(time(b.published_at)||0)-(time(a.published_at)||0))[0];}
 function selectEvents(data,limit=6){
  const rows=events(data).filter(e=>e.active&&e.articles.some(a=>a.kind==='headline'));
  rows.sort((a,b)=>{const x=representative(data,a),y=representative(data,b);return Number(!!y.featured)-Number(!!x.featured)||(time(y.published_at)||0)-(time(x.published_at)||0);});
  const picked=[];if(rows[0])picked.push(rows[0]);
  for(const category of ['金融','科技','全球','政治']){const next=rows.find(e=>e.category===category&&!picked.includes(e));if(next)picked.push(next);if(picked.length===limit)break;}
  for(const e of rows){if(picked.length===limit)break;if(!picked.includes(e))picked.push(e);}
  return picked;
 }
 function changes(data,baseline){
  const since=time(baseline?.generated_at),asof=time(data.generated_at);
  if(since===null||asof===null||since>asof)return {first:true,newEvents:[],updatedEvents:[],quoteChanges:[],partial:false};
  const all=events(data),newEvents=all.filter(e=>(time(e.first_seen)||0)>since),updatedEvents=all.filter(e=>(time(e.first_seen)||0)<=since&&(time(e.last_activity)||0)>since);
  const quoteChanges=(data.markets||[]).flatMap(m=>{const old=(baseline.markets||[]).find(x=>x.id===m.id);if(!old||!Number.isFinite(old.price)||!Number.isFinite(m.price)||old.price===0||old.quote_time===m.quote_time||old.price===m.price)return [];return [{id:m.id,name:m.name,pct:(m.price/old.price-1)*100,from:old.quote_time,to:m.quote_time}];});
  const start=time(data.event_tracking_since);
  return {first:false,newEvents,updatedEvents,quoteChanges,partial:asof-since>7*864e5||(start!==null&&start>since)};
 }
 function technicalWatch(t){
  const c=t?.current,p=t?.previous;if(!c||!Number.isFinite(c.ma20)||t.count<35)return {condition:'样本不足，暂不生成验证条件。',conflict:''};
  const below=c.close<c.ma20,shrinking=Number.isFinite(c.hist)&&Number.isFinite(p?.hist)&&c.hist<0&&Math.abs(c.hist)<Math.abs(p.hist);
  return {condition:below?'观察后续完整日线能否收回 MA20，并检查 MACD 动能是否同步改善。':'观察后续完整日线能否继续守住 MA20，并检查动能与量能是否配合。',conflict:below&&shrinking?'价格仍在 MA20 下方，但 MACD 负柱正在收窄：动能减弱与趋势转强需要分别验证。':c.rsi<=30?'RSI 处于弱势区；这一状态本身不能确认底部。':c.rsi>=70?'RSI 处于强势区；这一状态本身不能确认见顶。':''};
 }
 return {time,age,freshness,sourceHealth,sourceFor,articleHealth,events,eventFor,representative,selectEvents,changes,technicalWatch};
})();
if(typeof module!=='undefined')module.exports=Brief;
