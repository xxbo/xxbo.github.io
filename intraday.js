'use strict';
const Intraday=(()=>{
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const codes=['sh000001','sz399006','sh000688','hkHSI','hkHSTECH','usSPX','usIXIC','usDJI'];
 const secids=['1.000001','0.399006','1.000688','100.HSI','100.HSTECH','100.SPX','100.IXIC','100.DJIA'];
 const zone=id=>id.startsWith('us')?'America/New_York':'Asia/Shanghai';
 const positive=v=>v!==null&&v!==undefined&&String(v).trim()!==''&&Number.isFinite(Number(v))&&Number(v)>0?Number(v):null;
 const clock=t=>/^\d{2}:\d{2}$/.test(t)&&+t.slice(0,2)<24&&+t.slice(3)<60?+t.slice(0,2)*60+(+t.slice(3)):NaN;
 const regular=(id,t)=>id.startsWith('us')?t>=570&&t<=960:t>=570&&t<=(id.startsWith('hk')?720:690)||t>=780&&t<=(id.startsWith('hk')?960:900);
 function local(now,id){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone(id),year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));return {date:parts.year+'-'+parts.month+'-'+parts.day,minute:+parts.hour*60+(+parts.minute),weekend:['Sat','Sun'].includes(parts.weekday)};}
 function validate(row,previous,now=Date.now()){
  if(!row||!codes.includes(row.id)||!/^\d{4}-\d{2}-\d{2}$/.test(row.date||''))throw Error('分钟数据日期或标的无效');
  const current=local(now,row.id),age=(Date.parse(current.date)-Date.parse(row.date))/864e5;
  if(!Number.isFinite(age)||age<0||age>10)throw Error('分钟数据日期无效或过旧');
  const points=new Map();for(const p of row.points||[]){const t=clock(p.time);if(!Number.isFinite(t)||!regular(row.id,t)||!positive(p.price)||row.date===current.date&&t>current.minute+2)continue;points.set(p.time,{time:p.time,price:Number(p.price)});}
  const clean=[...points.values()].sort((a,b)=>a.time.localeCompare(b.time));if(clean.length<2)throw Error('来源未提供足够的分钟点');
  const stamp=row.date+' '+clean.at(-1).time,old=previous?.date+' '+previous?.points?.at(-1)?.time;
  if(previous?.points?.length&&stamp<old)throw Error('拒绝分钟数据回退');
  return {...row,points:clean,previous_close:positive(row.previous_close),timezone:zone(row.id)};
 }
 function parse(provider,id,payload){
  if(provider===0){const d=payload?.data?.[id],raw=d?.data;if(!/^\d{8}$/.test(raw?.date||''))throw Error('来源缺少分时日期');const day=raw.date;return {id,date:day.slice(0,4)+'-'+day.slice(4,6)+'-'+day.slice(6),points:(raw.data||[]).flatMap(value=>{const f=String(value).split(/\s+/);return /^\d{4}$/.test(f[0])?[{time:f[0].slice(0,2)+':'+f[0].slice(2),price:positive(f[1])}]:[]}),previous_close:positive(d.qt?.[id]?.[4]),source:'腾讯财经分时'};}
  if(provider===2){const d=payload?.chart?.result?.[0],symbols={usSPX:'^GSPC',usIXIC:'^IXIC',usDJI:'^DJI'};if(!d||d.meta?.symbol!==symbols[id])throw Error('Yahoo 分时代码不匹配');const prices=d.indicators?.quote?.[0]?.close||[],points=[];let date=null;(d.timestamp||[]).forEach((epoch,i)=>{const p=local(epoch*1000,id),time=String(Math.floor(p.minute/60)).padStart(2,'0')+':'+String(p.minute%60).padStart(2,'0');if(!regular(id,p.minute)||!positive(prices[i]))return;if(date!==p.date){points.length=0;date=p.date;}points.push({time,price:Number(prices[i])});});return {id,date,points,previous_close:positive(d.meta.chartPreviousClose),source:'Yahoo Finance 分时'};}
  const d=payload?.data;if(!d||d.code!==secids[codes.indexOf(id)].split('.')[1])throw Error('分时代码不匹配');const days=new Set(),points=(d.trends||[]).map(value=>{const f=value.split(',');days.add(f[0].slice(0,10));return {time:f[0].slice(11,16),price:positive(f[2])};});if(days.size!==1)throw Error('分时混入多日数据');return {id,date:[...days][0],points,previous_close:positive(d.preClose),source:'东方财富分时'};
 }
 let serial=0;
 function script(url,key,callback=false){return new Promise((resolve,reject)=>{const el=document.createElement('script');let payload,done=false;const finish=error=>{if(done)return;done=true;clearTimeout(timer);el.remove();const value=callback?payload:window[key];try{delete window[key];}catch{}error?reject(error):resolve(value);};const timer=setTimeout(()=>finish(Error('分时来源请求超时')),6000);if(callback)window[key]=v=>{payload=v;};el.src=url;el.async=true;el.onload=()=>finish();el.onerror=()=>finish(Error('分时来源请求失败'));document.head.appendChild(el);});}
 async function transport(provider,id){if(provider===2){const symbol={usSPX:'^GSPC',usIXIC:'^IXIC',usDJI:'^DJI'}[id],controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000);try{const r=await fetch('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+'?range=1d&interval=1m',{signal:controller.signal});if(!r.ok)throw Error('Yahoo 分时请求失败');return await r.json();}finally{clearTimeout(timer);}}const key='__gcMinute'+Date.now()+'_'+(++serial);if(provider===0)return script('https://web.ifzq.gtimg.cn/appstock/app/minute/query?code='+id+'&_var='+key+'&_='+Date.now(),key);return script('https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid='+secids[codes.indexOf(id)]+'&fields1=f1,f2,f3,f4,f5,f6,f7,f8&fields2=f51,f52,f53,f54,f55,f56,f57,f58&ndays=1&iscr=0&cb='+key+'&_='+Date.now(),key,true);}
 async function refresh(markets,ids,now=Date.now(),request=transport){return Promise.all(ids.filter(id=>codes.includes(id)).map(async id=>{const previous=markets.find(m=>m.id===id)?.intraday;let best=null;const errors=[];for(const provider of id.startsWith('us')?[2]:[0,1]){try{const row=validate(parse(provider,id,await request(provider,id)),previous,now),current=local(now,id);if(!best||row.date+' '+row.points.at(-1).time>best.date+' '+best.points.at(-1).time)best=row;const end=current.minute<780&&!id.startsWith('us')?Math.min(current.minute,id.startsWith('hk')?720:690):Math.min(current.minute,id.startsWith('sh')||id.startsWith('sz')?900:960);if(row.date===current.date&&clock(row.points.at(-1).time)>=end-5)break;}catch(e){errors.push(e.message);}}return {id,row:best?{...best,fetched_at:new Date(now).toISOString(),status:'ok',runtime:true}:null,error:errors.join('；')};}));}
 function active(ids,now=Date.now()){return ids.some(id=>{const d=local(now,id);return !d.weekend&&d.minute>=565&&d.minute<=(id.startsWith('sh')||id.startsWith('sz')?915:975);});}
 function latest(m,now=Date.now()){
  try{const r=validate({...m.intraday,id:m.id},null,now),p=r.points.at(-1),at=m.id.startsWith('us')?r.asof:r.date+'T'+p.time+':00+08:00',epoch=Date.parse(at);if(!r.previous_close||!Number.isFinite(epoch)||epoch>now+120000||epoch<=Date.parse(m.quote_at||'1970-01-01'))return m;return {...m,price:p.price,change:p.price-r.previous_close,change_pct:(p.price/r.previous_close-1)*100,quote_at:at,quote_time:r.date+' '+p.time,quote_timezone:r.timezone};}catch{return m;}
 }
 function chart(m,now=Date.now()){ 
  const row=m.intraday;if(!row?.points?.length)return '<div class="minute-empty">分时暂不可用</div>';
  let valid;try{valid=validate({...row,id:m.id},null,now);}catch{return '<div class="minute-empty">分时暂不可用</div>';}
  const points=valid.points,prior=valid.previous_close,vals=points.map(p=>p.price),center=prior||((Math.min(...vals)+Math.max(...vals))/2),range=Math.max(...vals.map(v=>Math.abs(v-center)),center*.0005),y=v=>46-(v-center)/range*35;
  const x=t=>{let minute=clock(t)-570;if(!m.id.startsWith('us')&&clock(t)>=780)minute-=m.id.startsWith('hk')?60:90;const span=m.id.startsWith('us')?390:m.id.startsWith('hk')?330:240;return 2+minute/span*356;};
  const color=points.at(-1).price>=(prior||points[0].price)?'var(--red)':'var(--green)',xy=points.map(p=>x(p.time).toFixed(2)+','+y(p.price).toFixed(2)).join(' '),last=points.at(-1),end=m.id.startsWith('us')||m.id.startsWith('hk')?'16:00':'15:00';
  return `<div class="minute-chart"><svg viewBox="0 0 360 94" preserveAspectRatio="none" role="img" aria-label="${escape(m.name||m.id)} ${row.date} 一分钟分时走势，共 ${points.length} 个真实分钟点">${prior?'<line x1="0" x2="360" y1="46" y2="46" stroke="currentColor" opacity=".25" stroke-dasharray="3 4"/>':''}<polyline points="${xy}" fill="none" stroke="${color}" stroke-width="1.8" vector-effect="non-scaling-stroke"/>${points.map(p=>`<circle cx="${x(p.time).toFixed(2)}" cy="${y(p.price).toFixed(2)}" r="4" fill="transparent"><title>${row.date} ${p.time} · ${p.price.toFixed(2)}</title></circle>`).join('')}</svg><div class="minute-axis"><span>09:30</span><span>${end}</span></div><small>${row.date.slice(5)} ${last.time} · ${m.id.startsWith('us')?'纽约':'北京'}时间${row.status==='cached'?' · 沿用缓存':''} · ${escape(row.source||'分时来源')}</small></div>`;
 }
 return {codes,parse,validate,refresh,active,chart,local,latest};
})();
if(typeof module!=='undefined')module.exports=Intraday;
