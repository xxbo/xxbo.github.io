'use strict';
const readerDialog = document.querySelector('#reader-dialog');
let readerArticle=null,readerFocus=null,readerCurrent=null,readerTrail=[],readerQueue=[],readerReturnId='main';
function readerSnapshot(){return readerCurrent?{...readerCurrent,queue:[...readerQueue],scroll:readerDialog.scrollTop}:null;}
function readerStart(type,id,options={}){
 if(!readerDialog.open){readerFocus=document.activeElement;readerTrail=[];readerCurrent=null;readerReturnId=options.returnId||'main';}
 if(readerCurrent&&!options.fromHistory&&(readerCurrent.type!==type||readerCurrent.id!==id))readerTrail.push(readerSnapshot());
 readerTrail=readerTrail.slice(-30);readerCurrent={type,id};
 if(options.queue)readerQueue=[...options.queue];
}
function readerToolbar(){
 const index=readerArticle?readerQueue.indexOf(readerArticle.id):-1;
 $('#reader-position').textContent=readerArticle&&index>=0?`${index+1} / ${readerQueue.length}`:'事件档案';
 $('#reader-back').disabled=!readerTrail.length;$('#reader-prev').disabled=!readerArticle||index<=0;$('#reader-next').disabled=!readerArticle||index<0||index>=readerQueue.length-1;
 applyLayout();
}
function readerMove(direction){if(!readerArticle)return;const index=readerQueue.indexOf(readerArticle.id),n=newsById(readerQueue[index+direction]);if(index>=0&&n)openReader(n,{keepQueue:true});}
function readerBack(){const item=readerTrail.pop();if(!item)return;readerQueue=item.queue||[];if(item.type==='article'){const n=newsById(item.id);if(n)openReader(n,{fromHistory:true,keepQueue:true,scroll:item.scroll});}else{const e=trackedEvent(item.id);if(e)openEventReader(e,{fromHistory:true,scroll:item.scroll});}}
function articleQueue(anchor,n){const scope=anchor?.closest('section[id],.reader-related,.event-dossier');const ids=scope?[...scope.querySelectorAll('a[href*="/article/"]')].flatMap(a=>{try{return [decodeURIComponent(a.getAttribute('href').split('/article/')[1])];}catch{return [];}}).filter(id=>newsById(id)):[];return [...new Set(ids.includes(n.id)?ids:[n.id,...(state.data.news||[]).filter(x=>x.kind==='headline'&&x.id!==n.id).map(x=>x.id)])];}

