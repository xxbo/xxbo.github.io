'use strict';
const Technical = (() => {
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  const mean = a => a.reduce((s,x)=>s+x,0)/a.length;
  function sma(a,p) { return a.map((_,i)=>i<p-1?null:mean(a.slice(i-p+1,i+1))); }
  function ema(a,p) {
    const result=Array(a.length).fill(null); if(a.length<p)return result;
    let value=mean(a.slice(0,p));result[p-1]=value;
    for(let i=p;i<a.length;i++){value=a[i]*2/(p+1)+value*(1-2/(p+1));result[i]=value;}
    return result;
  }
  function rsi(a,p=14) {
    const out=Array(a.length).fill(null);if(a.length<=p)return out;
    let gain=0,loss=0;
    for(let i=1;i<=p;i++){const d=a[i]-a[i-1];gain+=Math.max(d,0)/p;loss+=Math.max(-d,0)/p;}
    const value=()=>gain===0&&loss===0?50:loss===0?100:100-100/(1+gain/loss);
    out[p]=value();
    for(let i=p+1;i<a.length;i++){const d=a[i]-a[i-1];gain=(gain*(p-1)+Math.max(d,0))/p;loss=(loss*(p-1)+Math.max(-d,0))/p;out[i]=value();}
    return out;
  }
  function analyze(history) {
    const bars=(history||[]).filter(b=>!b.partial&&finite(b.close)&&b.close>0).slice().sort((a,b)=>a.date.localeCompare(b.date));
    const close=bars.map(b=>b.close),last=bars.at(-1),n=bars.length;
    if(!n)return {available:false,bars:[],series:[],observations:[]};
    const mas=Object.fromEntries([5,10,20,60,120].map(p=>[p,sma(close,p)]));
    const fast=ema(close,12),slow=ema(close,26),dif=close.map((_,i)=>finite(fast[i])&&finite(slow[i])?fast[i]-slow[i]:null);
    const validDif=dif.filter(finite),validDea=ema(validDif,9),dea=dif.map((v,i)=>i<25?null:validDea[i-25]??null);
    const hist=dif.map((v,i)=>finite(v)&&finite(dea[i])?2*(v-dea[i]):null),rs=rsi(close);
    const bb=close.map((_,i)=>{if(i<19)return null;const a=close.slice(i-19,i+1),mid=mean(a),std=Math.sqrt(mean(a.map(v=>(v-mid)**2)));return {mid,upper:mid+2*std,lower:mid-2*std,width:std*4/mid*100};});
    const tr=bars.map((b,i)=>finite(b.high)&&finite(b.low)?Math.max(b.high-b.low,i?Math.abs(b.high-close[i-1]):0,i?Math.abs(b.low-close[i-1]):0):null);
    const atr=Array(n).fill(null);if(n>=14&&tr.slice(0,14).every(finite)){atr[13]=mean(tr.slice(0,14));for(let i=14;i<n;i++)atr[i]=finite(tr[i])&&finite(atr[i-1])?(atr[i-1]*13+tr[i])/14:null;}
    const series=bars.map((b,i)=>({...b,ma5:mas[5][i],ma10:mas[10][i],ma20:mas[20][i],ma60:mas[60][i],ma120:mas[120][i],dif:dif[i],dea:dea[i],hist:hist[i],rsi:rs[i],bb:bb[i],atr:atr[i]}));
    const current=series.at(-1),previous=series.at(-2),baseVolume=bars.slice(-21,-1).map(b=>b.volume);
    const volumeRatio=baseVolume.length===20&&baseVolume.every(finite)&&finite(last.volume)&&mean(baseVolume)>0?last.volume/mean(baseVolume):null;
    const window60=close.slice(-60),window20=close.slice(-20),high60=Math.max(...window60);
    const returns=close.slice(-21).map((c,i,a)=>i?Math.log(c/a[i-1]):null).filter(finite);
    const volatility=returns.length===20?Math.sqrt(returns.reduce((s,v)=>s+(v-mean(returns))**2,0)/19)*Math.sqrt(252)*100:null;
    const pct=p=>n>p?(last.close/close[n-1-p]-1)*100:null;
    const cross=previous&&finite(current.hist)&&finite(previous.hist)?previous.hist<=0&&current.hist>0?'DIF 刚上穿 DEA':previous.hist>=0&&current.hist<0?'DIF 刚下穿 DEA':null:null;
    const observations=[];
    if(finite(current.ma20)){const deviation=(last.close/current.ma20-1)*100;observations.push({title:'趋势位置',text:`收盘位于 MA20 ${deviation>=0?'上方':'下方'} ${Math.abs(deviation).toFixed(2)}%。`+(finite(current.ma60)?` 相比 MA60 ${last.close>=current.ma60?'偏强':'偏弱'}。`:' 60 日样本不足。')});}
    if(finite(current.ma20))observations.push({title:'均线结构',text:current.ma5>current.ma10&&current.ma10>current.ma20?'MA5 > MA10 > MA20，短期均线呈多头排列。':current.ma5<current.ma10&&current.ma10<current.ma20?'MA5 < MA10 < MA20，短期均线呈空头排列。':'短期均线交错，暂未形成一致排列。'});
    if(finite(current.hist))observations.push({title:'动能变化',text:`DIF ${current.dif>=0?'高于':'低于'}零轴，柱值${current.hist>=0?'为正':'为负'}。${cross?cross+'；':previous&&finite(previous.hist)?`绝对柱长较前日${Math.abs(current.hist)>Math.abs(previous.hist)?'扩大':'收窄'}；`:''}这描述已有动能，不预测下一日涨跌。`});
    if(finite(current.rsi))observations.push({title:'强弱状态',text:`RSI(14) 为 ${current.rsi.toFixed(1)}，${current.rsi>=70?'处于通常称为超买的强势区域，强趋势中可持续停留。':current.rsi<=30?'处于通常称为超卖的弱势区域，不能据此认定见底。':'处于 30–70 中间区域。'}`});
    if(current.bb){const b=current.bb;observations.push({title:'波动区间',text:`20 日布林带宽 ${b.width.toFixed(2)}%，收盘${last.close>b.upper?'高于上轨':last.close<b.lower?'低于下轨':'仍在上下轨之间'}。ATR(14) ${finite(current.atr)?current.atr.toFixed(2)+' 点':'样本不足'}。`});}
    if(finite(volumeRatio))observations.push({title:'量能对照',text:`最新完整日线的源端活动量为此前 20 日均值的 ${volumeRatio.toFixed(2)} 倍，${volumeRatio>=1.3?'较均值放大':volumeRatio<.7?'较均值收缩':'接近通常水平'}。不同市场的原始单位不作横向比较。`});
    return {available:true,bars,series,current,previous,count:n,asof:last.date,partialExcluded:(history||[]).some(b=>b.partial),volumeRatio,volatility,drawdown60:n>=60?(last.close/high60-1)*100:null,high20:Math.max(...window20),low20:Math.min(...window20),returns:{5:pct(5),20:pct(20),60:pct(60)},cross,observations};
  }
  return {sma,ema,rsi,analyze};
})();
if(typeof module!=='undefined')module.exports=Technical;
