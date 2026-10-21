'use strict';
const GlobalMarkets=(()=>{
 const groups=[{id:'stocks',name:'全球股指',description:'各地最近交易时段 · 点位不可直接横向比较'},{id:'fx',name:'汇率与美元',description:'注意报价方向 · 数据商报价不是银行兑换价'},{id:'commodities',name:'黄金与原油',description:'近月期货 · 与现货区分，合约滚动可能产生跳变'},{id:'rates',name:'美债收益率',description:'美国财政部官方日度观测 · 变化单位 bp'}];
 function asset(m){return m.asset_class||'stocks';}
 function number(m,value=m.price){return Number.isFinite(value)?value.toLocaleString('en-US',{minimumFractionDigits:m.precision??(asset(m)==='fx'&&m.unit!=='点'?4:2),maximumFractionDigits:m.precision??(asset(m)==='fx'&&m.unit!=='点'?4:2)}):'—';}
 function delta(m){if(asset(m)==='rates')return Number.isFinite(m.change)?(m.change>0?'+':'')+(m.change*100).toFixed(1)+' bp':'—';return Number.isFinite(m.change_pct)?(m.change_pct>0?'+':'')+m.change_pct.toFixed(2)+'%':'—';}
 function value(m){return number(m)+(asset(m)==='rates'&&Number.isFinite(m.price)?'%':'');}
 function spread(markets){const a=markets.find(m=>m.id==='rateUS10Y'),b=markets.find(m=>m.id==='rateUS2Y');if(!a||!b)return null;const lookup=new Map((b.observations||[]).map(r=>[r.date,r.value]));const rows=(a.observations||[]).filter(r=>lookup.has(r.date)&&Number.isFinite(r.value)&&Number.isFinite(lookup.get(r.date))).sort((x,y)=>x.date.localeCompare(y.date));const last=rows.at(-1);return last?{date:last.date,bp:(last.value-lookup.get(last.date))*100}:null;}
 return {groups,asset,number,delta,value,spread};
})();
if(typeof module!=='undefined')module.exports=GlobalMarkets;
