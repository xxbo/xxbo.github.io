/* Demand never blocks map input. Worker caches the fixed city-wide OD distribution. */
importScripts('service-plan.js?v=14','engine.js?v=14','tokyo-data.js?v=9','hubs.js?v=14','demand-model.js?v=15','city.js?v=14');
onmessage=async({data:m})=>{try{await self.RailDataReady;postMessage({id:m.id,result:RailCity.evaluate(m.state)});}catch(e){postMessage({id:m.id,error:e.message});}};
