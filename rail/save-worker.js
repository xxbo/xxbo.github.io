/* Local-only JSON encoding; the main thread captures the snapshot on postMessage. */
onmessage=({data:m})=>{try{postMessage({id:m.id,text:JSON.stringify(m.value)});}catch(e){postMessage({id:m.id,error:e.message});}};
