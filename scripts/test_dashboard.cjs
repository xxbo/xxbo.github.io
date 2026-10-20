// Cross-file initialization and route rendering without a browser; layout is not verified here.
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),data=JSON.parse(fs.readFileSync(path.join(root,'data/dashboard.json'),'utf8'));
const scripts=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script src="([^?]+)\?/g)].map(m=>m[1]);
async function check(snapshot){
 const nodes={},events={},listeners={},storage=new Map();let fetchCount=0;
 function element(id){return nodes[id]??={innerHTML:'',textContent:'',value:'',checked:false,hidden:false,open:false,isConnected:true,classList:{toggle(){},add(){},remove(){}},addEventListener(t,f){events[id+':'+t]=f},setAttribute(){},querySelector(){return null},focus(){},showModal(){this.open=true},close(){this.open=false}};}
 element('#group-events').checked=true;
 const context={console,Date,URL,setTimeout:()=>0,clearTimeout(){},setInterval(){},fetch:async()=>{fetchCount++;return {ok:true,json:async()=>snapshot}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},document:{querySelector:element,querySelectorAll:()=>[],getElementById:element,addEventListener(t,f){(listeners[t]??=[]).push(f)},body:{classList:{toggle(){},add(){},remove(){}}}},window:{scrollTo(){},addEventListener(){},matchMedia:()=>({matches:false})},location:{hash:'#/overview'}};
 vm.createContext(context);
 for(const f of scripts)vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),context,{filename:f});
 await new Promise(resolve=>setImmediate(resolve));
 assert(!element('#data-notice').textContent.includes('暂时无法读取快照'));
 assert(element('#assistant-brief').innerHTML.includes('YOUR DAILY BRIEF'));
 assert(element('#home-topics').innerHTML.includes('topic-card'));assert(element('#home-technical').innerHTML.includes('MARKET CONTEXT'));
 const homeKeys=vm.runInContext('state.homePickedIds',context);assert.equal(homeKeys.length,new Set(homeKeys).size,'home article IDs must not repeat across sections');
 assert(storage.has('current:briefVisit'));assert(element('#personal-reading').innerHTML.includes('YOUR READING DESK'));
 for(const [route,expected] of [['#/preferences','YOUR READING PREFERENCES'],['#/events','EVENT TRACKER'],['#/health','DATA RELIABILITY'],['#/topics/chips','近期变化与报道'],['#/calendar','来源覆盖与状态']]){
  context.location.hash=route;vm.runInContext('renderRoute(false)',context);assert(element('#detail-page').innerHTML.includes(expected),route);
 }
 if(snapshot.markets?.length){
  vm.runInContext("location.hash='#/markets/'+encodeURIComponent(state.data.markets[0].id)+'/technical';renderRoute(false)",context);
  assert(element('#detail-page').innerHTML.includes('READ THE CONTEXT'));
  assert(element('#detail-page').innerHTML.includes('相对强弱'));
  assert(element('#detail-page').innerHTML.includes('近期信息背景与待验证节点'));
  vm.runInContext("contextCompareChoices[state.data.markets[0].id]='usIXIC';contextComparePeriod=60;renderRoute(false)",context);
  assert(element('#detail-page').innerHTML.includes('跨市场观察'));
 }
 if(snapshot.calendar?.length){vm.runInContext("location.hash='#/calendar/'+encodeURIComponent(eventId(state.data.calendar[0]));renderRoute(false)",context);assert(element('#detail-page').innerHTML.includes('查看官方安排'));}
 if(snapshot.events?.length){
  vm.runInContext("location.hash='#/events/'+encodeURIComponent(state.data.events[0].id);renderRoute(false)",context);assert(element('#detail-page').innerHTML.includes('报道时间线'));assert(storage.has('current:eventSeen'));
  vm.runInContext('openEventReader(state.data.events[0])',context);assert(element('#reader-content').innerHTML.includes('接下来观察什么'));assert(element('#reader-dialog').open);
  const follow={dataset:{followEvent:snapshot.events[0].id}};
  for(const handler of listeners.click||[])handler({button:0,target:{closest:s=>s==='[data-follow-event]'?follow:null}});
  assert.equal(Object.keys(JSON.parse(storage.get('current:eventFollows'))).length,1);
  assert(vm.runInContext('!EventTrack.unread(state.data.events[0],eventSeen)',context));
  vm.runInContext('globalThis.originalSnapshot=state.data;state.data={...state.data,events:[],news:[]};eventSyncedData=null',context);
  assert(vm.runInContext('!!newsById(Object.values(eventStorage())[0].articles[0].id)',context));
  vm.runInContext('openEventReader(Object.values(eventStorage())[0])',context);
  assert(element('#reader-content').innerHTML.includes('已超出当前快照'));
  vm.runInContext('state.data=originalSnapshot;eventSyncedData=null',context);
  for(const handler of listeners.click||[])handler({button:0,target:{closest:s=>s==='[data-follow-event]'?follow:null}});
  assert.equal(Object.keys(JSON.parse(storage.get('current:eventFollows'))).length,0);
 }
 if(snapshot.news?.length){
  vm.runInContext('readingProfile=Reading.clean({});openReader(state.data.news[0])',context);assert(element('#reader-content').innerHTML.includes('reader-title'));assert(element('#reader-content').innerHTML.includes('少看这类'));
  if(snapshot.news.length>1){vm.runInContext('readerQueue=state.data.news.slice(0,3).map(n=>n.id);openReader(state.data.news[0],{keepQueue:true});readerMove(1)',context);assert.equal(vm.runInContext('readerArticle.id',context),snapshot.news[1].id);vm.runInContext('readerBack()',context);assert.equal(vm.runInContext('readerArticle.id',context),snapshot.news[0].id);vm.runInContext('readingProfile=Reading.clean({});openReader(state.data.news[0])',context);}
  const first=JSON.parse(storage.get('current:readingProfile'));assert.equal(first.reads.length,1);assert(!JSON.stringify(first).includes(snapshot.news[0].title));
  vm.runInContext('openReader(state.data.news[0])',context);assert.equal(JSON.parse(storage.get('current:readingProfile')).reads.length,1);
  for(const handler of listeners.change||[])handler({target:{id:'reading-learning',checked:false,matches:()=>false}});
  if(snapshot.news.length>1)vm.runInContext('openReader(state.data.news[1])',context);assert.equal(JSON.parse(storage.get('current:readingProfile')).reads.length,1);
  const feedback={dataset:{readingArticle:snapshot.news[0].id,readingAction:'-1'}};
  for(const handler of listeners.click||[])handler({button:0,target:{closest:s=>s==='[data-reading-action]'?feedback:null}});
  assert.equal(Object.values(JSON.parse(storage.get('current:readingProfile')).feedback)[0].value,-1);
  vm.runInContext("location.hash='#/preferences';renderRoute(false)",context);assert(element('#detail-page').innerHTML.includes('少看这类'));
  const clear={dataset:{readingClear:'all'}};
  for(const handler of listeners.click||[])handler({button:0,target:{closest:s=>s==='[data-reading-clear]'?clear:null}});
  const reset=JSON.parse(storage.get('current:readingProfile'));assert.equal(reset.reads.length,0);assert.equal(Object.keys(reset.feedback).length,0);assert.equal(reset.learning,false);
  assert.equal(fetchCount,1,'preference actions must not upload data or fetch analytics');
 }

}
(async()=>{await check(data);await check({generated_at:new Date().toISOString(),markets:[],news:[],calendar:[],sources:[]});console.log('Dashboard initialization, health/topics/calendar routes, reader and empty-data checks passed.');})().catch(e=>{console.error(e);process.exit(1)});
