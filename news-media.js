'use strict';
// Render only image metadata extracted from existing feeds, never publisher HTML.
function newsImages(n){
 const rows=Array.isArray(n.images)?n.images:[],seen=new Set(),result=[];
 for(const row of [...rows,...(n.image_url?[{url:n.image_url}]:[])]){
  if(!row||typeof row.url!=='string')continue;
  try{const u=new URL(row.url);if(u.protocol!=='https:'||u.username||u.password||seen.has(u.href))continue;seen.add(u.href);result.push({...row,url:u.href});}catch{}
 }
 return result;
}
function newsImage(n,mode='cover'){
 const rows=newsImages(n);if(!rows.length)return '';
 const figure=(row,index)=>`<figure class="news-image news-image--${mode}"><img data-news-image src="${esc(row.url)}" alt="${esc(row.alt||'')}" loading="lazy" decoding="async" referrerpolicy="no-referrer">${mode==='detail'?`<figcaption>${esc([row.caption,row.credit].filter(Boolean).join(' · ')||`图片来源：${n.source||'原报道'}`)}</figcaption>`:''}</figure>`;
 return mode==='cover'?figure(rows[0],0):rows.map(figure).join('');
}
function readerBody(n) {
  const text=(n.reader_text||n.summary||'').trim(),rss=!!n.reader_text,images=newsImages(n);
  const paragraphs=text?text.split(/\n\s*\n/):[],placed=new Set();
  const at=(position)=>images.map((row,i)=>{
    const slot=rss&&Number.isInteger(row.after_paragraph)?row.after_paragraph:0;
    if(slot!==position||placed.has(i))return '';placed.add(i);
    return newsImage({...n,image_url:null,images:[row]},'detail');
  }).join('');
  const content=at(0)+(text?paragraphs.map((p,i)=>`<p>${esc(p)}</p>${at(i+1)}`).join(''):'<p>当前来源只提供标题和链接，尚未提供正文或摘要。</p>');
  const remaining=images.filter((row,i)=>!placed.has(i));
  return `<div class="reader-content-label">${n.reader_kind==='publisher'?'来源正文':rss?(n.reader_scope==='excerpt'?'RSS 来源摘要':'RSS 来源内容'):text?'来源摘要':'仅有标题'}</div>${content}${newsImage({...n,image_url:null,images:remaining},'detail')}<p class="reader-disclosure">${n.reader_kind==='publisher'?'内容来自来源网站的公开文章，保留原有段落与配图。':rss?'内容由媒体 RSS 提供，可能是正文或节选；配图取自该来源，内容以 RSS 实际提供为准。':text?'来源提供的摘要，非 AI 生成。':'可收藏这条报道，或按需打开原始来源。'}${n.reader_truncated?' 此条沿用的旧快照含截取内容，来源恢复采集后将更新为完整内容。':''}</p>`;
}

document.addEventListener('error',e=>{
 const img=e.target;if(!img?.matches?.('img[data-news-image]'))return;
 const figure=img.closest('.news-image');if(figure)figure.hidden=true;
},true);
