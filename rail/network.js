/* Focused map editor model. Hidden legacy city accounts are not part of this UI. */
(function(root){
'use strict';
const R=typeof module!=='undefined'&&module.exports?require('./engine.js'):root.RailSim;
const T=typeof module!=='undefined'&&module.exports?require('./tokyo.js'):root.TokyoRegion;
const COLORS=['#4479cf','#159781','#d18150','#a26bc4','#d25d80','#789641'];
function defaults(s){for(const [i,l]of s.services.entries()){l.color=l.color||COLORS[i%COLORS.length];l.cars=l.cars||8;l.fleet=l.fleet||Math.min(80,2*Math.ceil((runtime(s,l)+1)/l.headway));l.open=l.open??360;l.close=l.close??1440;}return s;}
function tokyo(){return defaults(T.create(R));}
function emptyWorld(){const s=R.newGame();s.region='tokyo';s.world={width:2900,height:2100};s.nodes=[];s.tracks=[];s.services=[];s.log=[];s.nextId=1;return defaults(s);}
function removePreset(s){const c=R.clone(s),seed=T.create(R),ids=new Set(seed.services.map(l=>l.id));c.services=c.services.filter(l=>!ids.has(l.id));prune(c);const keep=new Set(c.services.flatMap(l=>l.stops));for(const n of c.nodes)if(n.id>=seed.nodes.length)keep.add(n.id);const mapping=new Map(),nodes=[];for(const n of c.nodes)if(keep.has(n.id)){mapping.set(n.id,nodes.length);nodes.push({...n,id:nodes.length});}c.nodes=nodes;for(const l of c.services)l.stops=l.stops.map(id=>mapping.get(id));for(const tr of c.tracks){tr.a=mapping.get(tr.a);tr.b=mapping.get(tr.b);}return c;}
function fresh(){return defaults(R.newGame());}
function runtime(s,l){return l.trackIds.reduce((v,id)=>v+s.tracks.find(t=>t.id===id).km/48*60+.6,0);}
function commit(s,copy){if(!validate(copy))return {error:'线路配置无效，操作未保存。'};for(const k of Object.keys(s))delete s[k];Object.assign(s,copy);return {};}
function node(s,point){
 if(Number.isInteger(point)){if(!s.nodes[point])throw Error('车站不存在。');return point;}
 if(s.nodes.length>=(s.region==='tokyo'?400:200))throw Error('测试地图最多支持 400 个车站。');
 if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<25||point.x>(s.world?.width||1040)-25||point.y<25||point.y>(s.world?.height||740)-25)throw Error('请在地图范围内设置车站。');
 const close=s.nodes.find(n=>Math.hypot(n.x-point.x,n.y-point.y)<.04);if(close)throw Error('这里已有车站，请点击车站接入，或稍微挪动位置。');
 const id=s.nodes.length;s.nodes.push({id,name:'新站 '+String(id+1).padStart(2,'0'),x:Math.round(point.x*1000)/1000,y:Math.round(point.y*1000)/1000,type:'住宅',people:2200,jobs:500,housing:8000,growth:0,initialPeople:2200,initialJobs:500});return id;
}
function route(s,l,stops){
 const loop=stops[0]===stops.at(-1),unique=loop?stops.slice(0,-1):stops;if(new Set(unique).size!==unique.length||unique.length<(loop?3:2))throw Error('普通线路至少保留两个不同车站，环线至少三个。');
 if(stops.length>(s.region==='tokyo'?60:30))throw Error('当前地图的单线车站数量已达上限。');
 const ids=[];for(let i=1;i<stops.length;i++){const a=stops[i-1],b=stops[i];let t=s.tracks.find(t=>R.key(t.a,t.b)===R.key(a,b)&&t.owner===l.owner);if(!t){t={id:'t'+s.nextId++,a,b,owner:l.owner,km:R.distance(s.nodes[a],s.nodes[b])};s.tracks.push(t);}ids.push(t.id);}
 l.stops=[...stops];l.trackIds=ids;l.through=false;delete l.parents;delete l.operators;
 // This editor gives each overlapping service its own corridor when the combined slots overflow.
 for(let i=0;i<ids.length;i++)if(R.loadTph(s,ids[i])>30+.0001){const old=s.tracks.find(t=>t.id===ids[i]),t={...old,id:'t'+s.nextId++,owner:l.owner};s.tracks.push(t);l.trackIds[i]=t.id;}
 prune(s);
}
function prune(s){const used=new Set(s.services.flatMap(l=>l.trackIds));s.tracks=s.tracks.filter(t=>used.has(t.id));}
function addLine(s,points){
 const c=R.clone(s);try{if(c.services.length>=30)return {error:'测试地图最多支持 30 条线路。'};const stops=points.map(p=>node(c,p));const l={id:'s'+c.nextId++,name:'新线路 '+String(c.services.length+1).padStart(2,'0'),owner:c.companies[c.services.length%3].id,headway:8,through:false,color:COLORS[c.services.length%COLORS.length],fleet:12,cars:6,open:360,close:1380};c.services.push(l);route(c,l,stops);const r=commit(s,c);return r.error?r:{id:l.id};}catch(e){return {error:e.message};}
}
function insertion(s,l,p){const n=s.nodes[p];let best={dist:Infinity,index:1};for(let i=1;i<l.stops.length;i++){const a=s.nodes[l.stops[i-1]],b=s.nodes[l.stops[i]],dx=b.x-a.x,dy=b.y-a.y,u=((n.x-a.x)*dx+(n.y-a.y)*dy)/(dx*dx+dy*dy),v=Math.max(0,Math.min(1,u)),dist=Math.hypot(n.x-a.x-dx*v,n.y-a.y-dy*v);if(dist<best.dist){let index=i;if(l.stops[0]!==l.stops.at(-1)){if(i===1&&u<0)index=0;if(i===l.stops.length-1&&u>1)index=l.stops.length;}best={dist,index};}}return best.index;}
function addStation(s,id,point){const c=R.clone(s);try{const l=c.services.find(l=>l.id===id);if(!l)throw Error('请先选择线路。');const n=node(c,point);if(l.stops.includes(n))throw Error('该站已经在线路上。');const stops=[...l.stops];stops.splice(insertion(c,l,n),0,n);route(c,l,stops);return commit(s,c);}catch(e){return {error:e.message};}}
function removeStation(s,id,nodeId){const c=R.clone(s);try{const l=c.services.find(l=>l.id===id);if(!l||!l.stops.includes(nodeId))throw Error('车站不在线路中。');const loop=l.stops[0]===l.stops.at(-1),stops=l.stops.filter(n=>n!==nodeId);if(loop&&stops[0]!==stops.at(-1))stops.push(stops[0]);route(c,l,stops);return commit(s,c);}catch(e){return {error:e.message};}}
function removeLine(s,id){const c=R.clone(s);if(!c.services.some(l=>l.id===id))return {error:'线路不存在。'};c.services=c.services.filter(l=>l.id!==id);prune(c);return commit(s,c);}
function configure(s,id,values){const c=R.clone(s),l=c.services.find(l=>l.id===id);if(!l)return {error:'线路不存在。'};for(const k of ['fleet','cars','headway','open','close'])if(k in values)l[k]=values[k];if(R.loadTph(c,l.trackIds[0])>30+.0001)return {error:'当前线路间隔超过轨道容量。'};return commit(s,c);}
function validate(s){return R.validate(s)&&s.services.every(l=>Number.isInteger(l.fleet)&&l.fleet>=2&&l.fleet<=80&&l.fleet%2===0&&[4,6,8].includes(l.cars)&&Number.isInteger(l.open)&&Number.isInteger(l.close)&&l.open>=0&&l.close<=1440&&l.close-l.open>=60&&/^#[0-9a-f]{6}$/i.test(l.color));}
function stats(s,m,id){
 const l=s.services.find(l=>l.id===id);if(!l)return null;const factor=(l.close-l.open)/(18*60),stations=Object.fromEntries([...new Set(l.stops)].map(n=>[n,{board:0,alight:0}]));let revenue=0,riders=0;
 for(const f of m.flows){let from=f.from,length=0,aboard=false,used=false;for(let i=0;i<f.path.edges.length;i++){const e=f.path.edges[i];if(e.service===id){if(!aboard){stations[from].board+=f.trips*factor;riders+=f.trips*factor;aboard=true;}length+=e.km;used=true;if(f.path.edges[i+1]?.service!==id){stations[e.to].alight+=f.trips*factor;aboard=false;}}from=e.to;}if(used){revenue+=f.trips*f.path.fare*length/f.path.km*factor;}}
 const km=R.serviceKm(s,l),headway=R.effectiveHeadway(s,l),hours=(l.close-l.open)/60,departures=hours*60/headway*2,vehicleCost=km*departures*(180+l.cars*25),cost=vehicleCost+l.fleet*18000+km*2200;
 return {riders,revenue,cost,km,headway,stations,capacity:R.capacity(l),fleet:l.fleet,cars:l.cars,hours,departures};
}
const api={emptyWorld,removePreset,tokyo,fresh,defaults,validate,addLine,addStation,removeStation,removeLine,configure,stats,runtime,insertion};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RailNetwork=api;
})(typeof globalThis!=='undefined'?globalThis:this);
