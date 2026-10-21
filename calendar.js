'use strict';
const Calendar = (()=>{
 function hasValue(value){return value!==null&&value!==undefined&&String(value).trim()!=='';}
 function released(row){return hasValue(row.actual);}
 function upcoming(row,now=Date.now()){
  if(released(row))return false;
  if(row.scheduled_at)return Date.parse(row.scheduled_at)>=now;
  return (row.end_date||row.date)>=new Date(now).toLocaleDateString('sv-SE',{timeZone:row.source_timezone||'America/New_York'});
 }
 function scheduleLabel(row){const local=row.source_timezone==='Asia/Shanghai'?'北京时间，时刻待定':row.source_timezone==='America/New_York'||(!row.source_timezone&&row.feed_id!=='calendar:results')?'美国当地日期，具体时刻未提供':'来源当地日期，具体时刻未提供';return row.date_only?`${row.source_date||row.date}${row.end_date?' — '+row.end_date:''} · ${local}`:`${row.date} ${row.time} · 北京时间`;}
 function status(row,now=Date.now()){return released(row)?'已公布':upcoming(row,now)?(row.date_only?(row.feed_id==='calendar:fed'?'计划会议':'计划发布（仅日期）'):'待公布'):row.record_type==='indicator'?'公布值未取得':'计划时点已过，结果待查';}
 function future(rows,now=Date.now()){return rows.filter(e=>upcoming(e,now)).sort((a,b)=>a.date.localeCompare(b.date)||(a.time||'99:99').localeCompare(b.time||'99:99'));}
 function formatValue(row,key){if(!hasValue(row[key]))return '—';const v=String(row[key]);return v+(row.unit&&!v.endsWith(row.unit)?' '+row.unit:'');}
 function surprise(row){
  if(!released(row)||!hasValue(row.forecast))return null;
  const numeric=v=>/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(String(v).replaceAll(',','').trim())?Number(String(v).replaceAll(',','').replace('%','')):NaN;
  const actual=numeric(row.actual),forecast=numeric(row.forecast);
  if(!Number.isFinite(actual)||!Number.isFinite(forecast))return null;
  const difference=Number((actual-forecast).toFixed(8));
  const unit=row.unit==='%'?'个百分点':row.unit||'';
  return {difference,text:difference===0?'符合预期':`较预期 ${difference>0?'+':''}${difference.toLocaleString('zh-CN',{maximumFractionDigits:6})}${unit?' '+unit:''}`};
 }
 function select(rows,{mode='today',country='全部',date='',query=''}={},now=Date.now()){
  const today=new Date(now).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
  return rows.filter(e=>(country==='全部'||e.country===country)&&(!query||(e.title+' '+(e.original_title||'')).toLowerCase().includes(query.toLowerCase()))&&(date?e.date===date:mode==='today'?e.date===today:mode==='released'?released(e):mode==='upcoming'?upcoming(e,now):true)).sort((a,b)=>mode==='released'&&!date?b.date.localeCompare(a.date)||(b.time||'').localeCompare(a.time||'')||a.id.localeCompare(b.id):a.date.localeCompare(b.date)||(a.time||'99:99').localeCompare(b.time||'99:99')||a.id.localeCompare(b.id));
 }
 return {hasValue,released,upcoming,scheduleLabel,status,future,formatValue,surprise,select};
})();
if(typeof module!=='undefined')module.exports=Calendar;
