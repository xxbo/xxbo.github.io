const assert=require('node:assert/strict'),R=require('../rail/engine.js');
const s=R.newGame();assert(R.validate(s));
const m=R.evaluate(s);assert(m.riders>0&&m.share>0&&m.share<1);assert(m.saved>0);assert.equal(m.population,175500);assert(Math.abs(Object.values(m.accounts).reduce((v,a)=>v+a.revenue,0)-m.flows.reduce((v,f)=>v+f.trips*f.path.fare*90/1e6,0))<1e-7);
// Flat company fare is charged once per journey, including multi-stop rides.
const aoba=R.paths(s,R.network(s),14)[8];assert.equal(aoba.fare,220);assert(aoba.edges.length===3);
// Fare changes affect choices immediately but do not book cash until settlement.
const cheap=R.clone(s),expensive=R.clone(s);R.setFare(cheap,'aoba',100);R.setFare(expensive,'aoba',500);assert(R.evaluate(cheap).accounts.aoba.boardings>R.evaluate(expensive).accounts.aoba.boardings);assert.equal(cheap.companies[0].cash,s.companies[0].cash);
// Independent accounts conserve ticket revenue; capital is booked only once.
const b=R.clone(s),before=b.companies.map(c=>c.cash),q=R.quoteBuild(b,'aoba',[14,21]);assert(!q.error);const built=R.build(b,'aoba',[14,21]);assert(!built.error);assert.equal(b.companies[0].cash,Math.round((before[0]-q.cost)*100)/100);assert.equal(b.companies[1].cash,before[1]);assert.equal(b.companies[2].cash,before[2]);const cash=b.companies[0].cash;R.step(b);const l=b.companies[0].ledger[0];assert.equal(l.capital,q.cost);assert(Math.abs(b.companies[0].cash-(cash+l.profit))<.02);assert(R.validate(b));
// Invalid construction has no financial or network side effects.
const invalid=R.clone(s),original=JSON.stringify(invalid);assert(R.build(invalid,'aoba',[14,14]).error);assert.equal(JSON.stringify(invalid),original);assert(R.build(invalid,'aoba',[14,14]).error);
// Through service pays both partners, joins actual tracks, and reduces transfers.
const t=R.clone(s),r=R.through(t,t.services[1].id,t.services[2].id);assert(!r.error);assert.equal(t.companies[0].cash,s.companies[0].cash-12);assert.equal(t.companies[1].cash,s.companies[1].cash-12);assert.equal(t.companies[2].cash,s.companies[2].cash);assert.deepEqual(R.trackOwners(t,r.line),['aoba','metro']);const route=R.paths(t,R.network(t),14)[7];assert.equal(route.transfers,0);assert.equal(route.fare,(220+200)*.85);assert(R.through(t,t.services[1].id,t.services[2].id).error);assert.equal(R.paths(t,R.network(t),14)[8].fare,220);assert(R.validate(t));
// All services share physical track slots; an impossible edit is rejected atomically.
const limits=R.clone(t);assert(!R.setHeadway(limits,limits.services[1].id,4).error);assert(!R.setHeadway(limits,r.line.id,4).error);const prev=limits.services[1].headway;assert(R.setHeadway(limits,limits.services[1].id,3).error);assert.equal(limits.services[1].headway,prev);
// Overloaded demand is rationed rather than printed as carried passengers.
const heavy=R.clone(s);heavy.nodes.forEach(n=>n.people*=30);const hm=R.evaluate(heavy);assert(hm.unserved>0);assert(hm.riders<hm.demanded);assert(Object.values(hm.accounts).every(a=>Number.isFinite(a.revenue)&&a.revenue>=0));
// Growth respects the migration budget and housing capacity; disconnected farmland stays put.
const g=R.clone(s),old=g.nodes.map(n=>n.people);R.step(g);assert(g.nodes.reduce((sum,n)=>sum+n.growth,0)<=2400);assert.equal(g.nodes[21].people,old[21]);assert(g.nodes.every(n=>n.people<=n.housing));const rural=R.newGame();R.build(rural,'aoba',[15,16,5]);R.step(rural);assert(rural.nodes[15].growth>0);
// Never execute or render imported metadata with unvalidated identities.
const bad=R.clone(s);bad.companies[0].name='<img onerror=alert(1)>';assert(!R.validate(bad));const bad2=R.clone(s);bad2.services[0].trackIds[0]='missing';assert(!R.validate(bad2));assert(!R.validate({version:1}));
for(let i=0;i<12;i++)R.step(t);assert(R.validate(t));assert(t.companies.every(c=>c.ledger.length===12));
// Dedicated parallel tracks increase physical capacity; cheap borrowing creates no extra rail.
const own=R.newGame(),leased=R.newGame(),path=[14,13,12,8];
const qp=R.quoteBuild(own,'metro',path,'dedicated'),ql=R.quoteBuild(leased,'metro',path,'shared');assert(qp.cost>ql.cost*4);assert.equal(ql.newKm,0);assert(ql.sharedKm>0);
const oldTracks=own.tracks.length;const parallel=R.build(own,'metro',path,'dedicated');assert.equal(own.tracks.length,oldTracks+3);assert(parallel.line.trackIds.every(id=>own.tracks.find(t=>t.id===id).owner==='metro'));assert(R.validate(own));
R.build(leased,'metro',path,'shared');assert.equal(leased.tracks.length,oldTracks);assert(R.validate(leased));const lm=R.evaluate(leased);assert(lm.accounts.aoba.accessIncome>0);assert.equal(lm.accounts.aoba.accessIncome,lm.accounts.metro.accessCost);assert.equal(lm.accounts.jr.accessIncome,0);assert.equal(lm.accounts.jr.accessCost,0);
const lc=leased.companies.map(c=>c.cash);R.step(leased);for(let i=0;i<3;i++){const c=leased.companies[i],a=lm.accounts[c.id];assert(Math.abs(c.cash-(lc[i]+a.revenue+a.accessIncome-a.cost))<.02);}
const legacy=R.newGame();legacy.version=1;const migrated=R.upgrade(legacy);assert.equal(migrated.version,2);assert(R.validate(migrated));assert.equal(legacy.version,1);
console.log('Rail simulation: finance, fares, routing, through-service, capacity, growth and save validation passed.');
