/* One native runtime per simulation worker; no cloned game world or second JS simulation. */
(function(){
  'use strict';
  const node=typeof module!=='undefined'&&module.exports;
  let Core,send,listen;
  if(node){
    Core=require('./routing-wasm');
    const {parentPort}=require('node:worker_threads');
    send=(data,transfer)=>parentPort.postMessage(data,transfer);
    listen=fn=>parentPort.on('message',fn);
  }else{
    importScripts('value-wire.js?v=57','routing-wasm.js?v=59');Core=self.RailRouting;
    send=(data,transfer)=>self.postMessage(data,transfer);
    listen=fn=>{self.onmessage=e=>fn(e.data);};
  }
  const tokens=()=>({simulation:Core.simulationToken(),queue:Core.queueToken(),engine:Core.engineToken(),
    sampling:Core.samplingToken(),cycle:Core.cycleToken()});
  listen(async request=>{
    try{
      await Core.init();
      if(!['engine_cycle','engine_continue','engine_loop','engine_step','simulation_step','runtime_query'].includes(request.name))
        throw Error('Unknown simulation worker operation');
      Core.pinRuntime(!!request.retainRuntime);
      const result=Core.kernel(request.name,request.input,null,null,request.bytes);
      send({id:request.id,result,tokens:tokens(),status:Core.status()},[result.buffer]);
    }catch(error){send({id:request.id,error:error.message,tokens:tokens()});}
  });
})();
