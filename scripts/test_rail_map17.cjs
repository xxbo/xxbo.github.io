const assert=require('node:assert/strict'),B=require('../rail/regions'),N=require('../rail/network'),C=require('../rail/city'),H=require('../rail/hubs'),M=require('../rail/management'),P=require('../rail/passengers'),Q=require('../rail/ridership'),R=require('../rail/engine'),F=require('../rail/currency'),BAL=require('../rail/game-balance');
const near=(a,b,t=.01)=>assert(Math.abs(a-b)<t,`${a} != ${b}`);
function corridor(region,id,targets){const s=M.init(N.emptyWorld(region)),h=H.forRegion(region).find(h=>h.id===id),build=M.change(s,x=>N.addLine(x,[h,...targets.map(([lon,lat])=>B.project(lat,lon,region))]));assert(!build.error);return {s,h,m:C.evaluate(s),build};}
const {s,h,m,build}=corridor('gba','szx',[[113.88,22.59],[113.94,22.54]]),st=m.hubStats.szx;
assert(st.riders>15000&&st.riders<st.landside);assert(st.corridorCapture>0&&st.corridorCapture<=BAL.HUB_CAPTURE_MAX);near(H.daily(h),61477000/366);assert(F.toCNY(build.quote.net)<1e8);
const visitorBudget=m.flows.filter(f=>f.hub==='szx'&&f.externalKind.startsWith('visitor')).reduce((a,f)=>a+f.population,0);assert(visitorBudget<=H.envelope(h).visitorArrivals*2+.01);
const dup=R.clone(s);N.addLine(dup,dup.services[0].stops);const dm=C.evaluate(dup);near(dm.hubStats.szx.corridorCapture,st.corridorCapture,1e-9);
const costly=R.clone(s);N.configure(costly,costly.services[0].id,{fareBands:[2000,2100,2200,2300,2400,2500]});assert(C.evaluate(costly).hubStats.szx.riders<st.riders);
const little=M.init(N.emptyWorld('gba'));N.addLine(little,[h,{x:h.x+2,y:h.y}]);assert(C.evaluate(little).hubStats.szx.corridorCapture<st.corridorCapture*.1);
assert.equal(C.evaluate(N.emptyWorld('gba')).hubStats.szx.riders,0);
const narita=corridor('tokyo','narita',[[140.30,35.78],[140.23,35.72]]);assert(narita.m.hubStats.narita.riders>3500);
// Actual cash settlement over five days, not forecast income or invented passengers.
s.economy.cash=F.fromCNY(2e6);const initial=s.economy.cash,rt=P.create(s,m,420,false);
for(let day=0;day<5;day++)assert(M.advance(s,rt,1440));
near(s.economy.operatingGrant,s.economy.revenue*BAL.GRANT_RATE,.1);near(s.economy.cash,initial+s.economy.revenue+s.economy.operatingGrant-s.economy.operating,.1);
const sum=P.summary(rt);near(sum.generated,sum.waiting+sum.onboard+sum.completed+sum.cancelled);near(s.ridership.records.totalCompleted,rt.completed);assert(rt.completed>10000);
const l=s.services[0],end=s.nodes[l.stops.at(-1)],extension=M.preview(s,x=>N.addStation(x,l.id,{x:end.x+22,y:end.y}));assert(extension.net<s.economy.cash-initial);assert(!M.change(s,x=>N.addStation(x,l.id,{x:end.x+22,y:end.y})).error);
// Empty networks and predicted rides do not earn development funding.
const empty=M.init(N.emptyWorld()),ert=P.create(empty,C.evaluate(empty),420,false);assert(M.advance(empty,ert,1440));assert.equal(empty.economy.operatingGrant,0);assert.equal(empty.economy.cash,M.INITIAL);
// Old saves receive the difference on currently owned assets once; loans/history stay intact.
const old=R.clone(narita.s);M.borrow(old,1e8);delete old.economy.balanceVersion;delete old.economy.operatingGrant;delete old.economy.infrastructureRebate;old.economy.revenue=777;
const before=old.economy.cash,loans=JSON.stringify(old.economy.loans),construction=old.economy.construction,maturity=JSON.stringify(old.ridership.lines);
const expected=old.tracks.reduce((v,t)=>v+t.km*(200e6-BAL.TRACK),0)+new Set(old.services.flatMap(l=>l.stops)).size*(80e6-BAL.STATION)+old.services.reduce((v,l)=>v+l.fleet*l.cars*(5e6-BAL.CAR),0);
M.init(old);near(old.economy.cash,before+expected);near(old.economy.infrastructureRebate,expected);assert.equal(old.economy.revenue,777);assert.equal(old.economy.construction,construction);assert.equal(JSON.stringify(old.economy.loans),loans);assert.equal(JSON.stringify(old.ridership.lines),maturity);
const once=old.economy.cash;M.init(old);near(old.economy.cash,once);const reload=R.clone(old);M.init(reload);near(reload.economy.cash,once);assert(M.validate(reload));
console.log('MAP17 passed: bounded corridor visitor allocation, no duplicated hub market/catchments, fare sensitivity, Tokyo/GBA hubs, actual-only development grants, five-day expansion, passenger/cash conservation, empty-network no reward and one-time asset repricing with preserved loans/history.');
console.log(JSON.stringify({szxHubRailDemand:st.riders,naritaHubRailDemand:narita.m.hubStats.narita.riders,fiveDayCompleted:rt.completed,fiveDayTicketsCNY:F.toCNY(s.economy.revenue),fiveDayDevelopmentCNY:F.toCNY(s.economy.operatingGrant),extensionCNY:F.toCNY(extension.net)}));
