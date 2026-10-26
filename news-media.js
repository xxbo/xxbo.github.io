'use strict';
// Render only image metadata extracted from existing feeds, never publisher HTML.
function newsImages(n){
 const rows=Array.isArray(n.images)?n.images:[],seen=new Set(),result=[];
 for(const row of [...rows,...(n.image_url?[{url:n.image_url}]:[])]){
  if(!row||typeof row.url!=='string')continue;
  try{const u=new URL(row.url);if(u.protocol!=='https:'||u.username||u.password||seen.has(u.href))continue;seen.add(u.href);result.push({...row,url:u.href});}catch{}
  if(result.length===6)break;
 }
 return result;
}
function newsImage(n,mode='cover'){
 const rows=newsImages(n);if(!rows.length)return '';
 const figure=(row,index)=>`<figure class="news-image news-image--${mode}"><img data-news-image src="${esc(row.url)}" alt="${esc(row.alt||'')}" loading="lazy" decoding="async" referrerpolicy="no-referrer">${mode==='detail'?`<figcaption>${esc([row.caption,row.credit].filter(Boolean).join(' · ')||`图片来源：${n.source||'原报道'}`)}</figcaption>`:''}</figure>`;
 return mode==='cover'?figure(rows[0],0):rows.map(figure).join('');
}
document.addEventListener('error',e=>{
 const img=e.target;if(!img?.matches?.('img[data-news-image]'))return;
 const figure=img.closest('.news-image');if(figure)figure.hidden=true;
},true);
