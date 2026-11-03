/* Reuse equal coefficients, preserving catalog order and exact OD weights. */
(function(root){'use strict';
const indexes=new WeakMap();
function prepare(catalog){let c=indexes.get(catalog);if(c&&c.length===catalog.length)return c;const factors=[],profiles=[],fm=new Map(),pm=new Map(),fi=new Uint32Array(catalog.length),pi=new Uint32Array(catalog.length);
for(let i=0;i<catalog.length;i++){const j=catalog[i],ids=j.lineIds||Object.keys(j.path?.fares||{}),fk=JSON.stringify([ids,!!j.hub]),pk=JSON.stringify([j.purpose,j.back,j.externalKind||null]);if(!fm.has(fk)){fm.set(fk,factors.length);factors.push(j);}if(!pm.has(pk)){pm.set(pk,profiles.length);profiles.push(j);}fi[i]=fm.get(fk);pi[i]=pm.get(pk);}
c={length:catalog.length,factors,profiles,fi,pi,weights:new Float64Array(catalog.length)};indexes.set(catalog,c);return c;}
function calculate(catalog,factor,profile){const c=prepare(catalog),fv=c.factors.map(factor),pv=c.profiles.map(profile);let total=0;for(let i=0;i<catalog.length;i++)total+=c.weights[i]=catalog[i].daily*fv[c.fi[i]]*pv[c.pi[i]];return {weights:c.weights,total,factorGroups:c.factors.length,profileGroups:c.profiles.length};}
const api={calculate};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RailDemandRates=api;
})(typeof globalThis!=='undefined'?globalThis:this);
