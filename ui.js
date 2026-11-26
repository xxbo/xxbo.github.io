'use strict';
let layoutPreferences;
function layoutSettings(){
 if(!layoutPreferences){
  const saved=safeLoad('current:layout',{});
  layoutPreferences={
   theme:['clear','paper','blue','night'].includes(saved?.theme)?saved.theme:'clear',
   density:saved?.density==='compact'?'compact':'comfortable',
   readerFont:[16,17,18,19,20,21,22].includes(saved?.readerFont)?saved.readerFont:18
  };
 }
 return layoutPreferences;
}
function syncSavedBadges(){
 if(typeof state==='undefined'||!state?.saved)return;
 const count=String(Object.keys(state.saved).length);
 document.querySelectorAll('[data-saved-badge]').forEach(el=>{el.textContent=count;});
}
function applyLayout(){
 const s=layoutSettings();
 document.documentElement.setAttribute('data-theme',s.theme);
 document.querySelectorAll('[data-theme-choice]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.themeChoice===s.theme)));
 const themeLabel=document.getElementById('theme-label');
 if(themeLabel)themeLabel.textContent={clear:'清晰白',paper:'暖纸',blue:'冷蓝',night:'极夜'}[s.theme];
 document.body.classList.toggle('density-compact',s.density==='compact');
 document.querySelectorAll('[data-density]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.density===s.density)));
 const dialog=$('#reader-dialog');
 dialog?.style?.setProperty('--reader-font',s.readerFont+'px');
 syncSavedBadges();
}
function syncNavigation(root){
 const primary={global:'global',markets:'global',events:'events',topics:'topics',news:'news',overview:'overview',research:'research'}[root]||null;
 document.querySelectorAll('.nav').forEach(b=>{
  b.classList.toggle('active',b.dataset.view===primary);
  b.setAttribute('aria-current',b.dataset.view===primary?'page':'false');
 });
 document.querySelectorAll('.side-link[data-route]').forEach(link=>{
  const isCurrent=link.dataset.route===root;
  link.classList.toggle('active',isCurrent);
  if(isCurrent)link.setAttribute('aria-current','page');
  else link.removeAttribute('aria-current');
 });
 syncSavedBadges();
 const menu=$('#workspace-menu');
 if(menu)menu.open=false;
}
document.addEventListener('click',e=>{
 const jump=e.target.closest('[data-scroll-section]');
 if(jump){
  const target=document.getElementById(jump.dataset.scrollSection);
  if(target){
   target.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
   target.focus({preventScroll:true});
  }
 }
 const density=e.target.closest('[data-density]');
 if(density){
  layoutSettings().density=density.dataset.density==='compact'?'compact':'comfortable';
  persist('layout',layoutPreferences);
  applyLayout();
 }
 const menu=$('#workspace-menu');
 if(menu?.open&&!e.target.closest('#workspace-menu'))menu.open=false;
});
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'){
  const menu=$('#workspace-menu');
  if(menu?.open){menu.open=false;menu.querySelector('summary')?.focus();}
 }
});
document.addEventListener('click',e=>{
 const choice=e.target.closest('[data-theme-choice]');
 if(choice&&['clear','paper','blue','night'].includes(choice.dataset.themeChoice)){
  layoutSettings().theme=choice.dataset.themeChoice;
  persist('layout',layoutPreferences);
  applyLayout();
  const currentPicker=$('#theme-picker');
  if(currentPicker)currentPicker.open=false;
 }
 const picker=$('#theme-picker');
 if(picker?.open&&!e.target.closest('#theme-picker'))picker.open=false;
});
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'){
  const picker=$('#theme-picker');
  if(picker?.open){picker.open=false;picker.querySelector('summary')?.focus();}
 }
});
document.addEventListener('DOMContentLoaded',applyLayout);
document.addEventListener('click',e=>{
 if(e.target.closest('#theme-picker>summary')){const other=$('#workspace-menu');if(other)other.open=false;}
 if(e.target.closest('#workspace-menu>summary')){const other=$('#theme-picker');if(other)other.open=false;}
});
