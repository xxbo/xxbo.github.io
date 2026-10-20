// Cross-file initialization and route rendering without a browser; layout is not verified here.
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),data=JSON.parse(fs.readFileSync(path.join(root,'data/dashboard.json'),'utf8'));
const scripts=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script src="([^?]+)\?/g)].map(m=>m[1]);
async function check(snapshot){
 const nodes={},events={},storage=new Map();
 function element(id){return nodes[id]??={innerHTML:'',textContent:'',value:'',checked:false,hidden:false,open:false,isConnected:true,classList:{toggle(){},add(){},remove(){}},addEventListener(t,f){events[id+':'+t]=f},setAttribute(){},querySelector(){return null},focus(){},showModal(){this.open=true},close(){this.open=false}};}
 element('#group-events').checked=true;
 const context={console,Date,URL,setTimeout:()=>0,clearTimeout(){},setInterval(){},fetch:async()=>({ok:true,json:async()=>snapshot}),localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},document:{querySelector:element,querySelectorAll:()=>[],getElementById:element,addEventListener(){},body:{classList:{toggle(){},add(){},remove(){}}}},window:{scrollTo(){},addEventListener(){},matchMedia:()=>({matches:false})},location:{hash:'#/overview'}};
 vm.createContext(context);
 for(const f of scripts)vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),context,{filename:f});
 await new Promise(resolve=>setImmediate(resolve));
 assert(!element('#data-notice').textContent.includes('暂时无法读取快照'));
 assert(element('#assistant-brief').innerHTML.includes('YOUR DAILY BRIEF'));
 assert(element('#home-topics').innerHTML.includes('topic-card'));
 assert(storage.has('current:briefVisit'));
 for(const [route,expected] of [['#/health','DATA RELIABILITY'],['#/topics/chips','近期变化与报道'],['#/calendar','来源覆盖与状态']]){
  context.location.hash=route;vm.runInContext('renderRoute(false)',context);assert(element('#detail-page').innerHTML.includes(expected),route);
 }
 if(snapshot.calendar?.length){vm.runInContext("location.hash='#/calendar/'+encodeURIComponent(eventId(state.data.calendar[0]));renderRoute(false)",context);assert(element('#detail-page').innerHTML.includes('查看官方安排'));}
 if(snapshot.news?.length){vm.runInContext('openReader(state.data.news[0])',context);assert(element('#reader-content').innerHTML.includes('reader-title'));}
}
(async()=>{await check(data);await check({generated_at:new Date().toISOString(),markets:[],news:[],calendar:[],sources:[]});console.log('Dashboard initialization, health/topics/calendar routes, reader and empty-data checks passed.');})().catch(e=>{console.error(e);process.exit(1)});
