const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const css=fs.readFileSync('style.css','utf8');
const luminance=h=>{const c=h.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c.reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0)};
for(const theme of ['clear','paper','blue','night']){
 const block=[...css.matchAll(new RegExp('\\[data-theme="'+theme+'"\\]\\{([^}]+)\\}','g'))].at(-1)[1];
 const colors=Object.fromEntries([...block.matchAll(/--([\w-]+):(#[0-9a-f]{6})/g)].map(m=>[m[1],m[2]]));
 for(const fg of ['ink','muted','accent','green','red','warning'])for(const bg of ['bg','paper','surface-soft']){
  const a=luminance(colors[fg]),b=luminance(colors[bg]),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  assert(ratio>=4.5,`${theme}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
 }
 for(const fg of ['on-hero','on-hero-muted'])for(const bg of ['hero','hero-raised','side']){
  const a=luminance(colors[fg]),b=luminance(colors[bg]);assert((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,`${theme}: ${fg} on ${bg}`);
 }
}
const code=fs.readFileSync('ui.js','utf8');
for(const theme of ['clear','paper','blue','night','invalid']){
 const attrs={},s={theme,density:'compact',readerFont:20};
 const ctx={safeLoad:()=>s,document:{addEventListener(){},documentElement:{setAttribute:(k,v)=>attrs[k]=v},querySelectorAll:()=>[],getElementById:()=>null,body:{classList:{toggle(){}}}},$:()=>null};vm.createContext(ctx);vm.runInContext(code,ctx);vm.runInContext('applyLayout()',ctx);assert.equal(attrs['data-theme'],theme==='invalid'?'clear':theme);assert.equal(vm.runInContext('layoutSettings().readerFont',ctx),20);assert.equal(vm.runInContext('layoutSettings().density',ctx),'compact');
}
console.log('Four theme contrast palettes, saved selection and fallback checks passed.');
