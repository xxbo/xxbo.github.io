/* Demand never blocks map input. Worker caches the fixed city-wide OD distribution. */
importScripts('game-balance.js?v=17','regions.js?v=16','gba-data.js?v=16','service-plan.js?v=14','engine.js?v=16','tokyo-data.js?v=9','hubs.js?v=16','demand-model.js?v=17','city.js?v=16');
onmessage=async({data:m})=>{try{await self.RailDataReady;postMessage({id:m.id,result:RailCity.evaluate(m.state)});}catch(e){postMessage({id:m.id,error:e.message});}};
