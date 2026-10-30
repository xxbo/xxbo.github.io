/* Decode and rasterize each vector tile away from the simulation thread. */
importScripts('vector-map.js?v=12');
onmessage=async({data:m})=>{try{const renderer={groups:m.groups},tile={...m.tile,layers:RailVectorMap.decode(m.data)},canvas=RailVectorMap.Layer.prototype.raster.call(renderer,tile),bitmap=canvas.transferToImageBitmap();postMessage({id:m.id,bitmap},[bitmap]);}catch(e){postMessage({id:m.id,error:e.message});}};
