'use strict';
// Browser quote overlay. Published history, news and calendar are never rewritten here.
const LiveQuotes=(()=>{
 const codes=['sh000001','sz399006','sh000688'];
 const providers=['腾讯财经','新浪财经','东方财富'];
 const number=v=>typeof v!=='boolean'&&v!==null&&v!==undefined&&String(v).trim()!==''&&Number.isFinite(Number(v))?Number(v):null;
 function clock(value){const m=String(value||'').match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})[ T]?(\d{2}):?(\d{2}):?(\d{2})$/);if(!m)return null;const iso=`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00`;return Number.isFinite(Date.parse(iso))?iso:null;}
 function target(now=Date.now()){
  const d=new Date(now+8*3600000),minute=d.getUTCHours()*60+d.getUTCMinutes();
  if([0,6].includes(d.getUTCDay())||minute<575)return null;
  let end=Math.min(minute,900);if(minute>690&&minute<780)end=690;
  return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),Math.floor(end/60),end%60)-8*3600000-(minute>=900?10000:5*60000);
 }
 function fresh(row,now=Date.now()){const expected=target(now);return expected===null||Date.parse(row.quote_at)>=expected;}
 function valid(row,previous,now=Date.now()){
  const stamp=Date.parse(row?.quote_at);
  return !!row&&codes.includes(row.id)&&Number.isFinite(row.price)&&row.price>0&&Number.isFinite(row.change)&&Number.isFinite(row.change_pct)&&Math.abs(row.change_pct)<=100&&Number.isFinite(stamp)&&stamp<=now+2*60000&&now-stamp<=10*86400000&&(!previous?.quote_at||stamp>=Date.parse(previous.quote_at));
 }
 function parse(provider,code,payload){
  let row={id:code,source:providers[provider],source_url:provider===0?'https://gu.qq.com/'+code:provider===1?'https://finance.sina.com.cn/':'https://quote.eastmoney.com/'+code+'.html',quote_timezone:'Asia/Shanghai'};
  if(provider===0){const f=String(payload||'').split('~');if(f.length<34||f[2]!==code.slice(2))throw Error('腾讯指数字段或代码不匹配');Object.assign(row,{price:number(f[3]),change:number(f[31]),change_pct:number(f[32]),quote_at:clock(f[30]),quote_time:f[30]});}
  else if(provider===1){const f=String(payload||'').split(',');if(f.length<32)throw Error('新浪指数字段不足');const price=number(f[3]),previous=number(f[2]);Object.assign(row,{price,change:price!==null&&previous!==null?price-previous:null,change_pct:previous?((price-previous)/previous*100):null,quote_at:clock(f[30]+' '+f[31]),quote_time:f[30]+' '+f[31]});}
  else {const d=payload?.data;if(!d||d.f57!==code.slice(2)||!Number.isInteger(d.f59)||d.f59<0||d.f59>6)throw Error('东方财富指数代码或精度不匹配');const scaled=k=>number(d[k])===null?null:number(d[k])/10**d.f59,stamp=number(d.f86);Object.assign(row,{price:scaled('f43'),change:scaled('f169'),change_pct:number(d.f170)===null?null:number(d.f170)/100,quote_at:stamp!==null?new Date(stamp*1000).toISOString():null,quote_time:stamp!==null?new Date(stamp*1000).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'}):''});}
  return row;
 }
 function loadScript(url,read,globals=[]){
  return new Promise((resolve,reject)=>{
   const script=document.createElement('script');let finished=false;
   const clean=()=>{clearTimeout(timer);script.remove();for(const key of globals){try{delete window[key];}catch{}}};
   const finish=(error)=>{if(finished)return;finished=true;let value;try{if(!error)value=read();}catch(e){error=e;}clean();error?reject(error):resolve(value);};
   const timer=setTimeout(()=>finish(Error('请求超时')),5000);
   script.async=true;script.charset='gb18030';script.src=url;
   script.onload=()=>finish();script.onerror=()=>finish(Error('网络或浏览器阻止了来源请求'));
   document.head.appendChild(script);
  });
 }
 let serial=0;
 async function browserTransport(provider,ids){
  if(!document?.createElement)throw Error('当前环境不支持行情直连');
  const suffix=Date.now();
  if(provider<2){const prefix=provider===0?'v_':'hq_str_',globals=ids.map(id=>prefix+id);const url=provider===0?'https://qt.gtimg.cn/q='+ids.join(',')+'&_='+suffix:'https://hq.sinajs.cn/list='+ids.join(',')+'&_='+suffix;return loadScript(url,()=>Object.fromEntries(ids.map(id=>[id,window[prefix+id]])),globals);}
  const rows=await Promise.all(ids.map(async id=>{
   const callback='__guanchaoQuote'+Date.now()+'_'+(++serial);let payload;
   window[callback]=data=>{payload=data;};
   const secid=(id.startsWith('sh')?'1.':'0.')+id.slice(2);
   const url='https://push2.eastmoney.com/api/qt/stock/get?secid='+secid+'&fields=f43,f57,f58,f59,f60,f86,f169,f170&cb='+callback+'&_='+suffix;
   try{return [id,await loadScript(url,()=>{if(!payload)throw Error('东方财富未返回回调数据');return payload;},[callback])];}catch(error){return [id,{error:error.message}];}
  }));return Object.fromEntries(rows);
 }
 async function refresh(previous,now=Date.now(),transport=browserTransport){
  const old=Object.fromEntries(previous.filter(r=>codes.includes(r.id)).map(r=>[r.id,r]));const selected={},attempts=Object.fromEntries(codes.map(c=>[c,[]]));
  for(let provider=0;provider<providers.length;provider++){
   const pending=codes.filter(c=>!selected[c]||!fresh(selected[c],now));if(!pending.length)break;
   const started=Date.now();let data,error;
   try{data=await transport(provider,pending);}catch(e){error=e.message;}
   for(const id of pending){
    try{if(error)throw Error(error);if(data?.[id]?.error)throw Error(data[id].error);const row=parse(provider,id,data?.[id]);if(!valid(row,old[id],now))throw Error('报价无效、时间回退或超出可核验范围');const current=fresh(row,now);attempts[id].push({source:providers[provider],status:'ok',quote_at:row.quote_at,duration_ms:Date.now()-started,fresh:current});if(!selected[id]||Date.parse(row.quote_at)>Date.parse(selected[id].quote_at))selected[id]={...row,provider};}
    catch(e){attempts[id].push({source:providers[provider],status:'error',error:e.message,duration_ms:Date.now()-started});}
   }
  }
  return {at:new Date(now).toISOString(),rows:Object.values(selected),attempts,freshCount:Object.values(selected).filter(r=>fresh(r,now)).length};
 }
 function apply(data,report){
  const patches=new Map(report.rows.map(r=>[r.id,r]));const next={...data,markets:data.markets.map(old=>{const r=patches.get(old.id);if(!r)return old;const {provider,...quote}=r;return {...old,...quote,status:'ok',quote_status:'ok',fetched_at:report.at,live_quote:true,quote_source_fresh:fresh(r,Date.parse(report.at))};}),sources:[...(data.sources||[])]};
  for(const r of report.rows){
   const key='quote:'+r.id,index=next.sources.findIndex(s=>s.id===key),old=index>=0?next.sources[index]:{},issues=fresh(r,Date.parse(report.at))?[]:['已检查主备来源，源端报价仍较早；可能休市或延迟'];
   const source={...old,id:key,status:'ok',runtime:true,mode:r.provider?'backup':'primary',selected_source:r.source,primary_source:providers[0],backup_sources:providers.slice(1),last_success:report.at,checked_at:report.at,last_changed:data.markets.some(m=>m.id===r.id&&(m.price!==r.price||m.quote_at!==r.quote_at))?report.at:old.last_changed,count:1,error:null,quality:{status:issues.length?'warning':'ok',issues},attempts:report.attempts[r.id],health_history:[...(old.health_history||[]).slice(-11),{at:report.at,status:'ok',mode:r.provider?'backup':'primary',source:r.source,failed_attempts:report.attempts[r.id].filter(a=>a.status==='error').length}],coverage_note:'本浏览器直连 A 股指数报价；新闻、经济日历及完整日线采用后台快照。'};
   if(index>=0)next.sources[index]=source;else next.sources.push(source);
  }
  return next;
 }
 function active(now=Date.now()){const d=new Date(now+8*3600000),minute=d.getUTCHours()*60+d.getUTCMinutes();return ![0,6].includes(d.getUTCDay())&&minute>=565&&minute<=935;}
 return {codes,providers,parse,valid,fresh,target,refresh,apply,active};
})();
if(typeof module!=='undefined')module.exports=LiveQuotes;
