/* Synthetic urban density and purpose-specific OD demand. Geography is real; density values are game parameters. */
(function(root){'use strict';
const R=typeof module!=='undefined'&&module.exports?require('./engine'):root.RailSim;
const T=typeof module!=='undefined'&&module.exports?require('./tokyo'):root.TokyoRegion;
const CELL=10,AREA=(CELL*.045)**2,WALK=.8,DETOUR=1.25;
let cached;
function create(){if(cached)return cached;const seed=T.create(R).nodes,map=new Map();
 for(const n of seed){const radius=n.hub?85:n.type==='住宅'?50:40;for(let x=Math.floor((n.x-radius)/CELL)*CELL;x<=n.x+radius;x+=CELL)for(let y=Math.floor((n.y-radius)/CELL)*CELL;y<=n.y+radius;y+=CELL){if(x<25||y<25||x>2870||y>2070)continue;const d=Math.hypot(x-n.x,y-n.y),w=Math.exp(-d*d/(radius*radius*.38));if(w<.04)continue;const key=x+':'+y,c=map.get(key)||{id:key,x,y,people:0,jobs:0,shops:0,industry:0,leisure:0};c.people+=n.people*w/35;c.jobs+=n.jobs*w/35;c.shops+=(n.type==='商业'?n.jobs:n.jobs*.08)*w/35;c.industry+=(n.type==='工业'?n.jobs:n.jobs*.015)*w/35;c.leisure+=(n.type==='田园'||n.type==='教育'?n.people*.8:n.type==='商业'?n.jobs*.25:n.people*.07)*w/35;map.set(key,c);}}
 // Exclude the open bay; preserve airport reclaimed land and station-side coast catchments.
 const bay=[[139.80,35.60],[139.80,35.64],[139.90,35.64],[140.04,35.61],[140.08,35.50],[139.91,35.30],[139.73,35.36],[139.72,35.49],[139.79,35.55]];
 const inside=(x,y)=>{let hit=false;for(let i=0,j=bay.length-1;i<bay.length;j=i++)if((bay[i][1]>y)!==(bay[j][1]>y)&&x<(bay[j][0]-bay[i][0])*(y-bay[i][1])/(bay[j][1]-bay[i][1])+bay[i][0])hit=!hit;return hit;};
 const cells=[...map.values()].filter(c=>!inside(139.15+(c.x-80)/2000,36.04-(c.y-60)/2470)||seed.some(n=>Math.hypot(n.x-c.x,n.y-c.y)<12));
 const totals=cells.reduce((a,c)=>{for(const k of ['people','jobs','shops','industry','leisure'])a[k]=(a[k]||0)+c[k];return a;},{}),targets={people:12000000,jobs:6500000,shops:1700000,industry:1000000,leisure:1000000};for(const c of cells)for(const k of Object.keys(targets))c[k]=Math.round(c[k]/totals[k]*targets[k]);
 const at=new Map(cells.map(c=>[c.id,c])),destinations=seed.map(n=>({node:n,cell:at.get(Math.round(n.x/CELL)*CELL+':'+Math.round(n.y/CELL)*CELL)||cells.reduce((a,c)=>R.distance(c,n)<R.distance(a,n)?c:a,cells[0])})),cohorts=[];
 function random(text){let h=2166136261;for(const ch of text)h=Math.imul(h^ch.charCodeAt(0),16777619);return (h>>>0)/4294967296;}
 const profiles=[{purpose:'work',rate:.52,decay:14},{purpose:'shopping',rate:.16,decay:5},{purpose:'leisure',rate:.12,decay:10}];
 const weightCache=new Map();
 for(const c of cells)for(const p of profiles){const bucket=Math.floor(c.x/40)+':'+Math.floor(c.y/40)+':'+p.purpose;let distribution=weightCache.get(bucket);if(!distribution){const weights=destinations.map(({node:n})=>{const opportunity=p.purpose==='work'?n.jobs:p.purpose==='shopping'?(n.type==='商业'?n.jobs:n.jobs*.06):(n.type==='教育'||n.type==='田园'?n.people:n.type==='商业'?n.jobs*.3:n.people*.05);return opportunity*Math.exp(-R.distance(c,n)/p.decay);}),sum=weights.reduce((a,b)=>a+b,0);distribution={weights,sum};weightCache.set(bucket,distribution);}const {weights,sum}=distribution;let target=random(c.id+p.purpose)*sum,index=0;while(index<weights.length-1&&target>weights[index])target-=weights[index++];const d=destinations[index].cell,people=c.people*p.rate;if(people<=0)continue;cohorts.push({origin:c.id,destination:d.id,purpose:p.purpose,back:false,people});cohorts.push({origin:d.id,destination:c.id,purpose:p.purpose,back:true,people});}
 cached={cells,cohorts,totals:cells.reduce((a,c)=>{for(const k of Object.keys(targets))a[k]=(a[k]||0)+c[k];return a;},{}),cell:CELL,area:AREA};return cached;
}
function local(point,radius=.8){const totals={people:0,jobs:0,shops:0,industry:0,leisure:0,cells:0,area:Math.PI*radius*radius};for(const c of create().cells)if(R.distance(point,c)*DETOUR<=radius){for(const k of ['people','jobs','shops','industry','leisure'])totals[k]+=c[k];totals.cells++;}return totals;}
function assign(s){const served=[...new Set(s.services.flatMap(l=>l.stops))].map(id=>s.nodes[id]),stations=Object.fromEntries(served.map(n=>[n.id,{people:0,jobs:0,shops:0,industry:0,leisure:0,walk:0,cells:0}]));let covered=0;const mapping=new Map();
 for(const c of create().cells){let closest=null,best=WALK;for(const n of served){const d=R.distance(c,n)*DETOUR;if(d<best){best=d;closest=n;}}if(!closest)continue;mapping.set(c.id,{id:closest.id,walk:best});const st=stations[closest.id];for(const k of ['people','jobs','shops','industry','leisure'])st[k]+=c[k];st.walk+=best*c.people;st.cells++;covered+=c.people;}
 for(const st of Object.values(stations))st.walk=st.people?st.walk/st.people:0;return {stations,mapping,covered,total:create().totals.people};
}
function evaluate(s){const catchment=assign(s),ids=Object.keys(catchment.stations).map(Number),adj=R.network(s),paths=Object.fromEntries(ids.map(id=>[id,R.paths(s,adj,id)])),flows=[],grouped=new Map();const purposeTotals={work:0,shopping:0,leisure:0};let totalTrips=0,uncoveredTrips=0;
 // City OD cohorts exist before stations; rail coverage only changes how those journeys can be made.
 for(const c of create().cohorts){totalTrips+=c.people;const a=catchment.mapping.get(c.origin),b=catchment.mapping.get(c.destination);if(!a||!b){uncoveredTrips+=c.people;continue;}if(a.id===b.id)continue;const key=[a.id,b.id,c.purpose,c.back].join('|'),g=grouped.get(key)||{from:a.id,to:b.id,purpose:c.purpose,back:c.back,people:0,walk:0};g.people+=c.people;g.walk+=(a.walk+b.walk)*c.people;grouped.set(key,g);}
 for(const g of grouped.values()){const path=paths[g.from]?.[g.to];if(!path?.edges.length)continue;const km=R.distance(s.nodes[g.from],s.nodes[g.to]),walk=g.walk/g.people*1000/80,road=8+km/23*60*1.22,rail=path.minutes+walk,share=.93/(1+Math.exp(Math.max(-40,Math.min(40,(rail+path.fare*.045-road-8)/8)))),trips=g.people*share;if(trips<.1)continue;flows.push({from:g.from,to:g.to,trips,demandTrips:trips,path,road,rail,purpose:g.purpose,back:g.back,walk,population:g.people});purposeTotals[g.purpose]+=trips;}
 const trackFlow={},serviceFlow={},trackLoad={};for(const f of flows)for(const e of f.path.edges)trackFlow[e.track]=(trackFlow[e.track]||0)+f.trips;
 for(const t of s.tracks){const cap=s.services.filter(l=>l.trackIds.includes(t.id)).reduce((v,l)=>v+60/R.effectiveHeadway(s,l)*R.capacity(l),0);trackLoad[t.id]=(trackFlow[t.id]||0)*.18/Math.max(1,cap);}
 let riders=0,unserved=0;for(const f of flows){const ratio=Math.min(1,...f.path.edges.map(e=>1/Math.max(1,trackLoad[e.track]||0)));f.trips*=ratio;riders+=f.trips;unserved+=f.demandTrips-f.trips;for(const id of new Set(f.path.edges.map(e=>e.service)))serviceFlow[id]=(serviceFlow[id]||0)+f.trips;}
 return {city:true,flows,trackFlow,trackLoad,serviceFlow,riders,unserved,totalTrips,uncoveredTrips,purposeTotals,catchment,population:create().totals.people,jobs:create().totals.jobs};
}
// Each profile integrates to 1 over a complete day; commute directions peak at different times.
function profile(purpose,back,minute){const h=((minute%1440)+1440)%1440/60;let w;
 if(purpose==='work')w=back?(h>=17&&h<21?.18:h>=12&&h<14?.06:.008):(h>=6&&h<10?.19:h>=10&&h<12?.04:.008);
 else if(purpose==='shopping')w=h>=10&&h<21?.08:.008;
 else w=h>=9&&h<22?.07:.008;
 const norm=purpose==='work'?(back?4*.18+2*.06+18*.008:4*.19+2*.04+18*.008):purpose==='shopping'?11*.08+13*.008:13*.07+11*.008;return w/norm/60;
}
const api={create,local,assign,evaluate,profile,CELL,AREA,WALK,DETOUR};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RailCity=api;
})(typeof globalThis!=='undefined'?globalThis:this);
