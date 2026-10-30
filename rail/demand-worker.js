/* Demand never blocks map input. Worker caches the fixed city-wide OD distribution. */
importScripts('service-plan.js?v=13','engine.js?v=13','tokyo-data.js?v=9','hubs.js?v=13','demand-model.js?v=13','city.js?v=13');
onmessage=async({data:m})=>{try{await self.RailDataReady;postMessage({id:m.id,result:RailCity.evaluate(m.state)});}catch(e){postMessage({id:m.id,error:e.message});}};
