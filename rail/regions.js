/* Geographic frames in WGS84. Existing Tokyo save coordinates remain unchanged. */
(function(root){'use strict';
const sx=111.32*Math.cos(23*Math.PI/180)/.045,sy=111.32/.045;
const all={tokyo:{id:'tokyo',name:'东京首都圈',short:'东京',west:139.15,north:36.04,sx:2000,sy:2470,width:2900,height:2100,focus:{x:1240,y:940},defaultZoom:8,basemap:'gsi',saveKey:'guanchao-rail-game-v7',recordsKey:'guanchao-rail-personal-records-v1'},gba:{id:'gba',name:'粤港澳大湾区',short:'大湾区',west:111.3,north:24.6,sx,sy,width:Math.ceil(4.2*sx+160),height:Math.ceil(3.1*sy+120),focus:{lon:113.9,lat:22.85},defaultZoom:5,basemap:'esri',saveKey:'guanchao-rail-gba-game-v1',recordsKey:'guanchao-rail-gba-records-v1'}};
function get(id='tokyo'){return all[id]||all.tokyo;}
function project(lat,lon,id='tokyo'){const r=get(id);return {x:(lon-r.west)*r.sx+80,y:(r.north-lat)*r.sy+60};}
function latLon(p,id='tokyo'){const r=get(id);return {lon:r.west+(p.x-80)/r.sx,lat:r.north-(p.y-60)/r.sy};}
const api={all,get,project,latLon};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RailRegions=api;
})(typeof globalThis!=='undefined'?globalThis:this);
