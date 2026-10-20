'use strict';
// Descriptive rules on completed daily bars. No return forecasts or trading scores.
const MarketContext=(()=>{
 const finite=Number.isFinite,change=(a,b)=>finite(a)&&finite(b)&&b!==0?(a/b-1)*100:null;
 const defaults={sh000001:'sz399006',sz399006:'sh000001',sh000688:'sh000001',hkHSTECH:'hkHSI',hkHSI:'hkHSTECH'};
 const benchmarkRole=id=>['sz399006','sh000688','hkHSTECH'].includes(id)?'同市场基准对照':'同市场风格对照';
 function volatility(closes){if(closes.length!==21)return null;const r=closes.slice(1).map((c,i)=>Math.log(c/closes[i])),mean=r.reduce((a,b)=>a+b,0)/20;return Math.sqrt(r.reduce((s,v)=>s+(v-mean)**2,0)/19)*Math.sqrt(252)*100;}
 function volContext(bars){
  const values=[];for(let end=Math.max(20,bars.length-253);end<bars.length-1;end++)values.push(volatility(bars.slice(end-20,end+1).map(b=>b.close)));
  const current=bars.length>=21?volatility(bars.slice(-21).map(b=>b.close)):null;
  if(!finite(current)||values.length<60)return {value:current,percentile:null,samples:values.length};
  const eps=Math.max(1e-8,Math.abs(current)*1e-9),below=values.filter(v=>v<current-eps).length,equal=values.filter(v=>Math.abs(v-current)<=eps).length;
  return {value:current,percentile:(below+equal/2)/values.length*100,samples:values.length,from:bars[Math.max(20,bars.length-253)].date,to:bars.at(-2).date};
 }
 function consecutive(series,predicate){let count=0;for(let i=series.length-1;i>=0;i--){if(!predicate(series[i]))break;count++;}return count;}
 function analyze(t){
  if(!t.available||t.count<20)return {available:false,count:t.count||0};
  const c=t.current,old=t.series.at(-6),ma20Slope=old?change(c.ma20,old.ma20):null;
  let stage='中期样本不足',tone='';
  if(finite(c.ma60)&&finite(ma20Slope)){
   if(c.close>c.ma20&&c.ma20>=c.ma60&&ma20Slope>0){stage='上行结构';tone='up';}
   else if(c.close<c.ma20&&c.ma20<=c.ma60&&ma20Slope<0){stage='下行结构';tone='down';}
   else if(c.close>=c.ma20&&c.ma20<c.ma60)stage='中期偏弱，短线修复';
   else if(c.close<c.ma20&&c.ma20>c.ma60)stage='中期偏强，短线回撤';
   else stage='均线交错，方向分歧';
  }
  const horizons=[{period:20,label:'短线位置',base:c.ma20},{period:60,label:'中期位置',base:c.ma60},{period:120,label:'长期位置',base:c.ma120}].map(h=>({...h,bias:change(c.close,h.base)}));
  const above=consecutive(t.series,r=>finite(r.ma20)&&r.close>r.ma20),below=consecutive(t.series,r=>finite(r.ma20)&&r.close<r.ma20);
  const bias=change(c.close,c.ma20),oldBias=old?change(old.close,old.ma20):null;
  const delta=old?{from:old.date,to:c.date,return:change(c.close,old.close),rsi:finite(c.rsi)&&finite(old.rsi)?c.rsi-old.rsi:null,bias:finite(bias)&&finite(oldBias)?bias-oldBias:null,histFrom:old.hist,histTo:c.hist}:null;
  const signals=[];for(let i=Math.max(1,t.series.length-5);i<t.series.length;i++){
   const p=t.series[i-1],r=t.series[i];
   if(finite(p.ma20)&&finite(r.ma20)){if(p.close<=p.ma20&&r.close>r.ma20)signals.push({date:r.date,text:'收盘重新站上 MA20'});else if(p.close>=p.ma20&&r.close<r.ma20)signals.push({date:r.date,text:'收盘跌回 MA20 下方'});}
   if(finite(p.hist)&&finite(r.hist)){if(p.hist<=0&&r.hist>0)signals.push({date:r.date,text:'MACD 柱由非正转正'});else if(p.hist>=0&&r.hist<0)signals.push({date:r.date,text:'MACD 柱由非负转负'});}
   if(finite(p.rsi)&&finite(r.rsi)){if(p.rsi<70&&r.rsi>=70)signals.push({date:r.date,text:'RSI 进入 70 以上区域'});else if(p.rsi>30&&r.rsi<=30)signals.push({date:r.date,text:'RSI 进入 30 以下区域'});}
  }
  const prior=t.bars.slice(-21,-1),range=prior.length===20?{low:Math.min(...prior.map(b=>b.close)),high:Math.max(...prior.map(b=>b.close)),from:prior[0].date,to:prior.at(-1).date}:null;
  const scenarios=[{label:'偏强结构的验证',condition:'连续两根完整日线收盘高于各自 MA20，同时最新 MACD 柱值为正。',met:finite(c.hist)?above>=2&&c.hist>0:null},{label:'偏弱结构的验证',condition:'连续两根完整日线收盘低于各自 MA20，同时最新 MACD 柱值为负。',met:finite(c.hist)?below>=2&&c.hist<0:null}];
  const lastReturn=t.previous?change(c.close,t.previous.close):null;
  const activity={ratio:t.volumeRatio,lastReturn};
  return {available:true,activity,stage,tone,asof:t.asof,horizons,ma20Slope,above,below,delta,signals:signals.slice(-6).reverse(),range,vol:volContext(t.bars),scenarios};
 }
 function compare(a,b,period=20){
  const x=new Map(a.bars.map(r=>[r.date,r.close])),y=new Map(b.bars.map(r=>[r.date,r.close]));
  const dates=[...x.keys()].filter(d=>y.has(d)).sort(),sample=dates.slice(-period-1);
  if(sample.length<period+1)return {available:false,count:sample.length,needed:period+1};
  const first=sample[0],last=sample.at(-1),left=change(x.get(last),x.get(first)),right=change(y.get(last),y.get(first));
  return {available:true,period,from:first,to:last,left,right,excess:left-right,leftAsOf:a.asof,rightAsOf:b.asof,alignedLatest:a.asof===last&&b.asof===last,rows:sample.map(date=>({date,left:x.get(date)/x.get(first)*100,right:y.get(date)/y.get(first)*100}))};
 }
 return {analyze,compare,defaults,benchmarkRole,volContext};
})();
if(typeof module!=='undefined')module.exports=MarketContext;
