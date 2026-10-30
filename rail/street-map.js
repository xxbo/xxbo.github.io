/* Web Mercator street tiles over the existing geographic save coordinates. No API key or backend. */
(function(root){'use strict';
const K=720000/256,originX=(139.15+180)/360*256-80/K;
const mercY=lat=>(1-Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))/Math.PI)/2*256;
const originY=mercY(36.04)-60/K;
function display(p){const lat=36.04-(p.y-60)/2470;return {x:p.x,y:(mercY(lat)-originY)*K};}
function model(p){const g=p.y/K+originY,lat=Math.atan(Math.sinh(Math.PI*(1-2*g/256)))*180/Math.PI;return {x:p.x,y:60+(36.04-lat)*2470};}
function latLon(p){return {lon:139.15+(p.x-80)/2000,lat:36.04-(p.y-60)/2470};}
function tileBox(z,x,y){const size=256*K/2**z;return {x:(x*256/2**z-originX)*K,y:(y*256/2**z-originY)*K,size};}
function tiles(view,screenWidth,max=18){const pixels=screenWidth/view.w,z=Math.max(5,Math.min(max,Math.round(Math.log2(K*pixels)))),size=256*K/2**z,x0=Math.floor((view.x/K+originX)*2**z/256),y0=Math.floor((view.y/K+originY)*2**z/256),x1=Math.floor(((view.x+view.w)/K+originX)*2**z/256),y1=Math.floor(((view.y+view.h)/K+originY)*2**z/256),out=[];for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)out.push({z,tx:x,ty:y,...tileBox(z,x,y)});return out;}
function scale(view,screenWidth){const px=screenWidth/view.w,lat=latLon(model({x:view.x+view.w/2,y:view.y+view.h/2})).lat,metersPerUnit=40075016.686*Math.cos(lat*Math.PI/180)/720000,target=100/px*metersPerUnit,base=10**Math.floor(Math.log10(target)),meters=[5,2,1].map(v=>v*base).find(v=>v<=target)||base;return {pixels:meters/metersPerUnit*px,label:meters>=1000?(meters/1000)+' km':meters+' m'};}
const sources={gsi:{url:'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png',max:18},osm:{url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',max:19}};
class Layer{
 constructor(el,status){this.el=el;this.status=status;this.source='gsi';this.cache=new Map();this.loaded=0;this.failed=0;this.serial=0;}
 setSource(source){if(source===this.source)return;this.source=source;this.serial++;this.loaded=0;this.failed=0;for(const img of this.cache.values()){img.onload=null;img.onerror=null;img.remove();}this.cache.clear();clearTimeout(this.timer);if(this.view)this.update(this.view,this.width);}
 update(view,width){this.view=view;this.width=width;const enabled=!!sources[this.source];this.el.hidden=!enabled;if(!enabled){this.status.hidden=true;return;}this.position();clearTimeout(this.timer);this.timer=setTimeout(()=>this.draw(),120);}
 position(){const v=this.view,px=this.width/v.w;for(const img of this.cache.values()){const t=img.tile;img.style.transform=`translate(${(t.x-v.x)*px}px,${(t.y-v.y)*px}px)`;img.style.width=img.style.height=(t.size*px+.5)+'px';}}
 draw(){const v=this.view,source=sources[this.source];if(!source)return;const needed=tiles(v,this.width,source.max),keys=new Set(needed.map(t=>`${t.z}/${t.tx}/${t.ty}`)),serial=this.serial;let pending=0;
 for(const t of needed){const key=`${t.z}/${t.tx}/${t.ty}`;let img=this.cache.get(key);if(!img){img=document.createElement('img');img.alt='';img.draggable=false;img.decoding='async';img.referrerPolicy='strict-origin-when-cross-origin';img.tile=t;img.dataset.tile=key;img.dataset.state='loading';img.onload=()=>{if(serial!==this.serial)return;img.dataset.state='loaded';this.loaded++;this.report();this.prune(keys);};img.onerror=()=>{if(serial!==this.serial)return;img.dataset.state='error';img.style.visibility='hidden';this.failed++;this.report();};this.cache.set(key,img);this.el.appendChild(img);img.src=source.url.replace('{z}',t.z).replace('{x}',t.tx).replace('{y}',t.ty);}if(img.dataset.state==='loading')pending++;}
 this.keys=keys;this.position();this.prune(keys);this.report(pending);}
 prune(){const keys=this.keys;if(!keys)return;const ready=[...keys].every(k=>this.cache.get(k)?.dataset.state==='loaded');for(const [key,img]of this.cache){const t=img.tile,v=this.view,out=t.x+t.size<v.x||t.x>v.x+v.w||t.y+t.size<v.y||t.y>v.y+v.h;if(!keys.has(key)&&(ready||out||this.cache.size>96)){img.onload=null;img.onerror=null;img.remove();this.cache.delete(key);}}}
 report(){const visible=[...(this.keys||[])].map(k=>this.cache.get(k)).filter(Boolean),failed=visible.filter(i=>i.dataset.state==='error').length,pending=visible.filter(i=>i.dataset.state==='loading').length;this.status.hidden=!failed&&!pending;this.status.textContent=failed?'街道底图未加载完整 · 可切换地图源':pending?'街道地图加载中…':'';}
 retry(){const source=this.source;this.source='';this.setSource(source);}
}
const api={display,model,latLon,tileBox,tiles,scale,Layer,sources};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.StreetMap=api;
})(typeof globalThis!=='undefined'?globalThis:this);
