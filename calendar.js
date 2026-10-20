'use strict';
const Calendar = (()=>{
 function upcoming(row,now=Date.now()){
  if(row.scheduled_at)return Date.parse(row.scheduled_at)>=now;
  const today=new Date(now).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
  // Date-only US meetings retain source dates. Allow the final source day to finish.
  return (row.end_date||row.date)>=new Date(now).toLocaleDateString('sv-SE',{timeZone:row.source_timezone||'America/New_York'});
 }
 function scheduleLabel(row){return row.date_only?`${row.source_date||row.date}${row.end_date?' — '+row.end_date:''} · 美国当地日期，具体时刻未提供`:`${row.date} ${row.time} · 北京时间`;}
 function status(row,now=Date.now()){return upcoming(row,now)?(row.date_only?(row.feed_id==='calendar:fed'?'计划会议':'计划发布（仅日期）'):'计划发布'):'计划时点已过，结果待查';}
 function future(rows,now=Date.now()){return rows.filter(e=>upcoming(e,now)).sort((a,b)=>a.date.localeCompare(b.date)||(a.time||'99:99').localeCompare(b.time||'99:99'));}
 return {upcoming,scheduleLabel,status,future};
})();
if(typeof module!=='undefined')module.exports=Calendar;
