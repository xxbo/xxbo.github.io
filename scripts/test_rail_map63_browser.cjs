/* Execute the actual page module order and WASM with browser globals, then perform user commands. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const dir=path.join(__dirname,'../rail'),html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
const context=vm.createContext({performance,console,URL,WebAssembly,Float64Array,Uint8Array,Uint32Array,TextEncoder,TextDecoder,Blob,Response,DecompressionStream,atob,setTimeout,clearTimeout,location:{href:'https://test.invalid/rail-city/index.html'},fetch:async url=>({ok:true,arrayBuffer:async()=>{const p=new URL(url).pathname.replace(/^\/rail-city\//,''),b=fs.readFileSync(path.join(dir,p));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);}})});context.self=context;
for(const [,src]of html.matchAll(/<script src="([^"]+)" defer><\/script>/g)){
 vm.runInContext(fs.readFileSync(path.join(dir,src.split('?')[0]),'utf8'),context,{filename:src});
 if(src.startsWith('management.js'))break;
}
(async()=>{
 await context.RailRoutingReady;
 const result=vm.runInContext(`(()=>{
 const N=RailNetwork,M=RailManagement,F=RailFleet,U=RailUrban,s=M.init(N.emptyWorld('gba'));
 const add=M.change(s,M.command('network','addLine',{points:[{x:600,y:500,nameSeed:.1},{x:640,y:500,nameSeed:.2}],options:{stockSpec:'6B'}}));
 if(add.error)throw Error(add.error);
 const cash=s.economy.cash,buy=M.change(s,M.command('fleet','purchase',{spec:'6B',count:4}));
 if(buy.error)throw Error(buy.error);
 const dispatch=M.change(s,M.command('network','configure',{id:add.id,values:{dispatch:{mode:'manual',manual:4,offPeak:4,peak:4}}}));
 if(dispatch.error)throw Error(dispatch.error);
 const facilities=M.change(s,M.command('facility','plan',{kind:'school',point:{x:700,y:600},land:true}));
 if(facilities.error)throw Error(facilities.error);
 const before=JSON.stringify(s),fail=M.change(s,M.command('fleet','purchase',{spec:'invalid',count:4}));
 if(!fail.error||before!==JSON.stringify(s))throw Error('browser rollback');
 return {stock:s.depot.stock['6B'],free:F.free(s,'6B'),spent:cash-s.economy.cash,expected:F.SPECS['6B'].price*4+U.TYPES.school.price[0],valid:N.validate(s)&&F.validate(s)&&M.validate(s),facility:s.urban.facilities[0].kind};
 })()`,context);
 assert.equal(result.stock,4);assert.equal(result.free,0);assert.equal(result.spent,result.expected);assert(result.valid);assert.equal(result.facility,'school');
 console.log('MAP63 browser page module order and actual WASM: paid construction, depot purchase/reservation, manual facilities, validation and exact failure rollback passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
