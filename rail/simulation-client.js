/* Serial, transferable numeric transactions. UI objects stay on the main thread. */
(function(root){
  'use strict';
  const node=typeof module!=='undefined'&&module.exports;
  const Core=node?require('./routing-wasm'):root.RailRouting;
  function create(options={}) {
    let worker=null,closed=false,serial=0,active=null,tail=Promise.resolve(),local=!!options.forceLocal;
    const transport={requests:0,inputBytes:0,outputBytes:0,maxInputBytes:0,maxOutputBytes:0};
    let tokens={simulation:0,queue:0,engine:0,sampling:0,cycle:0};
    function fail(error){if(active){const p=active;active=null;clearTimeout(p.timer);p.reject(error);}worker?.terminate();worker=null;closed=true;}
    function start(){
      if(worker)return;
      if(node){const {Worker}=require('node:worker_threads');worker=new Worker(require('node:path').join(__dirname,'simulation-worker.js'));}
      else worker=new Worker(new URL('simulation-worker.js?v=63',root.location.href));
      if(options.retainRuntime)Core.recycleSimulation();
      const receive=data=>{
        if(!active||data.id!==active.id)return;
        const p=active;active=null;clearTimeout(p.timer);tokens=data.tokens;
        if(data.result) {transport.outputBytes+=data.result.byteLength;transport.maxOutputBytes=Math.max(transport.maxOutputBytes,data.result.byteLength);}
        if(data.status)Core.reportWorkerStatus({...data.status,transport:{...transport}});
        if(data.error)p.reject(Error(data.error));else p.resolve(data.result);
      };
      if(node){worker.on('message',receive);worker.on('error',fail);worker.on('exit',code=>{if(!closed)fail(Error('Simulation worker exited: '+code));});}
      else {worker.onmessage=e=>receive(e.data);worker.onerror=e=>fail(Error(e.message||'模拟线程异常'));worker.onmessageerror=()=>fail(Error('模拟线程数据损坏'));}
    }
    function execute(request){
      if(closed)return Promise.reject(Error('模拟线程已关闭'));
      if(!local) {try{start();}catch(error){
        worker?.terminate();worker=null;
        local=true;options.retainRuntime=false;options.onLocal?.();
        // First transaction still contains a complete recovery frame. Select full view
        // projection when Worker isolation is unavailable, before native state commits.
        if(request.name==='engine_cycle'&&request.input[0]===2&&request.input[25]) {
          const v=request.input;v[25]=0;let at=30+v[9]+v[7]*3;
          for(let i=0;i<v[8];i++)at+=5+v[at+4];
          at+=v[12]+v[13]+v[10]+v[11];v[at]=v[at]===5?4:2;
        }
      }}
      if(local) {
        Core.pinRuntime(!!options.retainRuntime);
        const result=Core.kernel(request.name,request.input,null,null,request.bytes);
        tokens={simulation:Core.simulationToken(),queue:Core.queueToken(),engine:Core.engineToken(),sampling:Core.samplingToken(),cycle:Core.cycleToken()};
        return Promise.resolve(result);
      }
      return new Promise((resolve,reject)=>{
        const id=++serial;active={id,resolve,reject,timer:setTimeout(()=>fail(Error('后台模拟超时，已停止线程并保留最近存档')),options.timeout??30000)};
        const inputBytes=request.input.byteLength+(request.bytes?.byteLength||0);
        transport.requests++;transport.inputBytes+=inputBytes;transport.maxInputBytes=Math.max(transport.maxInputBytes,inputBytes);
        const transfer=[request.input.buffer];
        if(request.bytes)transfer.push(request.bytes.buffer);
        worker.postMessage({id,name:request.name,input:request.input,bytes:request.bytes,retainRuntime:!!options.retainRuntime},transfer);
      });
    }
    return {
      run(factory){
        const task=tail.then(async()=>{
          const generator=Core.withTokens(tokens,factory);
          let step=Core.withTokens(tokens,()=>generator.next());
          while(!step.done){
            const result=await execute(step.value);
            if(closed)throw Error('模拟线程已关闭');
            step=Core.withTokens(tokens,()=>generator.next(result));
          }
          return step.value;
        });
        tail=task.catch(()=>{});return task;
      },
      idle:()=>tail,
      close(){Core.reportWorkerStatus(null);closed=true;fail(Error('模拟线程已关闭'));},
      get tokens(){return {...tokens};}
    };
  }
  const api={create};
  if(node)module.exports=api;else root.RailSimulationClient=api;
})(typeof globalThis!=='undefined'?globalThis:this);
