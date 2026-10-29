const assert=require('node:assert/strict'),R=require('../rail/engine.js'),O=require('../rail/operations.js');
const s=R.newGame(),rt=O.create(s,R.evaluate(s));assert(Math.abs(rt.minute-420)<1e-6);assert(rt.trains.length>10);assert(rt.trains.some(t=>t.status==='moving'));assert(rt.trains.some(t=>t.onboard>0));
const moving=rt.trains.find(t=>t.status==='moving'&&t.progress>.2&&t.progress<.7),pos=O.position(s,moving),before=JSON.stringify(rt);O.advance(rt,s,0);assert.equal(JSON.stringify(rt),before);O.advance(rt,s,.5);const after=O.position(s,rt.trains.find(t=>t.id===moving.id));assert(Math.hypot(after.x-pos.x,after.y-pos.y)>1);assert(after.speed>0);
O.advance(rt,s,150);
const summary=O.summary(rt);assert(summary.boarded>1000);assert(summary.alighted>100);assert(Math.abs(summary.generated-(summary.waiting+summary.onboard+summary.alighted))<1e-5);assert(Math.abs(summary.boarded-summary.alighted-summary.onboard)<1e-5);assert(rt.trains.every(t=>t.onboard<=800+1e-6&&t.onboard>=-1e-6));
for(const t of rt.trains){const p=O.position(s,t);assert(Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1040&&p.y>=0&&p.y<=740);if(t.status!=='moving')assert.equal(p.speed,0);}
// Shared dispatch separation is physical-track based, independently in each direction.
const last={};for(const e of rt.events){const k=e.track+'|'+e.direction;if(last[k]!==undefined)assert(e.minute-last[k]>=O.SPACING-1e-6);last[k]=e.minute;}
// Ring fleets circulate rather than accumulating one new train every lap forever.
const ring=s.services[0],max=2*Math.ceil((O.routeTime(s,ring)+1)/ring.headway);assert(rt.trains.filter(t=>t.service===ring.id).length<=max);
// Same OD demand, denser departures launch more physical trains.
const slow=R.newGame(),fast=R.newGame();slow.services=slow.services.filter(l=>l.owner==='aoba');fast.services=fast.services.filter(l=>l.owner==='aoba');R.setHeadway(slow,slow.services[0].id,15);R.setHeadway(fast,fast.services[0].id,4);const sr=O.create(slow,R.evaluate(slow)),fr=O.create(fast,R.evaluate(fast));assert(fr.dispatched>sr.dispatched);assert(fr.trains.length>sr.trains.length);
// Independent parallel tracks get separate dispatch blocks and can run simultaneously.
const dual=R.newGame();const line=R.build(dual,'metro',[14,13,12,8],'dedicated').line,dr=O.create(dual,R.evaluate(dual));assert(dr.events.some(e=>line.trackIds.includes(e.track)));assert(dr.events.some(e=>dual.services[1].trackIds.includes(e.track)));
console.log('Operating simulation passed: positions, dwell, boarding, conservation, capacity, shared headways, loop fleets and parallel dispatch.');
