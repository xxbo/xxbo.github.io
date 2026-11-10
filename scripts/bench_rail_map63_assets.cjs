/* Complete user asset APIs, clones outside timing, successful full outputs hashed. */
const path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const N=require(path.join(root,'rail/network')),M=require(path.join(root,'rail/management')),F=require(path.join(root,'rail/fleet')),U=require(path.join(root,'rail/urban-growth'));
let Core;try{Core=require(path.join(root,'rail/routing-wasm'));}catch{}
Math.random=()=>.31415926535;
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex'),rows=[];
const points=i=>Array.from({length:6},(_,j)=>({x:600+j*12,y:500+i*15,nameSeed:(j+1)/7}));
function measure(base,label,kind,op,args,legacy,method='change'){
 const command=M.command?M.command(kind,op,args):legacy;
 const perform=s=>{const out=M[method](s,command);assert(!out?.error,JSON.stringify(out));return out;};
 for(let i=0;i<8;i++)perform(structuredClone(base));
 const windows=[];let final;
 for(let r=0;r<7;r++){
  const worlds=Array.from({length:5},()=>structuredClone(base));
  const start=performance.now();let result;for(const s of worlds)result=perform(s);windows.push((performance.now()-start)/worlds.length);final={state:worlds.at(-1),result};
 }
 let traffic={calls:0,inputBytes:0,outputBytes:0};
 if(Core){const original=Core.kernel;Core.kernel=(name,input,...a)=>{const result=original(name,input,...a);traffic.calls++;traffic.inputBytes+=input.length*8;traffic.outputBytes+=result.byteLength;return result;};try{perform(structuredClone(base));}finally{Core.kernel=original;}}
 rows.push({label,lines:base.services.length,stations:base.nodes.length,windowsMs:windows,medianMs:[...windows].sort((a,b)=>a-b)[3],outputHash:hash(final),...traffic});
}
for(const lines of [4,10]){
 const s=M.init(N.emptyWorld('gba'));for(let i=0;i<lines;i++)assert(!N.addLine(s,points(i),{stockSpec:'6B'}).error);
 s.depot.stock['6B']=lines*8+12;for(const l of [...s.services])assert(!N.configure(s,l.id,{dispatch:{mode:'manual',manual:8,offPeak:8,peak:8}}).error);
 s.economy.cash=50e9;const id=s.services[0].id;
 measure(s,'purchase eight 6B trains','fleet','purchase',{spec:'6B',count:8},c=>F.purchase(c,'6B',8));
 measure(s,'preview six-station construction','network','addLine',{points:points(lines),options:{stockSpec:'6B'}},c=>N.addLine(c,points(lines),{stockSpec:'6B'}),'preview');
 measure(s,'construct six-station line','network','addLine',{points:points(lines),options:{stockSpec:'6B'}},c=>N.addLine(c,points(lines),{stockSpec:'6B'}));
 const point={x:630,y:506,nameSeed:.2},options={index:3};
 measure(s,'insert and pay for station','network','addStation',{id,point,options},c=>N.addStation(c,id,point,options));
 const values={dispatch:{mode:'manual',manual:4,offPeak:4,peak:4}};
 measure(s,'recall assigned trains','network','configure',{id,values},c=>N.configure(c,id,values));
 measure(s,'delete and salvage line','network','removeLine',{id},c=>N.removeLine(c,id));
 const city=structuredClone(s);U.init(city);city.urban.facilities.push({id:'u1',kind:'school',level:1,x:600,y:500,opened:420});city.urban.nextId=2;
 measure(city,'upgrade manual facility','facility','upgrade',{id:'u1'},c=>U.upgrade(c,'u1'));
 measure(city,'remove and salvage facility','facility','remove',{id:'u1'},c=>U.remove(c,'u1'));
}
console.log(JSON.stringify({root,rows,peakRssMiB:process.resourceUsage().maxRSS/1024,wasmMiB:(Core?.status().memoryBytes||0)/1048576}));
