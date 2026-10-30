/* Shared view geometry: projected data bounds, camera constraints and construction spacing. */
(function(root){'use strict';const node=typeof module!=='undefined'&&module.exports,R=node?require('./engine'):root.RailSim,G=node?require('./street-map'):root.StreetMap,N=node?require('./network'):root.RailNetwork;
function coverage(data,world){const lon1=data.lon0-data.stepLon/2,lon2=data.lon0+(data.cols-.5)*data.stepLon,lat1=data.lat0-data.stepLat/2,lat2=data.lat0+(data.rows-.5)*data.stepLat;const left=Math.max(25,(lon1-139.15)*2000+80),right=Math.min(world.width-25,(lon2-139.15)*2000+80),top=Math.max(25,(36.04-lat1)*2470+60),bottom=Math.min(world.height-25,(36.04-lat2)*2470+60),a=G.display({x:left,y:top}),b=G.display({x:right,y:bottom});return {x:a.x,y:a.y,w:b.x-a.x,h:b.y-a.y,model:{left,right,top,bottom}};}
function constrain(camera,zoom,aspect,bounds){const base=Math.max(bounds.w,bounds.h*aspect),minZoom=base/Math.min(bounds.w,bounds.h*aspect),z=Math.max(minZoom,Math.min(512,zoom)),w=base/z,h=w/aspect;return {zoom:z,minZoom,w,h,x:Math.max(bounds.x+w/2,Math.min(bounds.x+bounds.w-w/2,camera.x)),y:Math.max(bounds.y+h/2,Math.min(bounds.y+bounds.h-h/2,camera.y))};}
function resolve(s,p){return Number.isInteger(p)?s.nodes[p]:p;}
function segments(s,points){const X=node?require('./service-plan'):root.RailServicePlan;return X.draftLegs(s,points);}
function lineSegments(s,line){const X=node?require('./service-plan'):root.RailServicePlan;return line.trackIds.map((id,i)=>{const t=s.tracks.find(t=>t.id===id);return {from:s.nodes[line.stops[i]],to:s.nodes[line.stops[i+1]],km:t.km,points:X.trackPoints(s,t,line.stops[i])};});}
function formatDistance(km){return km<1?Math.round(km*1000)+' m':km.toFixed(2)+' km';}
function insertion(s,line,point){const existing=Number.isInteger(point),id=existing?point:s.nodes.length,model=existing?s:{...s,nodes:[...s.nodes,{...point,id}]},index=N.insertion(model,line,id),stops=[...line.stops];stops.splice(index,0,point);return {index,stops};}
function ease(t){return 1-Math.pow(1-Math.max(0,Math.min(1,t)),4);}
const api={lineSegments,coverage,constrain,resolve,segments,formatDistance,insertion,ease};if(node)module.exports=api;else root.RailView=api;
})(typeof globalThis!=='undefined'?globalThis:this);
