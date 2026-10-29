/* Deterministic operating-day simulation, independent from quarterly forecasts. */
(function(root){
'use strict';
const R=typeof module!=='undefined'&&module.exports?require('./engine.js'):root.RailSim;
const DWELL=.6,CAPACITY=800,SPACING=2;
function service(s,id){return s.services.find(l=>l.id===id);}
function track(s,id){return s.tracks.find(t=>t.id===id);}
function routeTime(s,l){return l.trackIds.reduce((m,id)=>m+track(s,id).km/48*60+DWELL,0);}
function isOpen(l,minute){const day=((minute%1440)+1440)%1440;return day>=(l.open??0)&&day<(l.close??1440);}
function queueKey(id,dir,node){return id+'|'+dir+'|'+node;}
function demandGroups(s,metrics){
 const grouped=new Map();
 for(const f of metrics.flows){let from=f.from,current=null;
  for(const e of f.path.edges){const l=service(s,e.service);if(!l)continue;const ix=l.trackIds.findIndex((id,i)=>id===e.track&&((l.stops[i]===from&&l.stops[i+1]===e.to)||(l.stops[i+1]===from&&l.stops[i]===e.to))),dir=l.stops[ix]===from?1:-1;
   if(!current||current.service!==l.id||current.dir!==dir){if(current)add(current);current={service:l.id,dir,from,to:e.to,daily:f.demandTrips??f.trips};}else current.to=e.to;
   from=e.to;
  }
  if(current)add(current);
 }
 function add(g){if(g.from===g.to)return;const k=queueKey(g.service,g.dir,g.from)+'|'+g.to;const old=grouped.get(k);if(old)old.daily+=g.daily;else grouped.set(k,g);}
 return [...grouped.values()];
}
function create(s,metrics,start=420){
 const rt={minute:start-30,start:start-30,nextId:1,trains:[],departures:{},blocks:{},queues:{},groups:demandGroups(s,metrics),boarded:0,alighted:0,generated:0,dispatched:0,waitEvents:0,elapsed:0,events:[]};
 for(const [i,l]of s.services.entries())for(const dir of [1,-1])rt.departures[l.id+'|'+dir]={next:rt.start+(i%5)*.45+(dir===-1?R.effectiveHeadway(s,l)/2:0),count:0};
 advance(rt,s,30);return rt;
}
function peakFactor(minute){const h=(minute/60)%24;return h<6?.02:h<7?.07:h<9?.18:h<10?.1:h<16?.035:h<19?.13:h<22?.045:.015;}
function addDemand(rt,s,dt){
 const factor=peakFactor(rt.minute)/60;
 for(const g of rt.groups){const l=service(s,g.service);if(!l||!isOpen(l,rt.minute))continue;const key=queueKey(g.service,g.dir,g.from);const q=rt.queues[key]||(rt.queues[key]={});const amount=g.daily*factor*dt;q[g.to]=(q[g.to]||0)+amount;rt.generated+=amount;}
}
function board(rt,t){
 const q=rt.queues[queueKey(t.service,t.dir,t.stops[t.index])];if(!q)return;
 let remaining=t.capacity-t.onboard;
 for(const [dest,count]of Object.entries(q)){const take=Math.min(remaining,count);if(take<=0)continue;t.passengers[dest]=(t.passengers[dest]||0)+take;t.onboard+=take;rt.boarded+=take;q[dest]-=take;remaining-=take;if(remaining<1e-8)break;}
}
function unload(rt,t){const node=t.stops[t.index],n=t.passengers[node]||0;t.onboard-=n;rt.alighted+=n;delete t.passengers[node];}
function spawn(rt,s,l,dir,d){
 const loop=l.stops[0]===l.stops.at(-1),fleet=Math.ceil((routeTime(s,l)+1)/R.effectiveHeadway(s,l)-1e-8);
 if(loop&&d.count>=fleet)return;if(l.fleet&&rt.trains.filter(t=>t.service===l.id&&t.status!=='finished').length>=l.fleet)return;
 const t={id:'T'+String(rt.nextId++).padStart(3,'0'),service:l.id,dir,stops:[...l.stops],trackIds:[...l.trackIds],index:dir===1?0:l.stops.length-1,status:'dwell',ready:rt.minute+DWELL,onboard:0,capacity:R.capacity(l),passengers:{},progress:0,loop,departedAt:null,arriveAt:null,segment:null};
 rt.trains.push(t);d.count++;rt.dispatched++;
}
function tick(rt,s,dt){
 rt.minute+=dt;rt.elapsed+=dt;addDemand(rt,s,dt);
 for(const l of s.services)for(const dir of [1,-1]){const d=rt.departures[l.id+'|'+dir];if(!d)continue;if(rt.minute+1e-8>=d.next){if(isOpen(l,rt.minute))spawn(rt,s,l,dir,d);d.next+=R.effectiveHeadway(s,l);}}
 for(const t of rt.trains){
  const l=service(s,t.service);if(!l){t.status='finished';continue;}
  if(t.status==='moving'){
   t.progress=Math.min(1,(rt.minute-t.departedAt)/(t.arriveAt-t.departedAt));
   if(t.progress>=1-1e-8){t.index+=t.dir;t.status='dwell';t.ready=rt.minute+DWELL;t.progress=0;unload(rt,t);
    const terminal=t.dir===1?t.index===t.stops.length-1:t.index===0;
    if(terminal){if(t.loop&&isOpen(l,rt.minute)){t.index=t.dir===1?0:t.stops.length-1;t.ready=rt.minute+1;}else{rt.alighted+=t.onboard;t.onboard=0;t.status='finished';}}
   }
   continue;
  }
  if(t.status==='finished'||rt.minute<t.ready)continue;
  const ix=t.dir===1?t.index:t.index-1,id=t.trackIds[ix],tr=track(s,id);if(!tr){t.status='finished';continue;}
  const from=t.stops[t.index],to=t.stops[t.index+t.dir],block=id+'|'+(from===tr.a?1:-1),release=rt.blocks[block]||0;
  if(rt.minute<release){if(t.status!=='signal')rt.waitEvents++;t.status='signal';continue;}
  board(rt,t);rt.events.push({minute:rt.minute,track:id,direction:from===tr.a?1:-1,train:t.id,service:t.service});if(rt.events.length>2000)rt.events.shift();rt.blocks[block]=rt.minute+SPACING;t.status='moving';t.departedAt=rt.minute;t.arriveAt=rt.minute+tr.km/48*60;t.segment={track:id,from,to};t.progress=0;
 }
 rt.trains=rt.trains.filter(t=>t.status!=='finished');
}
function advance(rt,s,minutes){if(!Number.isFinite(minutes)||minutes<0||minutes>1440)throw Error('Invalid operation interval');let left=minutes;while(left>1e-9){const dt=Math.min(.1,left);tick(rt,s,dt);left-=dt;}return rt;}
function ease(p){const a=.16,v=1/(1-a);if(p<a)return v*p*p/(2*a);if(p>1-a)return 1-v*(1-p)*(1-p)/(2*a);return v*(p-a/2);}
function position(s,t){
 if(t.status!=='moving'){const n=s.nodes[t.stops[t.index]];return {x:n.x,y:n.y,angle:t.dir===1?0:180,speed:0,track:null};}
 const a=s.nodes[t.segment.from],b=s.nodes[t.segment.to],p=ease(t.progress),dx=b.x-a.x,dy=b.y-a.y,dist=Math.hypot(dx,dy),tr=track(s,t.segment.track);
 const parallels=s.tracks.filter(x=>R.key(x.a,x.b)===R.key(tr.a,tr.b)).sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true})),pair=parallels.findIndex(x=>x.id===tr.id),base=(pair-(parallels.length-1)/2)*9,canonical=t.segment.from===tr.a?1:-1,offset=base*canonical*(tr.a<tr.b?1:-1)+2.2;
 const ramp=t.progress<.16?t.progress/.16:t.progress>.84?(1-t.progress)/.16:1;
 return {x:a.x+dx*p-dy/dist*offset,y:a.y+dy*p+dx/dist*offset,angle:Math.atan2(dy,dx)*180/Math.PI,speed:48/(1-.16)*Math.max(0,ramp),track:tr.id};
}
function summary(rt){const waiting=Object.values(rt.queues).reduce((v,q)=>v+Object.values(q).reduce((a,b)=>a+b,0),0),onboard=rt.trains.reduce((v,t)=>v+t.onboard,0);return {active:rt.trains.length,moving:rt.trains.filter(t=>t.status==='moving').length,waiting,onboard,boarded:rt.boarded,alighted:rt.alighted,generated:rt.generated,signal:rt.trains.filter(t=>t.status==='signal').length};}
const api={create,advance,position,summary,demandGroups,routeTime,isOpen,CAPACITY,DWELL,SPACING};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RailOperations=api;
})(typeof globalThis!=='undefined'?globalThis:this);
