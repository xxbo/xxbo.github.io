'use strict';
// Portable snapshot and comparison logic. No inferred news causality or generated facts.
const Desk=(()=>{
 const time=v=>{const t=Date.parse(v);return Number.isFinite(t)?t:null;};
 const day=v=>time(v)!==null?new Date(v).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}):null;
 function capture(data,technical,context,brief){
  return {date:day(data.generated_at),generated_at:data.generated_at,
   markets:(data.markets||[]).map(m=>{const t=technical.analyze(m.history||[]),c=context.analyze(t);return {id:m.id,name:m.name,price:m.price,quote_time:m.quote_time,quote_at:m.quote_at,quote_status:m.quote_status,source:m.source,fetched_at:m.fetched_at,history_status:m.history_status,history_source:m.history_source,history_fetched_at:m.history_fetched_at,asof:t.asof||null,stage:c.available?c.stage:null,close:t.current?.close??null,ma20:t.current?.ma20??null,hist:t.current?.hist??null,rsi:t.current?.rsi??null,conflict:brief.technicalWatch(t).conflict||''};}),
   stories:brief.selectEvents(data,6).map(e=>{const a=brief.representative(data,e)||{};return {id:e.id,title:e.title,first_seen:e.first_seen,last_activity:e.last_activity,article:{id:a.id,title:a.title,category:a.category,source:a.source,published_at:a.published_at,url:a.url,summary:(a.summary||'').slice(0,400)}};}),
   event_count:(data.events||[]).length,retention_truncated:!!data.event_retention?.truncated};
 }
 function archive(rows,snapshot){const map=new Map();for(const r of [...(Array.isArray(rows)?rows:[]),snapshot]){if(!r||!day(r.generated_at))continue;const d=day(r.generated_at),old=map.get(d);if(!old||time(r.generated_at)>=time(old.generated_at))map.set(d,{...r,date:d});}return [...map.values()].sort((a,b)=>time(a.generated_at)-time(b.generated_at)).slice(-45);}
 function baseline(data,visit,mode='visit'){
  const now=time(data.generated_at);if(now===null)return null;
  if(mode==='visit')return time(visit?.generated_at)!==null&&time(visit.generated_at)<=now?visit:null;
  const history=(data.desk_history||[]).filter(r=>time(r.generated_at)!==null&&time(r.generated_at)<now).sort((a,b)=>time(a.generated_at)-time(b.generated_at));
  if(mode==='day'){const today=day(data.generated_at);return history.filter(r=>day(r.generated_at)<today).at(-1)||null;}
  const cutoff=now-7*864e5;return history.filter(r=>time(r.generated_at)<=cutoff).at(-1)||null;
 }
 function compare(data,old,technical,context,brief){
  const current=capture(data,technical,context,brief),since=time(old?.generated_at),now=time(data.generated_at);
  if(since===null||now===null||since>now)return {current,baseline:null,events:[],markets:[],partial:false};
  const events=brief.events(data).flatMap(e=>{const changes=(e.changes||[]).filter(c=>time(c.at)>since&&time(c.at)<=now);const fresh=time(e.first_seen)>since&&time(e.first_seen)<=now;const active=time(e.last_activity)>since&&time(e.last_activity)<=now;if(!fresh&&!active&&!changes.length)return [];return [{event:e,kind:fresh?'new':changes.some(c=>c.type==='content_updated')?'revision':'reports',changes}];}).sort((a,b)=>time(b.event.last_activity)-time(a.event.last_activity));
  const markets=current.markets.flatMap(m=>{const b=(old.markets||[]).find(x=>x.id===m.id);if(!b)return [];const quoteRollback=time(m.quote_at)!==null&&time(b.quote_at)!==null&&time(m.quote_at)<time(b.quote_at),sourceChanged=!!m.history_source&&!!b.history_source&&m.history_source!==b.history_source;const quoteChanged=!quoteRollback&&m.quote_time&&b.quote_time&&m.quote_time!==b.quote_time&&Number.isFinite(m.price)&&Number.isFinite(b.price)&&b.price>0&&m.price!==b.price;const lineChanged=!sourceChanged&&!!m.asof&&!!b.asof&&m.asof>b.asof;const messages=[];if(lineChanged&&m.stage&&b.stage&&m.stage!==b.stage)messages.push(`结构：${b.stage} → ${m.stage}`);if(lineChanged&&Number.isFinite(m.hist)&&Number.isFinite(b.hist)&&((m.hist>0&&b.hist<=0)||(m.hist<0&&b.hist>=0)))messages.push(`MACD 柱${m.hist>0?'转正':'转负'}`);if(lineChanged&&Number.isFinite(m.rsi)&&Number.isFinite(b.rsi)&&((m.rsi<=30&&b.rsi>30)||(m.rsi>=70&&b.rsi<70)||(m.rsi>30&&b.rsi<=30)||(m.rsi<70&&b.rsi>=70)))messages.push(`RSI：${b.rsi.toFixed(1)} → ${m.rsi.toFixed(1)}`);return [{current:m,previous:b,quoteChanged,lineChanged,quoteRollback,sourceChanged,pct:quoteChanged?(m.price/b.price-1)*100:null,messages,comparable:!!b.asof&&!sourceChanged}];});
  return {current,baseline:old,events,markets,partial:!!data.event_retention?.truncated||time(data.event_tracking_since)>since||now-since>(data.event_retention?.days||30)*864e5};
 }
 function cleanResearch(raw){const list=Array.isArray(raw)?raw:[];return list.filter(x=>x&&typeof x.id==='string'&&typeof x.title==='string').slice(0,20).map(x=>({...x,title:x.title.slice(0,120),topic:typeof x.topic==='string'?x.topic:'ai',keywords:(Array.isArray(x.keywords)?x.keywords:[]).filter(v=>typeof v==='string').slice(0,12),evidence:(Array.isArray(x.evidence)?x.evidence:[]).filter(e=>e&&typeof e.id==='string'&&typeof e.title==='string').slice(0,30),versions:(Array.isArray(x.versions)?x.versions:[]).slice(-30),reviews:(Array.isArray(x.reviews)?x.reviews:[]).slice(-30)}));}
 function revise(item,fields,at,snapshot){const changed=['title','hypothesis','verify','invalidate','topic','due'].some(k=>(item[k]||'')!==(fields[k]||''))||JSON.stringify(item.keywords||[])!==JSON.stringify(fields.keywords||[]);if(!changed)return item;const version={at,title:fields.title,hypothesis:fields.hypothesis,verify:fields.verify,invalidate:fields.invalidate,topic:fields.topic,keywords:fields.keywords,due:fields.due,snapshot};return {...item,...fields,updated_at:at,versions:[...(item.versions||[]),version].slice(-30)};}
 function pin(item,evidence){if((item.evidence||[]).some(x=>x.id===evidence.id))return {item,reason:'duplicate'};if((item.evidence||[]).length>=30)return {item,reason:'limit'};return {item:{...item,evidence:[...(item.evidence||[]),evidence],updated_at:evidence.captured_at},reason:'added'};}
 return {time,day,capture,archive,baseline,compare,cleanResearch,revise,pin};
})();
if(typeof module!=='undefined')module.exports=Desk;