function readerBody(n) {
  const text=(n.reader_text||n.summary||'').trim();
  const rss=!!n.reader_text;
  return `<div class="reader-content-label">${rss?'RSS 来源内容':text?'来源摘要':'仅有标题'}</div>${text?text.split(/\n\s*\n/).map(p=>`<p>${esc(p)}</p>`).join(''):'<p>当前来源只提供标题和链接，尚未提供正文或摘要。</p>'}<p class="reader-disclosure">${rss?'内容由媒体 RSS 提供，可能是正文或节选；图片、图表和部分排版请查看原文。':text?'来源提供的摘要，非 AI 生成。':'可收藏这条报道，或按需打开原始来源。'}${n.reader_truncated?' 内容较长，浮窗已截取前 14,000 字符。':''}</p>`;
}
function openReader(n,options={}) {
  readerStart('article',n.id,options);
  if(!options.keepQueue&&!options.queue)readerQueue=articleQueue(null,n);
  readerArticle=n;readingOpen(n);
  state.read[n.id]=true;persist('read',state.read);
  recentArticles[n.id]=n;
  const keys=Object.keys(recentArticles);keys.slice(0,Math.max(0,keys.length-100)).forEach(k=>delete recentArticles[k]);persist('recentArticles',recentArticles);
  const related=(state.data.news||[]).filter(x=>x.id!==n.id&&x.category===n.category&&x.reader_text).slice(0,3);
  document.querySelector('#reader-content').innerHTML=`<article class="reader-article"><div class="news-meta"><span class="tag ${esc(n.category)}">${esc(n.category)}</span><span>${esc(n.source)}</span></div><h1 id="reader-title">${esc(n.title)}</h1><div class="article-meta">发布 ${esc(fmt(n.published_at))} · 北京时间</div>${newsContext(n)}<div class="reader-actions"><button class="outline-button" id="reader-save" aria-pressed="${!!state.saved[n.id]}">${state.saved[n.id]?'◆ 已收藏':'◇ 收藏报道'}</button><a href="${safeUrl(n.url)}" target="_blank" rel="noopener noreferrer">打开原文 ↗</a></div><section class="reader-body">${readerBody(n)}</section>${eventTimeline(n)}${readingFeedbackMarkup(n)}<section class="personal-notes"><label for="reader-note">我的笔记 <small>仅存当前浏览器</small></label><textarea id="reader-note" maxlength="10000" placeholder="记下你的判断或疑问…">${esc(notes[n.id]||'')}</textarea><div id="reader-note-status" class="note-status">输入后自动保存到本机</div></section>${related.length?`<section class="reader-related"><h2>继续阅读</h2>${related.map(articleCard).join('')}</section>`:''}</article>`;
  document.body.classList.add('reader-open');
  if(!readerDialog.open)readerDialog.showModal();
  readerToolbar();readerDialog.scrollTop=options.scroll||0;
  document.querySelector('#reader-close').focus({preventScroll:true});
}
document.addEventListener('click',e=>{
  if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
  const a=e.target.closest('a[href^="#/news/"]');if(!a)return;
  const match=a.getAttribute('href').match(/^#\/news\/[^/]+\/article\/([^/]+)$/);if(!match)return;
  let id;try{id=decodeURIComponent(match[1]);}catch{return;}
  const n=newsById(id);if(!n)return;
  e.preventDefault();openReader(n,{queue:articleQueue(a,n),returnId:a.closest('section[id]')?.id||'main'});
},true);
function openEventReader(event,options={}){
 readerStart('event',event.id,options);
 readerArticle=null;readingOpen(Brief.representative(state.data,event)||event.articles[0]);markEventSeen(event);
 document.querySelector('#reader-content').innerHTML=eventDossier(event,true);
 document.body.classList.add('reader-open');if(!readerDialog.open)readerDialog.showModal();readerToolbar();readerDialog.scrollTop=options.scroll||0;
 document.querySelector('#reader-close').focus({preventScroll:true});
 renderTopicsHome();
}
document.addEventListener('click',e=>{
 if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||e.target.closest('[data-event-permalink]'))return;
 const a=e.target.closest('a[href^="#/events/"]');if(!a)return;
 const match=a.getAttribute('href').match(/^#\/events\/([^/]+)$/);if(!match)return;
 let id;try{id=decodeURIComponent(match[1]);}catch{return;}
 const event=trackedEvent(id);if(!event)return;e.preventDefault();openEventReader(event,{returnId:a.closest('section[id]')?.id||'main'});
},true);
document.querySelector('#reader-close').addEventListener('click',()=>readerDialog.close());
readerDialog.addEventListener('click',e=>{
  const fontButton=e.target.closest('[data-reader-font]');if(fontButton){const settings=layoutSettings();settings.readerFont=Math.max(16,Math.min(22,settings.readerFont+Number(fontButton.dataset.readerFont)));persist('layout',settings);applyLayout();toast('正文字号 '+settings.readerFont+' px');}
  if(e.target===readerDialog){const r=readerDialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)readerDialog.close();}
  if(e.target.closest('#reader-save')&&readerArticle){const n=readerArticle;if(state.saved[n.id])delete state.saved[n.id];else state.saved[n.id]=n;persist('saved',state.saved);readingUpdated();const button=document.querySelector('#reader-save');button.textContent=state.saved[n.id]?'◆ 已收藏':'◇ 收藏报道';button.setAttribute('aria-pressed',String(!!state.saved[n.id]));document.querySelector('#saved-count').textContent=Object.keys(state.saved).length;}
});
readerDialog.addEventListener('input',e=>{if(e.target.id==='reader-note'&&readerArticle){notes[readerArticle.id]=e.target.value;persist('notes',notes);document.querySelector('#reader-note-status').textContent='已保存到当前浏览器 ✓';}});
readerDialog.addEventListener('close',()=>{readingUpdated();if(location.hash==='#/events')renderRoute(false);document.body.classList.remove('reader-open');document.querySelectorAll('[data-open]').forEach(a=>{const item=a.closest('article');item?.classList.toggle('read',!!state.read[a.dataset.open]);const b=item?.querySelector('[data-read]');if(b)b.textContent=state.read[a.dataset.open]?'已读 ✓':'标记已读';});if(readerFocus?.isConnected)readerFocus.focus({preventScroll:true});else {const fallback=!location.hash||location.hash==='#/overview'?document.getElementById(readerReturnId):$('#detail-page');(fallback||$('#main')).focus({preventScroll:true});}readerCurrent=null;readerTrail=[];});
window.addEventListener('hashchange',()=>{if(readerDialog.open)readerDialog.close();});

$('#reader-back').addEventListener('click',readerBack);
$('#reader-prev').addEventListener('click',()=>readerMove(-1));
$('#reader-next').addEventListener('click',()=>readerMove(1));

document.addEventListener('keydown',e=>{if(!readerDialog.open||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)||e.target.isContentEditable||window.getSelection?.()?.toString())return;if(e.key==='ArrowRight'){e.preventDefault();readerMove(1);}if(e.key==='ArrowLeft'){e.preventDefault();readerMove(-1);}});
