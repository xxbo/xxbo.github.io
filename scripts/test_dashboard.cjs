// Cross-file initialization and route rendering without a browser; layout is not verified here.
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),data=JSON.parse(fs.readFileSync(path.join(root,'data/dashboard.json'),'utf8'));
const scripts=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script src="([^?]+)\?/g)].map(m=>m[1]);
async function check(snapshot){
 const nodes={},events={},listeners={},storage=new Map();let fetchCount=0;
 function element(id){return nodes[id]??={innerHTML:'',textContent:'',value:'',checked:false,hidden:false,open:false,isConnected:true,classList:{toggle(){},add(){},remove(){}},addEventListener(t,f){events[id+':'+t]=f},setAttribute(){},querySelector(){return null},focus(){},show(){this.open=true;this.mode='nonmodal'},removeAttribute(){},showModal(){this.open=true;this.mode='modal'},close(){this.open=false}};}
 element('#group-events').checked=true;
 const context={console,Date,URL,setTimeout:()=>0,clearTimeout(){},setInterval(){},fetch:async()=>{fetchCount++;return {ok:true,json:async()=>snapshot}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},document:{documentElement:{setAttribute(){}},querySelector:element,querySelectorAll:()=>[],getElementById:element,addEventListener(t,f){(listeners[t]??=[]).push(f)},body:{classList:{toggle(){},add(){},remove(){}}}},window:{scrollTo(){},addEventListener(){},matchMedia:()=>({matches:false})},location:{hash:'#/overview'}};
 vm.createContext(context);
 for(const f of scripts)vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),context,{filename:f});
 await new Promise(resolve=>setImmediate(resolve));
 assert(!element('#data-notice').textContent.includes('暂时无法读取快照'));
 assert(element('#home-feed').innerHTML.includes('feed-stream'));
 assert(element('#home-feed').innerHTML.includes('大盘概况'));
 const feedKeys=vm.runInContext('HomeFeed.compose(state.data,{watch:state.watch}).map(i=>i.key)',context);
 assert.equal(feedKeys.length,new Set(feedKeys).size,'one feed card per item');
 assert(storage.has('current:briefVisit'));
 if(snapshot.markets?.some(m=>m.asset_class==='rates')){const rate=snapshot.markets.find(m=>m.asset_class==='rates');context.location.hash='#/markets/'+rate.id;vm.runInContext('renderRoute(false)',context);assert(element('#detail-page').innerHTML.includes('OFFICIAL DAILY OBSERVATIONS'));assert(element('#detail-page').innerHTML.includes('基点')||element('#detail-page').innerHTML.includes('bp'));assert(!element('#detail-page').innerHTML.includes('ATR(14)'));}

 for(const route of ['#/global','#/research','#/research/new','#/changes','#/review']){context.location.hash=route;vm.runInContext('renderRoute(false)',context);assert(!element('#detail-page').innerHTML.includes('没有找到这个页面'),route);assert(element('#detail-page').innerHTML.length>100,route);}
 vm.runInContext("researchItems=[{id:'test-question',title:'Test research',topic:'growth',keywords:[],evidence:[],versions:[],reviews:[],created_at:new Date().toISOString()}]",context);context.location.hash='#/research/test-question';vm.runInContext('renderRoute(false)',context);assert(element('#detail-page').innerHTML.includes('Test research'));assert(element('#detail-page').innerHTML.includes('data-research-review'));vm.runInContext('researchItems=[]',context);context.location.hash='#/overview';vm.runInContext('renderRoute(false)',context);
 assert(element('#home-feed').innerHTML.includes('信息流筛选'));
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
 if(snapshot.calendar?.length){vm.runInContext("location.hash='#/calendar/'+encodeURIComponent(eventId(state.data.calendar[0]));renderRoute(false)",context);assert(element('#detail-page').innerHTML.includes(snapshot.calendar[0].record_type==='indicator'?'查看数据来源':'查看官方安排'));}
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

 assert.equal(vm.runInContext('newsImage({})',context),'');
 const positioned=vm.runInContext('readerBody({reader_text:"First\\n\\nSecond",images:[{url:"https://example.com/middle.jpg",after_paragraph:1}]})',context);assert(positioned.indexOf('First')<positioned.indexOf('middle.jpg'));assert(positioned.indexOf('middle.jpg')<positioned.indexOf('Second'));
 context.mediaArticle={source:'Example',images:[{url:'https://example.com/a.jpg',alt:'<script>bad</script>',caption:'<b>Caption</b>'},{url:'javascript:bad()'},{url:'https://example.com/a.jpg'}]};
 assert.equal(vm.runInContext('newsImages(mediaArticle).length',context),1);
 const mediaHTML=vm.runInContext('newsImage(mediaArticle,"detail")',context);
 assert(mediaHTML.includes('referrerpolicy="no-referrer"'));assert(!mediaHTML.includes('<script>'));assert(!mediaHTML.includes('<b>Caption</b>'));assert(mediaHTML.includes('&lt;b&gt;Caption'));
 if(snapshot.news?.length){
  context.location.hash='#/overview';vm.runInContext('readerDialog.close();closeSplitReader();renderRoute(false);openReader(state.data.news[0])',context);
  assert.equal(element('#reader-dialog').mode,'nonmodal','home details must leave the feed interactive');
  assert.equal(context.location.hash,'#/overview');assert(vm.runInContext('splitState.active',context));
  const market=snapshot.markets?.find(m=>m.asset_class!=='rates');
  if(market){context.panelMarket=market.id;vm.runInContext("openSplitRoute('#/markets/'+panelMarket+'/technical')",context);assert(element('#reader-content').innerHTML.includes('相对强弱'));vm.runInContext("handleDetailClick({target:{closest:s=>s==='[data-tech-overlay]'?{dataset:{techOverlay:'boll'}}:null}})",context);assert(element('#reader-content').innerHTML.includes('布林带叠加'));assert.equal(context.location.hash,'#/overview');}
  if(snapshot.calendar?.length){context.panelCalendar=snapshot.calendar[0].id;vm.runInContext("openSplitRoute('#/calendar/'+encodeURIComponent(panelCalendar))",context);assert(element('#reader-content').innerHTML.includes('经济日历'));vm.runInContext('readerBack()',context);assert(vm.runInContext('readerCurrent.type==="route"||readerCurrent.type==="article"',context));}
  vm.runInContext('closeSplitReader();readerDialog.close()',context);assert(!vm.runInContext('splitState.active',context));
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
