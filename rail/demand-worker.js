/* Demand never blocks map input. Worker caches the fixed city-wide OD distribution. */
importScripts('service-plan.js?v=12','engine.js?v=12','tokyo-data.js?v=9','hubs.js?v=12','demand-model.js?v=12','city.js?v=12');
onmessage=async({data:m})=>{try{await self.RailDataReady;postMessage({id:m.id,result:RailCity.evaluate(m.state)});}catch(e){postMessage({id:m.id,error:e.message});}};
