'use strict';
// The same reader becomes a non-modal detail column on the home feed.
const splitState={active:false,route:null,selectedKey:null,pendingKey:null,anchor:null,anchorTop:0,feedScroll:0,rendering:false};
function splitHome(){return !location.hash||location.hash==='#/overview';}
function splitWide(){return window.matchMedia('(min-width: 1000px)').matches;}
function splitAnchor(){const cards=[...document.querySelectorAll('#feed-stream>[data-feed-key]')];return cards.find(c=>c.getBoundingClientRect().bottom>140)||null;}
function splitMarkSelection(){
 if(!splitState.active)return;
 let path=splitState.route;
 if(readerCurrent?.type==='article')path=articleRoute(readerArticle);
 if(readerCurrent?.type==='event')path='#/events/'+encodeURIComponent(readerCurrent.id);
 const cards=[...document.querySelectorAll('#feed-stream>[data-feed-key]')],matches=cards.filter(card=>[...card.querySelectorAll('a[href]')].some(a=>a.getAttribute('href')===path));
 const selected=matches.find(c=>c.dataset.feedKey===splitState.pendingKey)||matches.find(c=>c.dataset.feedKey===splitState.selectedKey)||matches[0]||cards.find(c=>c.dataset.feedKey===splitState.selectedKey);
 cards.forEach(card=>card.classList.toggle('feed-selected',card===selected));
 if(selected)splitState.selectedKey=selected.dataset.feedKey;splitState.pendingKey=null;
}
function presentReader(){
 if(!splitHome()){
  if(!readerDialog.open)readerDialog.showModal();
  document.body.classList.add('reader-open');return;
 }
 const first=!splitState.active,wide=splitWide();
 let anchor,top,scroll;
 if(first){anchor=splitAnchor();top=anchor?.getBoundingClientRect().top;scroll=window.scrollY;splitState.anchor=anchor;splitState.anchorKey=anchor?.dataset.feedKey;splitState.anchorTop=top;splitState.feedScroll=scroll;}
 splitState.active=true;document.body.classList.add('split-reading');document.body.classList.remove('reader-open');
 readerDialog.setAttribute('aria-modal','false');
 if(!readerDialog.open)readerDialog.show();
 $('#reader-close').textContent=wide?'收起':'返回信息流';$('#reader-close').setAttribute('aria-label',wide?'收起详情':'返回信息流');
 if(first&&wide&&anchor)window.scrollTo({top:window.scrollY+anchor.getBoundingClientRect().top-top,behavior:'instant'});
 if(first&&!wide)window.scrollTo({top:0,behavior:'instant'});
 splitMarkSelection();
}
function readerScrollPosition(){return splitState.active&&!splitWide()?window.scrollY:readerDialog.scrollTop;}
function scrollReaderTo(top=0){if(splitState.active&&!splitWide())window.scrollTo({top,behavior:'instant'});else readerDialog.scrollTop=top;}
function splitRouteLabel(path){return ({markets:'行情详情',calendar:'经济日历',global:'全球市场',topics:'关注主线',health:'数据健康',changes:'变化清单',review:'存档与复盘'})[path.split('/')[1]]||'详情';}
function splitRouteSupported(path){return /^#\/(markets|calendar|global|topics|health|changes|review)(?:\/|$)/.test(path);}
function splitRouteBody(path){
 let p;try{p=path.replace(/^#\/?/,'').split('/').filter(Boolean).map(decodeURIComponent);}catch{return '';}
 if(p[0]==='markets'){const m=state.data.markets.find(m=>m.id===p[1]);return m?marketPage(m,p[2]||'overview'):'';}
 if(p[0]==='calendar')return calendarDetailPage(p[1]);
 if(p[0]==='global')return globalPage();
 if(p[0]==='topics')return topicsPage(p[1]);
 if(p[0]==='health')return dataHealthPage();
 if(p[0]==='changes')return changesPage();
 if(p[0]==='review')return reviewPage(p[1]);
 return '';
}
function renderSplitRoute(options={}){
 if(!splitState.active||!splitState.route||splitState.rendering)return;
 const scroll=readerScrollPosition(),title=document.title;splitState.rendering=true;
 try{$('#reader-content').innerHTML=splitRouteBody(splitState.route)||'<article class="reader-article"><h1>当前内容暂不可用</h1></article>';const heading=$('#reader-content').querySelector('h1');if(heading)heading.id='reader-title';readerToolbar();splitMarkSelection();scrollReaderTo(options.preserveScroll?scroll:options.scroll||0);}
 finally{document.title=title;splitState.rendering=false;}
}
function openSplitRoute(path,options={}){
 if(!splitHome()||!splitRouteSupported(path))return false;
 readerStart('route',path,options);readerArticle=null;splitState.route=path;
 presentReader();renderSplitRoute(options);return true;
}
function refreshSplitReader(){if(splitState.active&&readerCurrent?.type==='route'&&splitState.route?.startsWith('#/markets/'))renderSplitRoute({preserveScroll:true});}
function closeSplitReader(){
 if(!splitState.active)return;
 const home=splitHome(),wide=splitWide(),anchor=wide?splitAnchor():splitState.anchor?.isConnected?splitState.anchor:[...document.querySelectorAll('#feed-stream>[data-feed-key]')].find(c=>c.dataset.feedKey===splitState.anchorKey),top=wide?anchor?.getBoundingClientRect().top:splitState.anchorTop,scroll=wide?window.scrollY:splitState.feedScroll;
 splitState.active=false;splitState.route=null;document.body.classList.remove('split-reading');readerDialog.removeAttribute('aria-modal');
 $('#reader-close').textContent='关闭';$('#reader-close').setAttribute('aria-label','关闭阅读窗口');
 document.querySelectorAll('#feed-stream>.feed-selected').forEach(c=>c.classList.remove('feed-selected'));
 if(home){if(anchor?.isConnected)window.scrollTo({top:window.scrollY+anchor.getBoundingClientRect().top-top,behavior:'instant'});else window.scrollTo({top:scroll||0,behavior:'instant'});}
}
document.addEventListener('click',e=>{
 if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||!splitHome())return;
 const a=e.target.closest('a[href^="#/"]');if(!a||!a.closest('#home-feed,#reader-content'))return;
 const card=a.closest('[data-feed-key]');if(card)splitState.pendingKey=card.dataset.feedKey;
 if(openSplitRoute(a.getAttribute('href')))e.preventDefault();
},true);
document.addEventListener('click',e=>{
 if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||!splitHome()||e.target.closest('a,button,input,textarea,select,summary'))return;
 const card=e.target.closest('#feed-stream>.feed-card');if(card)(card.querySelector('a.feed-story-open,a.feed-quote')||card.querySelector('a[href^="#/"]'))?.click();
});
$('#reader-dialog').addEventListener('close',closeSplitReader);
window.addEventListener('hashchange',()=>{if(splitState.active&&!splitHome()&&readerDialog.open)readerDialog.close();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&splitState.active&&!document.querySelector('#research-pin-dialog[open],#sources-dialog[open]')){e.preventDefault();readerDialog.close();}});
