/* Structured cold transaction transport; model rules execute in Rust. */
(function(root){'use strict';const node=typeof module!=='undefined'&&module.exports;
function run(op,value){const Core=node?require('./routing-wasm'):root.RailRouting,Wire=node?require('./value-wire'):root.RailValueWire;const data=Wire.encode(value),input=new Float64Array(data.length+2);input.set([1,op]);input.set(data,2);return Wire.decode(Core.kernel('transaction_run',input)).value;}
const api={run};if(node)module.exports=api;else root.RailTransactions=api;
})(typeof globalThis!=='undefined'?globalThis:this);
