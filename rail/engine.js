/* Tokyo-inspired urban rail sandbox. Money: million yen; daily demand: synthetic weekday trips. */
(function(root){
'use strict';
const X=typeof module!=='undefined'&&module.exports?require('./service-plan'):root.RailServicePlan;
const VERSION=2, SCALE=.045, PEAK=.18;
const clone=x=>JSON.parse(JSON.stringify(x));
const round=x=>Math.round(x*100)/100;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)*SCALE;
const key=(a,b)=>[a,b].sort((x,y)=>x-y).join(':');
const seed=[
 ['北野',285,110,'住宅',9500,900],['緑丘',125,190,'田园',1100,180],['池袋',465,180,'商业',8500,14500],['上野',735,215,'商业',6500,10500],['亀戸',900,270,'住宅',12500,2200],
 ['新宿',455,345,'办公',11000,23500],['四谷',575,325,'住宅',9000,5200],['大手町',720,350,'办公',4500,28500],['渋谷',455,485,'商业',8500,15500],['六本木',605,465,'办公',7500,13000],
 ['東京',790,420,'办公',4500,21000],['品川',640,615,'办公',9000,12500],['二子橋',310,495,'住宅',8500,1800],['丘の上',205,420,'住宅',6500,800],['青葉台',100,480,'住宅',8500,1500],
 ['多摩野',100,320,'田园',900,120],['学園前',310,290,'教育',8000,6500],['東川',900,420,'住宅',13000,1800],['新港',940,545,'工业',6500,10000],['湾岸',820,590,'住宅',11000,4000],
 ['川崎',435,660,'工业',12000,13500],['西の森',80,620,'田园',650,90],['南町',250,625,'住宅',6500,1700],['北新町',675,85,'田园',800,100],['花見台',295,80,'田园',550,80]
];
function newGame(){
 const s={version:VERSION,quarter:0,companies:[
 {id:'aoba',name:'青葉電鉄',short:'青葉',color:'#078a73',cash:620,fare:220,ledger:[]},
 {id:'metro',name:'都心メトロ',short:'メトロ',color:'#d46b36',cash:800,fare:200,ledger:[]},
 {id:'jr',name:'東都 JR',short:'JR',color:'#446ccf',cash:950,fare:240,ledger:[]}
 ],nodes:seed.map((r,id)=>({id,name:r[0],x:r[1],y:r[2],type:r[3],people:r[4],jobs:r[5],initialPeople:r[4],initialJobs:r[5],housing:r[3]==='田园'?14000:Math.round(r[4]*1.7+2500),growth:0})),tracks:[],services:[],log:[],nextId:1};
 addSeed(s,'jr','山手环状线',[2,3,10,11,8,5,2],5);
 addSeed(s,'aoba','青葉本线',[14,13,12,8],8);
 addSeed(s,'metro','都心穿越线',[8,9,7,3],6);
 s.log=[{q:0,text:'三家公司已开始运营。先试试调整票价、班次，或将青葉本线与都心穿越线直通。'}];
 return s;
}
function addSeed(s,owner,name,stops,headway){
 const ids=[];for(let i=1;i<stops.length;i++){const a=stops[i-1],b=stops[i];let t=s.tracks.find(t=>key(t.a,t.b)===key(a,b));if(!t){t={id:'t'+s.nextId++,a,b,owner,km:distance(s.nodes[a],s.nodes[b])};s.tracks.push(t);}ids.push(t.id);}
 s.services.push({id:'s'+s.nextId++,name,owner,stops,trackIds:ids,headway,through:false});
}
function company(s,id){return s.companies.find(c=>c.id===id);}
function serviceKm(s,line){return line.trackIds.reduce((sum,id)=>sum+s.tracks.find(t=>t.id===id).km,0);}
function trackOwners(s,line){return [...new Set(line.trackIds.map(id=>s.tracks.find(t=>t.id===id).owner))];}
function capacity(l){return (l.cars||8)*100;}
function effectiveHeadway(s,l){if(s.routeModel===9)return X.headway(s,l);if(!l.fleet)return l.headway;const cycle=l.trackIds.reduce((v,id)=>v+s.tracks.find(t=>t.id===id).km/48*60+.6,0)+1;return Math.max(l.headway,2*cycle/l.fleet);}
function loadTph(s,trackId,exclude){if(s.routeModel===9){const op=X.expand(s);return op.services.filter(l=>l.parentLine!==exclude&&l.trackIds.includes(trackId)).reduce((v,l)=>v+60/X.headway(op,l),0);}return s.services.filter(l=>l.id!==exclude&&l.trackIds.includes(trackId)).reduce((v,l)=>v+60/effectiveHeadway(s,l),0);}
function log(s,text){s.log.unshift({q:s.quarter,text});s.log=s.log.slice(0,50);}
function quoteBuild(s,owner,stops,mode='shared'){
 if(!company(s,owner))return {error:'请选择运营公司。'};
 if(!['shared','dedicated'].includes(mode))return {error:'请选择建设方式。'};
 if(s.services.length>=60||s.tracks.length>=150)return {error:'Demo 网络规模上限已到。'};
 if(stops.length<2)return {error:'至少选择两个候选站。'};
 if(stops.length>10||new Set(stops).size!==stops.length)return {error:'一条新线最多选 10 个不同车站。'};
 if(stops.some(id=>!s.nodes[id]))return {error:'站点无效。'};
 let cost=0,km=0,newKm=0,sharedKm=0;const segments=[],lessors=new Set();
 for(let i=1;i<stops.length;i++){
  const a=stops[i-1],b=stops[i],matches=s.tracks.filter(t=>key(t.a,t.b)===key(a,b)),d=distance(s.nodes[a],s.nodes[b]);
  if(d>20)return {error:'两站距离超过 20 公里，请添加中间站。'};
  const existing=mode==='shared'?[...matches].sort((x,y)=>(x.owner===owner?-1:1)-(y.owner===owner?-1:1)||loadTph(s,x.id)-loadTph(s,y.id)).find(t=>loadTph(s,t.id)+7.5<=30+.0001):null;
  if(mode==='shared'&&matches.length&&!existing)return {error:'既有轨道班次已满，请降低班次，或选择独立复线。'};
  if(mode==='dedicated'&&matches.filter(t=>t.owner===owner).length>=3)return {error:'该公司在同一走廊最多建设三组复线。'};
  const river=(s.nodes[a].x-850)*(s.nodes[b].x-850)<0;
  km+=d;if(existing){sharedKm+=d;if(existing.owner!==owner)lessors.add(existing.owner);}else{newKm+=d;cost+=d*(owner==='metro'?12:8)+(river?24:0);}
  segments.push({a,b,km:d,existing:existing?.id});
 }
 const built=new Set(s.tracks.filter(t=>t.owner===owner).flatMap(t=>[t.a,t.b]));
 if(newKm)cost+=stops.filter(id=>!built.has(id)).length*(owner==='metro'?20:12);
 cost+=lessors.size*12+5;
 return {cost:round(cost),km:round(km),newKm:round(newKm),sharedKm:round(sharedKm),lessors:[...lessors],mode,segments};
}
function build(s,owner,stops,mode='shared'){
 const q=quoteBuild(s,owner,stops,mode);if(q.error)return q;const c=company(s,owner);
 if(c.cash<q.cost)return {error:'公司资金不足；可先结算收入，或缩短线路。'};
 c.cash=round(c.cash-q.cost);c.pendingCapital=(c.pendingCapital||0)+q.cost;
 const ids=q.segments.map(seg=>{if(seg.existing)return seg.existing;const t={id:'t'+s.nextId++,a:seg.a,b:seg.b,km:seg.km,owner};s.tracks.push(t);return t.id;});
 const line={id:'s'+s.nextId++,name:s.nodes[stops[0]].name+'—'+s.nodes[stops.at(-1)].name,owner,stops:[...stops],trackIds:ids,headway:8,through:false};s.services.push(line);log(s,c.name+' 开通 '+line.name+'：新增复线 '+q.newKm+' km，借用既有轨道 '+q.sharedKm+' km；投入 '+q.cost.toFixed(1)+' 百万円。');return {line,cost:q.cost};
}
function operatorAt(s,line,i){return line.operators?.[i]||line.owner;}
function participants(s,line){return [...new Set(line.trackIds.map((_,i)=>operatorAt(s,line,i)))];}
function joinPlan(s,aId,bId){
 if(s.services.length>=60)return {error:'Demo 最多支持 60 条服务。'};
 const a=s.services.find(l=>l.id===aId),b=s.services.find(l=>l.id===bId);
 if(!a||!b||a===b||a.through||b.through||a.owner===b.owner)return {error:'请选择两家公司的普通服务。'};
 if(a.stops[0]===a.stops.at(-1)||b.stops[0]===b.stops.at(-1))return {error:'环状线暂不参与直通。'};
 let as=[...a.stops],bs=[...b.stops],at=[...a.trackIds],bt=[...b.trackIds],ao=at.map((_,i)=>operatorAt(s,a,i)),bo=bt.map((_,i)=>operatorAt(s,b,i));
 const shared=[as[0],as.at(-1)].find(id=>id===bs[0]||id===bs.at(-1));if(shared===undefined)return {error:'两条服务须在共同的端点站接续；可先修建连接线。'};
 if(as[0]===shared){as.reverse();at.reverse();ao.reverse();}if(bs.at(-1)===shared){bs.reverse();bt.reverse();bo.reverse();}
 const stops=as.concat(bs.slice(1)),trackIds=at.concat(bt);
 if(new Set(stops).size!==stops.length)return {error:'直通路径不能折返或重复经过同一站。'};
 if(s.services.some(l=>l.through&&l.parents?.includes(aId)&&l.parents?.includes(bId)))return {error:'这两条线路已经开通直通。'};
 if(trackIds.some(id=>loadTph(s,id)+6>30))return {error:'共用区段超过每小时 30 班，请先降低原有服务频率。'};
 const owners=[a.owner,b.owner];if(owners.some(id=>company(s,id).cash<12))return {error:'双方公司各需 12 百万円用于联调与车辆配置。'};
 return {stops,trackIds,owners,shared,parents:[aId,bId],operators:ao.concat(bo)};
}
function through(s,aId,bId){
 const p=joinPlan(s,aId,bId);if(p.error)return p;
 p.owners.forEach(id=>{const c=company(s,id);c.cash-=12;c.pendingCapital=(c.pendingCapital||0)+12;});
 const line={id:'s'+s.nextId++,name:s.nodes[p.stops[0]].name+'↔'+s.nodes[p.stops.at(-1)].name+' 直通',owner:p.owners[0],stops:p.stops,trackIds:p.trackIds,headway:10,through:true,parents:p.parents,operators:p.operators};s.services.push(line);log(s,'直通服务开行：'+line.name+'。双方各投入 12 百万円，票款与运营成本按承运里程分配。');return {line};
}
function setFare(s,id,fare){if(!Number.isFinite(fare)||fare<100||fare>500)return {error:'票价范围为 100—500 円。'};company(s,id).fare=Math.round(fare);return {};}
function setHeadway(s,id,h){const l=s.services.find(l=>l.id===id);if(!l||![4,5,6,8,10,12,15].includes(h))return {error:'班次无效。'};if(l.trackIds.some(t=>loadTph(s,t,id)+60/h>30+.0001))return {error:'共用轨道每小时最多 30 班，请协调其他服务。'};l.headway=h;return {};}
function network(s,penalties={}){if(s.routeModel===9)return X.network(s);
 const adj=s.nodes.map(()=>[]);
 for(const l of s.services){const total=serviceKm(s,l),byOwner={};for(const id of l.trackIds){const t=s.tracks.find(t=>t.id===id);const op=operatorAt(s,l,l.trackIds.indexOf(id));byOwner[op]=(byOwner[op]||0)+t.km;}
  // A cross-company through journey uses a discounted sum of company base fares.
  const ownerMask=Object.keys(byOwner).reduce((v,id)=>v|(1<<s.companies.findIndex(c=>c.id===id)),0);
  for(let i=1;i<l.stops.length;i++){const t=s.tracks.find(t=>t.id===l.trackIds[i-1]);const e={service:l.id,owner:operatorAt(s,l,i-1),km:t.km,track:t.id,fare:company(s,t.owner).fare,through:l.through,ownerMask,minutes:t.km/48*60+.6,headway:effectiveHeadway(s,l),penalty:penalties[t.id]||0};adj[l.stops[i-1]].push({...e,to:l.stops[i]});adj[l.stops[i]].push({...e,to:l.stops[i-1]});}
 }
 return adj;
}
// Binary min-heap keeps metropolitan path searches responsive.
function pushHeap(h,item){let i=h.length;h.push(item);while(i){const p=(i-1)>>1;if(h[p].p.cost<=item.p.cost)break;h[i]=h[p];i=p;}h[i]=item;}
function popHeap(h){const top=h[0],last=h.pop();if(h.length){let i=0;while(i*2+1<h.length){let c=i*2+1;if(c+1<h.length&&h[c+1].p.cost<h[c].p.cost)c++;if(h[c].p.cost>=last.p.cost)break;h[i]=h[c];i=c;}h[i]=last;}return top;}
function paths(s,adj,origin,value=.045){if(s.routeModel===9)return X.paths(s,adj,origin,value);
 const start=origin+'||0|0',best=new Map([[start,{node:origin,service:'',paid:0,discounted:0,cost:0,minutes:0,fare:0,km:0,edges:[],transfers:0}]]),done=new Set(),result=[],heap=[];pushHeap(heap,{id:start,p:best.get(start)});
 while(heap.length){const item=popHeap(heap),cur=item.p,k=item.id;if(done.has(k)||best.get(k)!==cur)continue;done.add(k);if(!result[cur.node]||cur.cost<result[cur.node].cost)result[cur.node]=cur;
  for(const e of adj[cur.node]){const change=cur.service!==e.service,transfer=change&&!!cur.service,wait=change?e.headway/2:0,extra=wait+(transfer?4:0)+e.penalty;const bit=1<<s.companies.findIndex(c=>c.id===e.owner),paid=cur.paid|bit;let fee=(cur.paid&bit)?0:e.fare,discounted=cur.discounted;const prior=e.through?cur.edges.filter(v=>v.service===e.service).reduce((v,x)=>v|(1<<s.companies.findIndex(c=>c.id===x.owner)),0):0;if(e.through&&prior&&(prior&bit)===0){const eligible=(prior|bit)&~discounted;for(let ci=0;ci<s.companies.length;ci++)if(eligible&(1<<ci))fee-=s.companies[ci].fare*.15;discounted|=prior|bit;}const p={node:e.to,service:e.service,paid,discounted,cost:cur.cost+e.minutes+extra+fee*value,minutes:cur.minutes+e.minutes+extra,fare:cur.fare+fee,km:cur.km+e.km,edges:cur.edges.concat(e),transfers:cur.transfers+(transfer?1:0)};const nk=e.to+'|'+e.service+'|'+paid+'|'+discounted;if(!best.has(nk)||p.cost<best.get(nk).cost-.000001){best.set(nk,p);done.delete(nk);pushHeap(heap,{id:nk,p});}}
 }
 return result;
}
function evaluate(s){
 let result;
 for(let pass=0;pass<2;pass++){
 const penalties=result?Object.fromEntries(s.tracks.map(t=>[t.id,Math.max(0,(result.trackLoad[t.id]||0)-1)*7])):{};
 const adj=network(s,penalties),accounts=Object.fromEntries(s.companies.map(c=>[c.id,{revenue:0,cost:0,boardings:0,accessIncome:0,accessCost:0}])),trackFlow={},serviceFlow={},flows=[],reach=s.nodes.map(()=>0);let totalTrips=0,riders=0,travel=0,baseline=0,transfers=0;
 for(const o of s.nodes){
  const ps=paths(s,adj,o.id),targets=s.nodes.filter(d=>d.id!==o.id&&d.jobs>0),weights=targets.map(d=>d.jobs*Math.exp(-distance(o,d)/15)),sum=weights.reduce((a,b)=>a+b,0);
  for(let j=0;j<targets.length;j++){
   const d=targets[j],trips=o.people*.72*weights[j]/sum,km=distance(o,d),road=8+km/23*60*1.22,p=ps[d.id];let share=0,rail=0;
   if(p&&p.edges.length){rail=p.minutes+8;const generalized=rail+p.fare*.045;share=.93/(1+Math.exp(Math.min(40,Math.max(-40,(generalized-(road+8))/8))));if(rail<=45)reach[o.id]+=d.jobs;}
   const railTrips=trips*share;totalTrips+=trips;riders+=railTrips;baseline+=trips*road;travel+=railTrips*rail+(trips-railTrips)*road;
   if(railTrips>.1){transfers+=railTrips*p.transfers;const fare=p.fare,byOwner={};for(const e of p.edges){byOwner[e.owner]=(byOwner[e.owner]||0)+e.km;trackFlow[e.track]=(trackFlow[e.track]||0)+railTrips;}for(const [id,len]of Object.entries(byOwner)){accounts[id].revenue+=railTrips*fare*len/p.km*90/1e6;accounts[id].boardings+=railTrips;}for(const id of new Set(p.edges.map(e=>e.service)))serviceFlow[id]=(serviceFlow[id]||0)+railTrips;flows.push({from:o.id,to:d.id,trips:railTrips,demandTrips:railTrips,path:p,road,rail});}
  }
 }
 for(const l of s.services){const km=serviceKm(s,l),cost=km*(.7+(60/effectiveHeadway(s,l))*.225);for(let i=0;i<l.trackIds.length;i++){const t=s.tracks.find(t=>t.id===l.trackIds[i]),op=operatorAt(s,l,i);accounts[op].cost+=cost*t.km/km;if(t.owner!==op){const rent=t.km*.6;accounts[op].accessCost+=rent;accounts[op].cost+=rent;accounts[t.owner].accessIncome+=rent;}}}
 for(const t of s.tracks)accounts[t.owner].cost+=t.km*.5;
 const trackLoad=Object.fromEntries(s.tracks.map(t=>[t.id,(trackFlow[t.id]||0)*PEAK/Math.max(1,s.services.filter(l=>l.trackIds.includes(t.id)).reduce((v,l)=>v+60/effectiveHeadway(s,l)*capacity(l),0))]));
 // Ration each proposed journey by its most constrained segment. Unserved demand stays on roads.
 const demanded=riders;let unserved=0;
 for(const a of Object.values(accounts)){a.revenue=0;a.boardings=0;}
 for(const id of Object.keys(serviceFlow))serviceFlow[id]=0;
 for(const f of flows){const ratio=Math.min(1,...f.path.edges.map(e=>1/Math.max(1,trackLoad[e.track]||0))),actual=f.trips*ratio,lost=f.trips-actual;unserved+=lost;riders-=lost;travel+=lost*(f.road-f.rail);transfers-=lost*f.path.transfers;f.trips=actual;
  const byOwner={};for(const e of f.path.edges)byOwner[e.owner]=(byOwner[e.owner]||0)+e.km;
  for(const [id,len]of Object.entries(byOwner)){accounts[id].revenue+=actual*f.path.fare*len/f.path.km*90/1e6;accounts[id].boardings+=actual;}
  for(const id of new Set(f.path.edges.map(e=>e.service)))serviceFlow[id]+=actual;
 }
 const busiest=Math.max(0,...Object.values(trackLoad));result={accounts,trackFlow,trackLoad,serviceFlow,demanded,unserved,flows:flows.sort((a,b)=>b.trips-a.trips),reach,riders,totalTrips,share:riders/totalTrips,avgTime:travel/totalTrips,baseline:baseline/totalTrips,saved:(baseline-travel)/totalTrips,transfers:riders?transfers/riders:0,busiest,population:s.nodes.reduce((a,b)=>a+b.people,0),jobs:s.nodes.reduce((a,b)=>a+b.jobs,0)};
 }
 return result;
}
function step(s){
 const m=evaluate(s);s.quarter++;
 for(const c of s.companies){const a=m.accounts[c.id],profit=a.revenue+a.accessIncome-a.cost;c.cash=round(c.cash+profit);c.ledger.unshift({q:s.quarter,revenue:round(a.revenue),accessIncome:round(a.accessIncome),accessCost:round(a.accessCost),cost:round(a.cost),profit:round(profit),capital:round(c.pendingCapital||0),cash:c.cash});c.ledger=c.ledger.slice(0,40);c.pendingCapital=0;}
 const served=new Set(s.services.flatMap(l=>l.stops)),weights=s.nodes.map(n=>served.has(n.id)?Math.max(0,m.reach[n.id]-15000)*Math.max(0,1-n.people/n.housing):0),sum=weights.reduce((a,b)=>a+b,0);let added=0;
 for(const n of s.nodes){n.growth=0;if(sum&&weights[n.id]>0){const target=Math.min(650,2400*weights[n.id]/sum,Math.max(0,n.housing-n.people)),g=Math.floor(target);n.people+=g;n.growth=g;added+=g;}}
 // Employment has a separate regional demand budget, concentrated at accessible established centres.
 const jobWeights=s.nodes.map(n=>served.has(n.id)&&m.reach[n.id]>30000&&n.type!=='田园'?(n.type==='办公'?3:n.type==='商业'?2:1):0),jw=jobWeights.reduce((a,b)=>a+b,0);
 if(jw)for(const n of s.nodes)n.jobs+=Math.floor(650*jobWeights[n.id]/jw);
 const top=[...s.nodes].sort((a,b)=>b.growth-a.growth)[0];log(s,'季度结算：沿线新增 '+added.toLocaleString('zh-CN')+' 人'+(top.growth?'，'+top.name+' 增长 '+top.growth+' 人':'')+'；铁路日均出行 '+Math.round(m.riders).toLocaleString('zh-CN')+' 人次。');return m;
}
function validate(s){
 try{
 if(s.region!==undefined&&s.region!=='tokyo')return false;
 if(s.region==='tokyo'&&(s.world?.width!==2900||s.world?.height!==2100))return false;
 if(s.version!==VERSION||!Number.isInteger(s.quarter)||s.quarter<0||s.quarter>100000||(s.nodes.length<(s.region==='tokyo'?0:seed.length)||s.nodes.length>(s.region==='tokyo'?400:200))||s.companies.length!==3||s.tracks.length>600||s.services.length>100||!Number.isSafeInteger(s.nextId))return false;
 const finite=n=>typeof n==='number'&&Number.isFinite(n),companies=new Set(['aoba','metro','jr']);
 const identity={aoba:['青葉電鉄','青葉','#078a73'],metro:['都心メトロ','メトロ','#d46b36'],jr:['東都 JR','JR','#446ccf']};
 if(s.companies.some(c=>!companies.has(c.id)||c.name!==identity[c.id]?.[0]||c.short!==identity[c.id]?.[1]||c.color!==identity[c.id]?.[2]||!finite(c.cash)||!finite(c.fare)||c.fare<100||c.fare>500)||new Set(s.companies.map(c=>c.id)).size!==3)return false;
 if(s.nodes.some((n,i)=>n.id!==i||typeof n.name!=='string'||n.name.length>40||!['住宅','办公','商业','工业','教育','田园'].includes(n.type)||!Number.isFinite(n.x)||!Number.isFinite(n.y)||n.x<20||n.x>(s.world?.width||1040)-20||n.y<20||n.y>(s.world?.height||740)-20||![n.people,n.jobs,n.housing].every(finite)||n.people<0||n.jobs<0||n.housing<1||n.people>1e8||n.jobs>1e8||n.housing>1e8||!finite(n.growth)||n.growth<0||(s.region!=='tokyo'&&i<seed.length&&(n.name!==seed[i][0]||n.x!==seed[i][1]||n.y!==seed[i][2]||n.type!==seed[i][3]))))return false;
 if(new Set(s.tracks.map(t=>t.id)).size!==s.tracks.length)return false;
 if(s.tracks.some(t=>!/^t\d+$/.test(t.id)||!companies.has(t.owner)||!s.nodes[t.a]||!s.nodes[t.b]||t.a===t.b||!finite(t.km)||Math.abs(t.km-X.sum(X.trackPoints(s,t)))>.001))return false;
 if(new Set(s.services.map(l=>l.id)).size!==s.services.length)return false;
 if(s.services.some(l=>!/^s\d+$/.test(l.id)||typeof l.name!=='string'||l.name.length>100||!companies.has(l.owner)||!Array.isArray(l.stops)||l.stops.length<2||l.stops.length>(s.region==='tokyo'?60:30)||l.trackIds.length!==l.stops.length-1||![4,5,6,8,10,12,15,20].includes(l.headway)||l.trackIds.some((id,i)=>{const t=s.tracks.find(t=>t.id===id);return !t||key(t.a,t.b)!==key(l.stops[i],l.stops[i+1]);})))return false;
 if(s.routeModel===9?!X.validate(s):s.tracks.some(t=>loadTph(s,t.id)>30+.0001))return false;
 if(s.nextId<=Math.max(0,...s.tracks.map(t=>+t.id.slice(1)),...s.services.map(l=>+l.id.slice(1))))return false;
 if(s.services.some(l=>l.operators&&(!Array.isArray(l.operators)||l.operators.length!==l.trackIds.length||l.operators.some(id=>!companies.has(id)))))return false;
 if(s.services.some(l=>typeof l.through!=='boolean'||(l.through&&(!Array.isArray(l.parents)||l.parents.length!==2||l.parents.some(id=>!s.services.some(p=>p.id===id&&!p.through))))))return false;
 return Array.isArray(s.log)&&s.log.length<=50&&s.log.every(e=>Number.isInteger(e.q)&&e.q>=0&&e.q<=s.quarter&&typeof e.text==='string'&&e.text.length<3000)&&s.companies.every(c=>Array.isArray(c.ledger)&&c.ledger.length<=40&&(!c.pendingCapital||finite(c.pendingCapital))&&c.ledger.every(l=>['q','revenue','cost','profit','capital','cash'].every(k=>finite(l[k]))));
 }catch{return false;}
}
function upgrade(s){const v=clone(s);if(v.version===1){v.version=VERSION;for(const l of v.services)if(l.through)l.operators=l.trackIds.map(id=>v.tracks.find(t=>t.id===id).owner);}return v;}
const api={capacity,effectiveHeadway,upgrade,operatorAt,participants,loadTph,newGame,clone,distance,key,company,serviceKm,trackOwners,quoteBuild,build,joinPlan,through,setFare,setHeadway,evaluate,step,validate,network,paths,VERSION};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RailSim=api;
})(typeof globalThis!=='undefined'?globalThis:this);
