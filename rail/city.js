/* Real 2020 population / 2021 urban land-use extract; employment and commercial opportunities remain model estimates. */
(function(root){'use strict';
const node=typeof module!=='undefined'&&module.exports,R=node?require('./engine'):root.RailSim;
const X=node?require('./service-plan'):root.RailServicePlan;
const D=node?require('./demand-model'):root.RailDemand;
const CELL=2000/120,AREA=.7,WALK=.8,DETOUR=1.25;let cached;
function source(){return node?require('./tokyo-data'):root.RailCityData;}
function create(){if(cached)return cached;const d=source();if(!d)throw Error('真实密度数据尚未加载');const cells=[],totals={people:0,jobs:0,shops:0,industry:0,leisure:0};
 for(let row=0;row<d.rows;row++)for(let col=0;col<d.cols;col++){const i=(row*d.cols+col)*d.recordBytes,lon=d.lon0+col*d.stepLon,lat=d.lat0+row*d.stepLat,area=Math.abs(d.stepLat*d.stepLon)*111.32**2*Math.cos(lat*Math.PI/180),populationValid=d.raw[i+2]===1,people=d.raw[i]+256*d.raw[i+1],survey=d.raw[i+3]/255,high=d.raw[i+4]/255*area,factory=d.raw[i+5]/255*area,low=d.raw[i+6]/255*area,park=d.raw[i+7]/255*area,publicArea=d.raw[i+8]/255*area;
 const c={id:row+':'+col,x:(lon-139.15)*2000+80,y:(36.04-lat)*2470+60,w:d.stepLon*2000,h:-d.stepLat*2470,area,populationValid,survey,factory,high,park,people,jobs:Math.round(people*.25+high*18000+factory*5000+publicArea*5000),shops:Math.round(people*.04+high*5000),industry:Math.round(factory*5000),leisure:Math.round(people*.05+park*5000+publicArea*3000)};cells.push(c);for(const k of Object.keys(totals))totals[k]+=c[k];}
 let demand=null;cached={cells,totals,cell:CELL,area:AREA,metadata:d,get demand(){return demand||(demand=buildDemand(cells));}};return cached;
}
function buildDemand(cells){const profiles=[{purpose:'work',rate:.52,field:'jobs',decay:14},{purpose:'shopping',rate:.16,field:'shops',decay:5},{purpose:'leisure',rate:.12,field:'leisure',decay:10}],groups=new Map(),zoneFor=new Map(),weights=new Map();
 for(const c of cells){const key=Math.floor(c.x/80)+':'+Math.floor(c.y/80);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c);zoneFor.set(c.id,key);}
 const zones=new Map([...groups].map(([key,cs])=>[key,{x:cs.reduce((v,c)=>v+c.x,0)/cs.length,y:cs.reduce((v,c)=>v+c.y,0)/cs.length,fields:Object.fromEntries(profiles.map(p=>[p.field,cs.reduce((v,c)=>v+c[p.field],0)]))}]));
 // Fixed gravity distribution over the entire city, independent of served stations.
 // Within each ~3.6 km zone, destination cells divide opportunities proportionally.
 function trips(origin,destination,p){const key=zoneFor.get(origin.id)+':'+p.purpose;let w=weights.get(key);if(!w){const originZone=zones.get(zoneFor.get(origin.id));let total=0;const targets=new Map();for(const [id,z]of zones){const attraction=Math.exp(-R.distance(originZone,z)/p.decay);targets.set(id,attraction);total+=z.fields[p.field]*attraction;}w={targets,total};weights.set(key,w);}return w.total?origin.people*p.rate*destination[p.field]*w.targets.get(zoneFor.get(destination.id))/w.total:0;}
 return {profiles,trips};
}
function* journeys(mapping){const city=create(),demand=city.demand,covered=city.cells.filter(c=>mapping.has(c.id));for(const origin of covered){if(!origin.people)continue;for(const destination of covered){if(origin.id===destination.id)continue;for(const p of demand.profiles){const people=demand.trips(origin,destination,p);if(people<=0)continue;yield {origin:origin.id,destination:destination.id,purpose:p.purpose,back:false,people};yield {origin:destination.id,destination:origin.id,purpose:p.purpose,back:true,people};}}}}

function local(point,radius=.8){return D.local(create(),point,radius);}
function localLegacy(point,radius=.8){const out={people:0,jobs:0,shops:0,industry:0,leisure:0,cells:0,area:Math.PI*radius*radius,factory:0,surveyArea:0,populationArea:0};for(const c of create().cells)if(R.distance(point,c)*DETOUR<=radius){for(const k of ['people','jobs','shops','industry','leisure','factory'])out[k]+=c[k];out.cells++;out.surveyArea+=c.survey*c.area;if(c.populationValid)out.populationArea+=c.area;}return out;}
function assign(s){if(s.routeModel===9)return D.assign(s,create());return assignLegacy(s);}
function assignLegacy(s){const served=[...new Set((s.routeModel===9?X.expand(s).services:s.services).flatMap(l=>l.callStops||l.stops))].map(id=>s.nodes[id]),stations=Object.fromEntries(served.map(n=>[n.id,{people:0,jobs:0,shops:0,industry:0,leisure:0,walk:0,cells:0}]));let covered=0;const mapping=new Map();
 for(const c of create().cells){let closest=null,best=WALK;for(const n of served){const d=R.distance(c,n)*DETOUR;if(d<best){best=d;closest=n;}}if(!closest)continue;mapping.set(c.id,{id:closest.id,walk:best});const st=stations[closest.id];for(const k of ['people','jobs','shops','industry','leisure'])st[k]+=c[k];st.walk+=best*c.people;st.cells++;covered+=c.people;}
 for(const st of Object.values(stations))st.walk=st.people?st.walk/st.people:0;return {stations,mapping,covered,total:create().totals.people};
}
function evaluate(s){if(s.routeModel===9)return D.evaluate(s,create());return evaluateLegacy(s);}
function evaluateLegacy(s){if(!s.services.length){const city=create();return {city:true,flows:[],trackFlow:{},trackLoad:{},serviceFlow:{},riders:0,unserved:0,totalTrips:city.totals.people*1.6,uncoveredTrips:city.totals.people*1.6,purposeTotals:{work:0,shopping:0,leisure:0},catchment:{stations:{},mapping:new Map(),covered:0,total:city.totals.people},population:city.totals.people,jobs:city.totals.jobs};}const catchment=assign(s),ids=Object.keys(catchment.stations).map(Number),adj=R.network(s),paths=s.routeModel===9?{}:Object.fromEntries(ids.map(id=>[id,R.paths(s,adj,id)])),flows=[],grouped=new Map();const purposeTotals={work:0,shopping:0,leisure:0};let totalTrips=create().totals.people*1.6,uncoveredTrips=totalTrips;
 // Evaluate only covered pairs from the fixed city-wide distribution; no random sampling gaps on short lines.
 for(const c of journeys(catchment.mapping)){uncoveredTrips-=c.people;const a=catchment.mapping.get(c.origin),b=catchment.mapping.get(c.destination);if(a.id===b.id)continue;const key=[a.id,b.id,c.purpose,c.back].join('|'),g=grouped.get(key)||{from:a.id,to:b.id,purpose:c.purpose,back:c.back,people:0,walk:0};g.people+=c.people;g.walk+=(a.walk+b.walk)*c.people;grouped.set(key,g);}
 for(const g of grouped.values()){const key=g.from+':'+g.purpose;if(s.routeModel===9&&!paths[key])paths[key]=R.paths(s,adj,g.from,1/X.VOT[g.purpose]);const path=(s.routeModel===9?paths[key]:paths[g.from])?.[g.to];if(!path?.edges.length)continue;const km=R.distance(s.nodes[g.from],s.nodes[g.to]),walk=g.walk/g.people*1000/80,road=8+km/23*60*1.22,rail=path.minutes+walk,share=s.routeModel===9?X.modeShare({purpose:g.purpose,minutes:path.minutes,walk,fare:path.fare,km}).share:.93/(1+Math.exp(Math.max(-40,Math.min(40,(rail+path.fare*.045-road-8)/8)))),trips=g.people*share;if(trips<.1)continue;flows.push({from:g.from,to:g.to,trips,demandTrips:trips,path,road,rail,purpose:g.purpose,back:g.back,walk,population:g.people});purposeTotals[g.purpose]+=trips;}
 const trackFlow={},serviceFlow={},trackLoad={};for(const f of flows)for(const e of f.path.edges)for(const id of e.tracks||[e.track])trackFlow[id]=(trackFlow[id]||0)+f.trips;
 for(const t of s.tracks){const cap=(s.routeModel===9?X.expand(s).services:s.services).filter(l=>l.trackIds.includes(t.id)).reduce((v,l)=>v+60/R.effectiveHeadway(s,l)*R.capacity(l),0);trackLoad[t.id]=(trackFlow[t.id]||0)*.18/Math.max(1,cap);}
 let riders=0,unserved=0;for(const f of flows){const ratio=Math.min(1,...f.path.edges.map(e=>1/Math.max(1,Math.max(...(e.tracks||[e.track]).map(id=>trackLoad[id]||0)))));f.trips*=ratio;riders+=f.trips;unserved+=f.demandTrips-f.trips;for(const id of new Set(f.path.edges.flatMap(e=>s.routeModel===9?e.parts.map(p=>p.line):[e.service])))serviceFlow[id]=(serviceFlow[id]||0)+f.trips;}
 return {city:true,flows,trackFlow,trackLoad,serviceFlow,riders,unserved,totalTrips,uncoveredTrips,purposeTotals,catchment,population:create().totals.people,jobs:create().totals.jobs};
}
// Each profile integrates to 1 over a complete day; commute directions peak at different times.
function profile(purpose,back,minute,externalKind=null){const h=((minute%1440)+1440)%1440/60;let w;
 if(externalKind?.startsWith('staff'))return profile('work',externalKind==='staff-homebound',minute);
 if(externalKind){const departure=externalKind==='local-departure'||externalKind==='visitor-return',peak=departure?(h>=5&&h<10):(h>=16&&h<22),hours=departure?5:6;return (peak?3:1)/(hours*3+24-hours)/60;}
 if(purpose==='work')w=back?(h>=17&&h<21?.18:h>=12&&h<14?.06:.008):(h>=6&&h<10?.19:h>=10&&h<12?.04:.008);
 else if(purpose==='shopping')w=h>=10&&h<21?.08:.008;
 else w=h>=9&&h<22?.07:.008;
 const norm=purpose==='work'?(back?4*.18+2*.06+18*.008:4*.19+2*.04+18*.008):purpose==='shopping'?11*.08+13*.008:13*.07+11*.008;return w/norm/60;
}
const api={create,journeys,local,assign,evaluate,profile,CELL,AREA,WALK,DETOUR};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RailCity=api;
})(typeof globalThis!=='undefined'?globalThis:this);
