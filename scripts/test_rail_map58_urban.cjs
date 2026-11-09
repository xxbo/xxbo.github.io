const assert=require('node:assert/strict'),U=require('../rail/urban-growth'),Old=require('./fixtures/rail-map57-urban-growth.cjs'),N=require('../rail/network'),M=require('../rail/management'),C=require('../rail/city'),Names=require('../rail/place-names');
let checks=0;
const exact=(a,b,label)=>{function diff(a,b,path){if(Object.is(a,b))return;if(a&&b&&typeof a==='object'&&typeof b==='object'){const ak=Object.keys(a),bk=Object.keys(b);if(JSON.stringify(ak)!==JSON.stringify(bk))return `${path} keys ${ak.slice(0,20)} vs ${bk.slice(0,20)}`;for(const k of ak){const d=diff(a[k],b[k],path+'.'+k);if(d)return d;}}else return `${path}: ${a} vs ${b}`;}const d=diff(a,b,label);if(d)throw Error(d);};
for(const region of ['gba','tokyo'])for(const automatic of [false,true]){
 const s=M.init(N.upgrade(N.emptyWorld(region))),base=C.create(region);U.init(s);
 if(automatic){U.enableAutomatic(s,base,Names.places(region));U.enableDevelopment(s,base,Names.places(region));}
 const p=Names.places(region).find(p=>U.buildable(s,base,p));
 N.addLine(s,[{x:p.x-30,y:p.y},{x:p.x,y:p.y},{x:p.x+30,y:p.y}],{stockSpec:'6B'});
 if(!automatic)U.plan(s,base,'school',p);
 const old=structuredClone(s);console.log("case",region,automatic);
 for(let step=0;step<32;step++){
  for(const point of [p,...s.nodes.slice(0,3)]){exact(U.zone(s,point),Old.zone(old,point),`zone ${region}/${automatic}/${step}`);checks++;}
  assert.equal(U.step(s,base),Old.step(old,base),`growth ${region}/${automatic}/${step}`);
  exact(s,old,`world ${region}/${automatic}/${step}`);
  exact(U.city(s,base),Old.city(old,base));checks++;if(step%8===0)console.log("step",step);
 }
}
console.log(`MAP58: ${checks} exact urban zone, growth, complete state and city-view checks on both maps, manual/automatic facilities and finite development budgets.`);
