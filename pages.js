'use strict';
// Hash routes work on GitHub Pages, including direct links and browser back/forward.
const recentArticles = safeLoad('current:recentArticles', {});
const notes = safeLoad('current:notes', {});
let returnRoute = '#/news/全部';
let chartPeriod = 60;
let techPeriod = 120;
let techOverlay = "ma";
function navigate(path) { if(location.hash === path) renderRoute(); else location.hash=path; }
function eventId(e) { return e.id||[e.date,e.time,e.country,e.title].join('|'); }
function newsById(id) { return (state.data.news||[]).find(n=>n.id===id)||state.saved[id]||recentArticles[id]||(state.data.events||[]).flatMap(e=>e.articles).find(n=>n.id===id)||Object.values(eventStorage()).flatMap(e=>e.articles).find(n=>n.id===id); }
function routeCrumbs(items) { return '<nav class="detail-crumbs" aria-label="面包屑"><a href="#/overview">今日概览</a>'+items.map(i=>'<span>/</span>'+(i.href?`<a href="${esc(i.href)}">${esc(i.label)}</a>`:`<span aria-current="page">${esc(i.label)}</span>`)).join('')+'</nav>'; }
function detailShell(crumbs,body) { return routeCrumbs(crumbs)+body; }
function articleCard(n) { return `<a class="related-item" href="${articleRoute(n)}"><div class="news-meta"><span class="tag ${esc(n.category)}">${esc(n.category)}</span><span>${esc(n.source)}</span><time>${esc(relative(n.published_at))}</time></div><h3>${esc(n.title)}</h3><span class="related-arrow">查看详情 →</span></a>`; }
function articlePage(n) {
  readingOpen(n);
  recentArticles[n.id]=n;
  const keys=Object.keys(recentArticles);if(keys.length>100)keys.slice(0,keys.length-100).forEach(k=>delete recentArticles[k]);persist('recentArticles',recentArticles);
  const related=(state.data.news||[]).filter(x=>x.id!==n.id&&x.category===n.category).sort((a,b)=>Number(b.kind==='headline')-Number(a.kind==='headline')).slice(0,5);
  const summary=(n.summary||'').trim();
  document.title=n.title+' · 观潮';
  return detailShell([{label:'新闻雷达',href:'#/news/全部'},{label:n.category,href:'#/news/'+encodeURIComponent(n.category)},{label:'报道详情'}],`
    <div class="detail-grid"><article class="article-page paper"><a class="back-link" href="${esc(returnRoute)}">← 返回阅读列表</a><div class="news-meta"><a class="tag ${esc(n.category)}" href="#/news/${encodeURIComponent(n.category)}">${esc(n.category)}</a><span>来源：${esc(n.source)}</span></div><h1>${esc(n.title)}</h1><div class="article-meta"><span>发布 ${esc(fmt(n.published_at))}</span><span>采集 ${esc(fmt(n.fetched_at))} · 北京时间</span></div><div class="article-actions"><button class="outline-button" data-detail-save="${esc(n.id)}">${state.saved[n.id]?'◆ 已收藏':'◇ 收藏报道'}</button><button class="outline-button" data-copy-link>复制站内链接</button><span>已加入阅读记录 ✓</span></div>
    <section class="reader-body article-summary">${readerBody(n)}</section><a class="solid-button external-action" href="${safeUrl(n.url)}" target="_blank" rel="noopener noreferrer">查看 ${esc(n.source)} 原文 ↗</a>
    ${readingFeedbackMarkup(n)}<section class="personal-notes"><div class="section-heading"><h2>我的笔记</h2><span class="subtle">仅存当前浏览器</span></div><label class="sr-only" for="article-note">这条报道的个人笔记</label><textarea id="article-note" data-note-id="${esc(n.id)}" placeholder="记下你的判断、疑问，或者与持仓相关的线索…" maxlength="10000">${esc(notes[n.id]||'')}</textarea><div class="note-status" id="note-status">输入后自动保存到本机</div></section></article>
    <aside class="detail-aside"><section class="paper related-panel"><div class="section-heading"><h2>继续阅读</h2></div>${related.map(articleCard).join('')||'<p class="empty">暂无同类报道</p>'}<a class="all-link" href="#/news/${encodeURIComponent(n.category)}">查看全部${esc(n.category)}新闻 →</a></section><section class="detail-tip">从分类到报道，全部留在站内。<br>只有明确标注 ↗ 的链接会打开外部来源。</section></aside></div>`);
}
function chartMarkup(m,period=30) {
  const chartNum=v=>GlobalMarkets.number(m,v);
  const p=(m.history||[]).filter(x=>Number.isFinite(x.close)).slice(-period);
  if(p.length<2)return '<div class="chart-empty"><span>⌁</span><h3>历史走势暂不可用</h3><p>当前来源已提供报价，尚未返回该指数的历史序列。</p></div>';
  const values=p.map(x=>x.close),low=Math.min(...values),high=Math.max(...values),span=high-low||Math.max(high*.001,1);
  const left=74,top=28,width=660,height=210;
  const xy=p.map((x,i)=>[left+i/(p.length-1)*width,top+height-(x.close-low)/span*height]);
  const points=xy.map(v=>v.map(n=>n.toFixed(2)).join(',')).join(' ');
  const color=values[values.length-1]>=values[0]?'var(--red)':'var(--green)';
  const grid=Array.from({length:5},(_,i)=>{const y=top+height*i/4;return `<line x1="${left}" x2="${left+width}" y1="${y}" y2="${y}" stroke="#e9eef0" stroke-dasharray="3 4"/><text x="${left-12}" y="${y+4}" text-anchor="end" fill="#97a4a9" font-size="11">${chartNum(high-span*i/4)}</text>`;}).join('');
  const dots=xy.map(([x,y],i)=>`<circle cx="${x}" cy="${y}" r="7" fill="transparent" stroke="transparent"><title>${esc(p[i].date)} 收盘 ${chartNum(p[i].close)}</title></circle>`).join('');
  return `<svg class="history-chart" viewBox="0 0 760 280" role="img" aria-label="${esc(m.name)}最近${p.length}个日线收盘价，首日${chartNum(values[0])}，末日${chartNum(values[values.length-1])}">${grid}<polygon points="${left},${top+height} ${points} ${left+width},${top+height}" fill="${color}" opacity=".08"/><polyline points="${points}" stroke="${color}" stroke-width="2.5" fill="none"/>${dots}<text x="${left}" y="269" fill="#97a4a9" font-size="11">${esc(p[0].date)}</text><text x="${left+width}" y="269" text-anchor="end" fill="#97a4a9" font-size="11">${esc(p[p.length-1].date)}</text></svg><p class="chart-caption">历史日线价格 · 当日未完成日线可能包含盘中值 · 非分时图 · 悬停可查看数值</p>`;
}
function marketHeader(m) { return `<div class="market-detail-heading"><div><div class="eyebrow">${esc(m.region)} / ${esc(m.id.toUpperCase())}</div><h1>${esc(m.name)}</h1><div class="article-meta">${esc(m.source)} · ${esc(marketQuoteLabel(m))}</div></div><button class="outline-button" data-watch-toggle="${esc(m.id)}">${state.watch.includes(m.id)?'✓ 已加入自选':'+ 加入自选'}</button></div><div class="quote-overview"><strong>${marketPrice(m)}</strong><span class="${marketTone(m)}">${marketDelta(m)} <small>${GlobalMarkets.number(m,m.change)}</small></span><label>${esc(marketUnit(m))} · 最近报价 · 非实时</label></div>`; }
function marketPage(m,mode="overview") {
  if(m.asset_class==='rates')return globalRatePage(m,mode==='history');
  const historyPage=mode==="history",techPage=mode==="technical";
  document.title=m.name+(historyPage?' · 历史数据':techPage?' · 技术分析':' · 行情详情')+' · 观潮';
  const bars=(m.history||[]).filter(x=>Number.isFinite(x.close));
  const related=(state.data.news||[]).filter(n=>n.category==='金融'&&n.kind==='headline').slice(0,5);
  const crumbs=[{label:'全球市场',href:'#/global'},{label:m.name,...((historyPage||techPage)?{href:'#/markets/'+encodeURIComponent(m.id)}:{})}];if(historyPage)crumbs.push({label:'历史数据'});if(techPage)crumbs.push({label:'技术分析'});
  const tab=`<nav class="detail-tabs" aria-label="行情详情导航"><a class="${!historyPage&&!techPage?'selected':''}" href="#/markets/${encodeURIComponent(m.id)}">走势概览</a><a class="${techPage?'selected':''}" href="#/markets/${encodeURIComponent(m.id)}/technical">技术分析</a><a class="${historyPage?'selected':''}" href="#/markets/${encodeURIComponent(m.id)}/history">历史数据</a></nav>`;
  let main;
  if(techPage)main=technicalPage(m);
  else if(historyPage)main=`<h2>历史收盘记录</h2><p class="panel-caption">数据覆盖 ${bars.length} 个交易日；来源未提供的记录不补写。</p>${bars.length?'<div class="table-wrap"><table class="history-table"><thead><tr><th>交易日期</th><th>收盘点位</th><th>较前一条记录</th></tr></thead><tbody>'+[...bars].reverse().map((b,i)=>{const prev=bars[bars.length-i-2];const pct=prev&&prev.close?(b.close/prev.close-1)*100:null;return `<tr><td>${esc(b.date)}${b.partial?'（未完成）':''}</td><td>${GlobalMarkets.number(m,b.close)}</td><td class="${direction(pct)}">${signed(pct)}</td></tr>`;}).join('')+'</tbody></table></div>':'<div class="empty">当前没有可展示的历史数据。</div>'}`;
  else {
    const closes=bars.map(b=>b.close),periodChange=bars.length>1&&bars[0].close?(bars[bars.length-1].close/bars[0].close-1)*100:null;
    main=`<div class="section-heading"><h2>收盘走势</h2><div class="period-buttons">${[20,60,120].map(p=>`<button data-period="${p}" class="${chartPeriod===p?'selected':''}">${p}交易日</button>`).join('')}</div></div><div id="detail-chart">${chartMarkup(m,chartPeriod)}</div><div class="metric-grid"><div><small>历史区间最高收盘</small><b>${closes.length?GlobalMarkets.number(m,Math.max(...closes)):'—'}</b></div><div><small>历史区间最低收盘</small><b>${closes.length?GlobalMarkets.number(m,Math.min(...closes)):'—'}</b></div><div><small>历史区间涨跌</small><b class="${direction(periodChange)}">${signed(periodChange)}</b></div></div><p class="chart-caption">区间统计基于全部 ${bars.length} 条已获取日线${bars.some(b=>b.partial)?'（含未完成的当日日线）':''}；技术分析另行排除未完成日线，与当前报价的口径分别标注。</p><a class="all-link" href="#/markets/${encodeURIComponent(m.id)}/history">查看逐日历史数据 →</a>${technicalPreview(m)}`;
  }
  return detailShell(crumbs,`<div class="detail-grid"><article class="paper market-page"><a class="back-link" href="#/global">← 返回全球市场</a>${marketHeader(m)}${m.note?`<p class="desk-storage-note">${esc(m.note)}</p>`:''}${tab}<div class="reader-actions"><button class="outline-button" data-research-pin="market:${esc(m.id)}">放进研究桌 · 留存快照</button></div><section class="market-body">${main}</section><div class="market-source"><span>采集时间 ${esc(fmt(m.fetched_at))} · 北京时间</span><a href="${safeUrl(m.source_url)}" target="_blank" rel="noopener noreferrer">前往行情来源 ↗</a></div></article><aside class="detail-aside"><section class="paper related-panel"><h2>财经动态</h2><p class="panel-caption">财经类报道，未做个股关联推断</p>${related.map(articleCard).join('')}<a class="all-link" href="#/news/金融">进入财经新闻 →</a></section></aside></div>`);
}
function renderRoute(scroll=true) {
  let parts;try {parts=location.hash.replace(/^#\/?/,'').split('/').filter(Boolean).map(decodeURIComponent);}catch{parts=['missing'];}
  if(parts[0]==='main')return;
  const root=parts[0]||'overview';if(root==='overview'&&scroll===false&&typeof splitState!=='undefined'&&splitState.active&&splitState.route&&!splitState.rendering){renderSplitRoute({preserveScroll:true});return;}document.body.classList.toggle('feed-home',root==='overview');syncNavigation(root);const detail=(root==='news'&&parts[2]==='article')||root==='markets'||root==='calendar'||root==='topics'||root==='health'||root==='events'||root==='preferences'||root==='research'||root==='changes'||root==='review'||root==='global';
  document.body.classList.toggle('detail-mode',detail);$('#detail-page').hidden=!detail;
  if(!detail) {
    if(!['overview','news','watch','saved'].includes(root)){document.body.classList.add('detail-mode');$('#detail-page').hidden=false;$('#detail-page').innerHTML='<div class="paper empty"><h2>没有找到这个页面</h2><a href="#/overview">返回今日概览 →</a></div>';return;}
    state.category=root==='news'&&['全部','科技','金融','全球','政治','数码','游戏','摄影'].includes(parts[1])?parts[1]:'全部';
    setView(root);document.querySelectorAll('[data-category]').forEach(b=>{b.classList.toggle('selected',b.dataset.category===state.category);b.setAttribute('aria-pressed',String(b.dataset.category===state.category));});
    document.title=(root==='news'&&state.category!=='全部'?state.category+'新闻':'观潮')+' · XXBO 财经与新闻';return;
  }
  $('#view-label').innerHTML=root==='markets'?'<a href="#/global">全球市场</a> / 行情详情':root==='global'?'<a href="#/global">全球市场</a>':root==='research'?'<a href="#/research">研究桌</a>':root==='changes'?'<a href="#/changes">变化清单</a>':root==='review'?'<a href="#/review">存档与复盘</a>':root==='preferences'?'<a href="#/preferences">阅读偏好</a>':root==='events'?'<a href="#/events">事件追踪</a>':root==='health'?'<a href="#/health">数据健康</a>':root==='topics'?'<a href="#/topics">关注主线</a>':root==='calendar'?'<a href="#/calendar">经济日历</a>':'<a href="#/news/全部">新闻雷达</a> / 报道详情';
  syncNavigation(root);
  if(!state.loaded){$('#detail-page').innerHTML='<div class="paper empty">正在读取详情…</div>';return;}
  let content;
  if(root==='news') {const n=newsById(parts[3]);if(n){state.read[n.id]=true;persist('read',state.read);content=articlePage(n);}}
  if(root==='markets') {const m=(state.data.markets||[]).find(m=>m.id===parts[1]);if(m)content=marketPage(m,parts[2]||'overview');}
  if(root==='calendar')content=calendarDetailPage(parts[1]);
  if(root==='topics')content=topicsPage(parts[1]);
  if(root==='global')content=globalPage();
  if(root==='research')content=researchPage(parts[1]);
  if(root==='changes')content=changesPage();
  if(root==='review')content=reviewPage(parts[1]);
  if(root==='preferences')content=preferencesPage();
  if(root==='events')content=eventsPage(parts[1]);
  if(root==='health')content=dataHealthPage();
  $('#detail-page').innerHTML=content||'<div class="paper empty"><h2>这条内容已不在当前快照中</h2><p>定时更新可能替换旧条目。收藏或已打开过的报道会保留在当前浏览器。</p><a href="#/overview">返回今日概览 →</a></div>';
  $('#saved-count').textContent=Object.keys(state.saved).length;
  if(scroll){window.scrollTo({top:0,behavior:'instant'});$('#detail-page').focus({preventScroll:true});}
}
document.addEventListener('click',e=>{const a=e.target.closest('a[href^="#/"]');if(a&&a.href.includes('/article/')&&!location.hash.includes('/article/'))returnRoute=location.hash.startsWith('#/')?location.hash:'#/overview';});
async function handleDetailClick(e){
  const save=e.target.closest('[data-detail-save]'),watch=e.target.closest('[data-watch-toggle]'),period=e.target.closest('[data-period]');
  if(save){const id=save.dataset.detailSave,n=newsById(id);if(state.saved[id])delete state.saved[id];else if(n)state.saved[id]=n;persist('saved',state.saved);readingUpdated();renderRoute(false);}
  if(watch){const id=watch.dataset.watchToggle;state.watch=state.watch.includes(id)?state.watch.filter(x=>x!==id):[...state.watch,id];persist('watch',state.watch);renderWatch();renderRoute(false);}
  if(period){chartPeriod=Number(period.dataset.period);renderRoute(false);}
  const techP=e.target.closest('[data-tech-period]'),overlay=e.target.closest('[data-tech-overlay]');if(techP){techPeriod=Number(techP.dataset.techPeriod);renderRoute(false);}if(overlay){techOverlay=overlay.dataset.techOverlay;renderRoute(false);}
  if(e.target.closest('[data-copy-link]')){try{await navigator.clipboard.writeText(location.href);toast('站内详情链接已复制');}catch{toast('复制暂不可用，可复制地址栏中的链接');}}
}
$('#detail-page').addEventListener('click',handleDetailClick);
$('#reader-dialog').addEventListener('click',handleDetailClick);
$('#detail-page').addEventListener('input',e=>{if(e.target.matches('[data-note-id]')){notes[e.target.dataset.noteId]=e.target.value;persist('notes',notes);$('#note-status').textContent='已保存到当前浏览器 ✓';}});
window.addEventListener('hashchange',()=>renderRoute());renderRoute(false);
