'use strict';
const R=RailSim,$=id=>document.getElementById(id),STORE='guanchao-rail-v1';
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=n=>Math.round(n).toLocaleString('zh-CN'),money=n=>n.toFixed(1),season=q=>`第 ${Math.floor(q/4)+1} 年 · ${['春','夏','秋','冬'][q%4]}`;
let s=R.newGame(),selected='aoba',tab='network',district=14,layer='city',draft=null,playing=false,speed=1,timer=null,zoom=1,throughOpen=false,toastTimer,storageOK=true;
try{const saved=localStorage.getItem(STORE);if(saved){const candidate=JSON.parse(saved);if(R.validate(candidate))s=candidate;else storageOK=false;}}catch{storageOK=false;}
let metrics=R.evaluate(s);
function save(){try{localStorage.setItem(STORE,JSON.stringify(s));storageOK=true;$('save-state').textContent='已存到本机';}catch{storageOK=false;$('save-state').textContent='存档不可用 · 请导出';}}
function toast(text){$('toast').textContent=text;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),4300);}
function pause(){playing=false;clearInterval(timer);timer=null;$('play').textContent='▶ 运行';$('play').setAttribute('aria-label','开始自动运行');$('map').pauseAnimations?.();}
function start(){if(draft){toast('请先完成或取消线路草图。');return;}playing=true;$('play').textContent='Ⅱ 暂停';$('play').setAttribute('aria-label','暂停自动运行');$('map').unpauseAnimations?.();clearInterval(timer);timer=setInterval(advance,10000/speed);}
function advance(){R.step(s);metrics=R.evaluate(s);save();render();}
function company(){return R.company(s,selected);}
function render(){
 $('date').textContent=season(s.quarter);$('metrics').innerHTML=`<div class="metric"><span>都市圈人口</span><strong>${(metrics.population/10000).toFixed(1)}<small>万人</small></strong></div><div class="metric"><span>铁路日均出行</span><strong>${(metrics.riders/10000).toFixed(2)}<small>万次</small></strong></div><div class="metric"><span>平均出行时间</span><strong>${metrics.avgTime.toFixed(1)}<small>分钟</small></strong></div><div class="metric"><span>轨道分担率</span><strong>${(metrics.share*100).toFixed(1)}<small>%</small></strong></div>`;
 $('companies').innerHTML=s.companies.map(c=>`<button data-company="${c.id}" style="--company:${c.color}" class="${c.id===selected?'active':''}" aria-pressed="${c.id===selected}"><i class="company-dot"></i>${c.short}</button>`).join('');
 const c=company(),a=metrics.accounts[c.id],net=a.revenue-a.cost;
 $('company-heading').innerHTML=`<div class="company-title"><h2>${c.name}</h2><span>${selected==='aoba'?'郊区私铁':selected==='metro'?'都心地下铁':'都市圈干线'}</span></div><div class="cash ${c.cash<0?'negative':''}">${money(c.cash)}<small>百万円 · 可用资金</small></div><div class="cash-hint">预计本季经营 ${net>=0?'+':''}${money(net)} · 未含建设支出</div>`;
 document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===tab)));
 renderPanel();renderMap();renderDraft();$('track-count').textContent=R.serviceKm(s,{trackIds:s.tracks.map(t=>t.id)}).toFixed(1);
 $('events').innerHTML=s.log.slice(0,2).map(e=>`<div><time>${season(e.q)}</time>${esc(e.text)}</div>`).join('');
 $('map-status').textContent=draft?'按顺序点击候选站，规划 '+c.name+' 的新线':layer==='flow'?'线宽表示需求 · 橙红色表示高峰运力紧张':layer==='growth'?'绿色外圈表示上一季新增人口':'点击车站，查看街区与线路';
 $('step').disabled=!!draft;
 if(!storageOK)$('save-state').textContent='存档需重新保存 · 可导出备份';
}
function lineCard(l){
 const owners=R.trackOwners(s,l),km=R.serviceKm(s,l),flow=metrics.serviceFlow[l.id]||0;
 return `<article class="line-card" style="--company:${R.company(s,l.owner).color}"><div class="line-title"><i></i>${esc(l.name)}${l.through?'<span class="badge">跨公司直通</span>':''}</div><div class="line-route">${l.stops.map(id=>s.nodes[id].name).join(' → ')}</div><div class="line-foot"><span>${km.toFixed(1)} km · ${num(flow)} 乘次/日</span><select data-headway="${l.id}" aria-label="${esc(l.name)}发车间隔">${[4,5,6,8,10,12,15].map(h=>`<option value="${h}" ${h===l.headway?'selected':''}>每 ${h} 分钟一班</option>`).join('')}</select></div>${owners.length>1?'<p class="panel-note">'+owners.map(id=>R.company(s,id).name).join(' × ')+' · 共享轨道时隙</p>':''}</article>`;
}
function renderPanel(){
 const c=company(),a=metrics.accounts[c.id],lines=s.services.filter(l=>R.trackOwners(s,l).includes(selected));
 if(tab==='network'){
 const candidates=s.services.filter(l=>!l.through&&l.stops[0]!==l.stops.at(-1));
 $('panel').innerHTML=`<div class="panel-actions"><button class="primary" id="build">＋ 新建线路</button><button id="through-toggle">⇄ 跨公司直通</button></div><div class="fare-row"><label for="fare">公司基础票价 <small>円 / 次行程</small></label><select id="fare">${[100,150,180,200,220,240,250,280,300,350,400,450,500,...(![100,150,180,200,220,240,250,280,300,350,400,450,500].includes(c.fare)?[c.fare]:[])].sort((a,b)=>a-b).map(v=>`<option value="${v}" ${v===c.fare?'selected':''}>¥ ${v}</option>`).join('')}</select></div>${throughOpen?`<div class="through-box"><h3>接续两家公司的端点站</h3><select id="through-a" aria-label="第一条直通线路">${candidates.map(l=>`<option value="${l.id}" ${l.owner==='aoba'?'selected':''}>${esc(l.name)} · ${R.company(s,l.owner).short}</option>`).join('')}</select><select id="through-b" aria-label="第二条直通线路">${candidates.map(l=>`<option value="${l.id}" ${l.owner==='metro'?'selected':''}>${esc(l.name)} · ${R.company(s,l.owner).short}</option>`).join('')}</select><p class="panel-note">双方各投入 12 百万円 · 新增每 10 分钟一班的直通服务 · 联程票价优惠 15%</p><button id="through-confirm" class="primary wide">开通直通服务</button></div>`:''}<div class="subhead"><span>运营服务</span><span>${lines.length} 条</span></div>${lines.map(lineCard).join('')||'<p class="empty">还没有线路。先在地图上连接两个候选站。</p>'}<p class="panel-note">修改后即更新预测；推进一季才结算。轨道每方向合计最多 30 班/小时。票款按承运里程分配。</p>`;
 }else if(tab==='finance'){
 const latest=c.ledger[0];$('panel').innerHTML=`<div class="subhead"><span>下一季经营预测</span><span>百万円 / 季</span></div><div class="finance-grid"><div><span>票务收入</span><strong>${money(a.revenue)}</strong></div><div><span>运营与维护</span><strong>${money(a.cost)}</strong></div><div><span>经营结余</span><strong class="${a.revenue>=a.cost?'positive':'negative'}">${money(a.revenue-a.cost)}</strong></div><div><span>待计入建设投入</span><strong>${money(c.pendingCapital||0)}</strong></div></div><div class="subhead"><span>现金走势 · 季度结算</span><span>${c.ledger.length} 季</span></div><div class="mini-bars">${[...c.ledger].slice(0,12).reverse().map(l=>`<i title="${season(l.q-1)}：${money(l.cash)} 百万円" style="height:${Math.max(3,Math.min(100,l.cash/Math.max(1,...c.ledger.map(v=>v.cash))*100))}%"></i>`).join('')||'<span class="panel-note">推进一季后开始记录</span>'}</div><table class="ledger"><thead><tr><th>季度</th><th>收入</th><th>运营</th><th>建设</th><th>期末现金</th></tr></thead><tbody>${c.ledger.slice(0,8).map(l=>`<tr><td>${Math.floor((l.q-1)/4)+1}年${(l.q-1)%4+1}季</td><td>${money(l.revenue)}</td><td>${money(l.cost)}</td><td>${money(l.capital)}</td><td>${money(l.cash)}</td></tr>`).join('')||'<tr><td colspan="5">尚未结算</td></tr>'}</tbody></table><p class="panel-note">建设资金即时扣款；季度账本单独列示，不会重复扣除。独立账户允许出现负现金，此时不能继续投资；本版暂不计债务与利息。</p>`;
 }else{
 const n=s.nodes[district],served=s.services.filter(l=>l.stops.includes(n.id)),reach=metrics.reach[n.id];let reason;
 if(!served.length)reason='目前没有轨道服务。修建到就业中心的连接线，有机会吸引新增居民。';else if(reach<15000)reason='已有车站，但 45 分钟内可达岗位仍然不足，增长受限。可改善连接、班次或减少换乘。';else if(n.people>=n.housing*.95)reason='交通条件较好，但住房接近容量上限。第一版暂不开放扩容，新增人口会转向其他地区。';else reason='已连入就业网络，且有剩余住房容量，具备吸引新增居民的条件。人口会在季度结算时逐步增加。';
 $('panel').innerHTML=`<div class="district-head"><h3>${n.name}</h3><span>${n.type}</span></div><div class="detail-row"><span>居住人口</span><b>${num(n.people)} 人</b></div><div class="detail-row"><span>就业岗位</span><b>${num(n.jobs)} 个</b></div><div class="detail-row"><span>住房容量</span><b>${num(n.housing)} 人</b></div><div class="detail-row"><span>轨道 45 分钟可达岗位</span><b>${num(reach)} 个</b></div><div class="detail-row"><span>上一季人口变化</span><b class="positive">+${num(n.growth||0)} 人</b></div><div class="insight">${reason}</div><div class="subhead"><span>本站服务</span><span>${served.length} 条</span></div>${served.map(lineCard).join('')||'<p class="empty">○ 尚未建站</p>'}`;
 }
}
function renderMap(){
 const svg=$('map'),colors={'住宅':'#c6ac89','办公':'#bb806b','商业':'#bc8a70','工业':'#879da4','教育':'#b3a785','田园':'#9eb78c'};
 const built=new Set(s.services.flatMap(l=>l.stops)),focus=draft?new Set(draft):new Set([district]);
 let html=`<defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#cdd7c5" stroke-width=".5"/></pattern><pattern id="water" width="15" height="15" patternUnits="userSpaceOnUse"><path d="M0 8h6m3-3h6" stroke="#a9c6c5" stroke-width=".7"/></pattern><filter id="soft"><feGaussianBlur stdDeviation="13"/></filter></defs><rect width="1040" height="740" fill="#e8ecdc"/><path d="M0 0H220Q140 140 75 300T0 550Z" fill="#d4dfc9"/><path d="M0 0H105Q70 190 0 280Z" fill="#bfceb7"/><rect width="1040" height="740" fill="url(#grid)"/><path d="M1040 460Q930 490 905 590Q880 675 710 740H1040Z" fill="#bad2d0"/><path d="M1040 460Q930 490 905 590Q880 675 710 740H1040Z" fill="url(#water)"/><path d="M860 -20Q810 100 850 240T855 440Q835 510 900 560" fill="none" stroke="#b4cdca" stroke-width="18"/><path d="M-10 550Q155 525 300 560T540 710" fill="none" stroke="#b4cdca" stroke-width="13"/><path d="M-10 550Q155 525 300 560T540 710" fill="none" stroke="#d3e4de" stroke-width="2"/><text x="110" y="70" class="district-name">多摩丘陵</text><text x="505" y="105" class="district-name">東京都市圏</text><text x="870" y="687" class="district-name" transform="rotate(-25 870 687)">TOKYO BAY</text>`;
 // Faint road network exists before rail; it remains an alternative transport mode.
 for(const n of s.nodes){const nearest=s.nodes.filter(m=>m.id!==n.id).sort((a,b)=>R.distance(n,a)-R.distance(n,b)).slice(0,2);for(const m of nearest)html+=`<path d="M${n.x} ${n.y}L${m.x} ${m.y}" stroke="#f8f8f0" stroke-width="5" fill="none"/><path d="M${n.x} ${n.y}L${m.x} ${m.y}" stroke="#d1d9c8" stroke-width="1" fill="none"/>`;}
 for(const n of s.nodes){const count=Math.min(38,Math.round((n.people+n.jobs)/1400)),opacity=layer==='flow'?.32:.8;
  html+=`<g class="district-tile" opacity="${opacity}">`;
  for(let i=0;i<count;i++){const angle=i*2.39996,rad=17+Math.sqrt(i)*7,x=n.x+Math.cos(angle)*rad,y=n.y+Math.sin(angle)*rad,w=6+(i*7+n.id)%9,h=6+(i*3)%8;html+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w}" height="${h}" rx="1" fill="${colors[n.type]}" opacity="${.4+(i%4)*.12}"/>`;}
  html+='</g>';if(layer==='growth'&&n.growth>0)html+=`<circle cx="${n.x}" cy="${n.y}" r="${20+n.growth/24}" fill="#078a7318" stroke="#078a7350"/><text x="${n.x}" y="${n.y-30}" text-anchor="middle" class="growth-label">+${num(n.growth)}</text>`;
 }
 if(layer==='flow')for(const f of metrics.flows.slice(0,18)){const a=s.nodes[f.from],b=s.nodes[f.to];html+=`<path class="flow-link" d="M${a.x} ${a.y} Q${(a.x+b.x)/2} ${(a.y+b.y)/2-65} ${b.x} ${b.y}" fill="none" stroke="#365b7b" stroke-opacity=".15" stroke-width="${Math.min(8,Math.max(1,f.trips/250))}"/>`;}
 for(const t of s.tracks){const a=s.nodes[t.a],b=s.nodes[t.b],c=R.company(s,t.owner),load=metrics.trackLoad[t.id]||0,color=layer==='flow'?(load>1?'#c4563b':load>.65?'#c68d35':c.color):c.color,w=layer==='flow'?4+Math.min(6,load*5):4;
 html+=`<path d="M${a.x} ${a.y}L${b.x} ${b.y}" stroke="#fffdf5" stroke-width="${w+4}" fill="none" stroke-linecap="round"/><path d="M${a.x} ${a.y}L${b.x} ${b.y}" stroke="${color}" stroke-width="${w}" fill="none" stroke-linecap="round"><title>${c.name} · ${a.name}—${b.name} · 高峰需求/运力 ${(load*100).toFixed(0)}%</title></path>`;
 }
 for(const l of s.services){const points=l.stops.map(id=>s.nodes[id]),path=points.map((n,i)=>(i?'L':'M')+n.x+' '+n.y).join(' '),color=R.company(s,l.owner).color;
 html+=`<g class="train"><rect x="-5" y="-3" width="10" height="6" rx="2" fill="white" stroke="${color}" stroke-width="1.5"><animateMotion dur="${(l.headway*2+R.serviceKm(s,l)).toFixed(1)}s" repeatCount="indefinite" path="${path}" rotate="auto"/></rect></g>`;
 }
 if(draft?.length)html+=`<path d="${draft.map((id,i)=>(i?'L':'M')+s.nodes[id].x+' '+s.nodes[id].y).join(' ')}" fill="none" stroke="${company().color}" stroke-width="5" class="draft"/>`;
 for(const n of s.nodes){const b=built.has(n.id),f=focus.has(n.id),label=n.name;html+=`<g class="station" data-node="${n.id}" tabindex="0" role="button" aria-label="${label}，${n.type}，${num(n.people)} 人${b?'，已有铁路':'，候选站'}"><circle class="node-hit" cx="${n.x}" cy="${n.y}" r="20"/>${f?`<circle cx="${n.x}" cy="${n.y}" r="14" fill="none" stroke="${draft?company().color:'#254c53'}" stroke-opacity=".45" stroke-width="2"/>`:''}<circle class="station-ring" cx="${n.x}" cy="${n.y}" r="${b?6:4}" fill="${b?'#fffdf6':'#e8ecdc'}" stroke="${b?'#294b50':'#78917d'}" stroke-width="${b?2:1.5}"/><text class="node-label" x="${n.x}" y="${n.y+24}" text-anchor="middle">${label}</text><title>${n.name} · 人口 ${num(n.people)} · 岗位 ${num(n.jobs)}</title></g>`;}
 html+=`<g transform="translate(970 80)" fill="#526e69"><path d="M0 25V0L-5 9M0 0L5 9" fill="none" stroke="#526e69" stroke-width="1.4"/><text x="0" y="-8" text-anchor="middle" font-size="10">N</text></g><g transform="translate(775 705)" stroke="#526e69"><path d="M0 0h111m-111-4v8m111-8v8"/><text x="55" y="-7" text-anchor="middle" fill="#526e69" stroke="none" font-size="9">约 5 km</text></g>`;
 svg.innerHTML=html;const w=1040/zoom,h=740/zoom;svg.setAttribute('viewBox',`${(1040-w)/2} ${(740-h)/2} ${w} ${h}`);if(!playing)svg.pauseAnimations?.();
}
function renderDraft(){
 const el=$('buildbar');el.hidden=!draft;document.body.classList.toggle('building',!!draft);if(!draft)return;
 const q=R.quoteBuild(s,selected,draft);el.innerHTML=`<div class="build-info"><strong>${draft.length?draft.map(id=>s.nodes[id].name).join(' → '):'点击地图上的候选站，按顺序规划线路'}</strong><p class="${q.error&&draft.length>1?'error':''}">${q.error?esc(q.error):`${q.km.toFixed(1)} km · ${draft.length} 站 · 建设投入 ${q.cost.toFixed(1)} 百万円`}</p></div><button id="undo-draft" ${!draft.length?'disabled':''}>撤销一站</button><button id="cancel-draft">取消</button><button class="primary" id="confirm-build" ${q.error||q.cost>company().cash?'disabled':''}>确认开通</button>`;
}
function nodeClick(id){if(draft){if(draft.includes(id)){toast('该站已经在草图中；可以撤销最后一站。');return;}if(draft.length>=10){toast('第一版每条新线最多 10 站。');return;}draft.push(id);renderMap();renderDraft();}else{district=id;tab='city';render();}}
function recalc(){metrics=R.evaluate(s);save();render();}
document.addEventListener('click',e=>{
 const b=e.target.closest('button,a,g[data-node]');if(!b)return;
 if(b.dataset.node!==undefined){nodeClick(+b.dataset.node);return;}
 if(b.dataset.company){if(draft){toast('请先完成或取消当前草图，再切换公司。');return;}selected=b.dataset.company;render();return;}
 if(b.dataset.tab){tab=b.dataset.tab;render();return;}
 if(b.dataset.layer){layer=b.dataset.layer;document.querySelectorAll('[data-layer]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b));});renderMap();$('map-status').textContent=layer==='flow'?'线宽表示需求 · 橙红色表示高峰运力紧张':layer==='growth'?'绿色外圈表示上一季新增人口':'点击车站，查看街区与线路';return;}
 if(b.dataset.close){$(b.dataset.close).close();return;}
 switch(b.id){
 case 'help-button':pause();$('help').showModal();break;
 case 'reset-button':pause();$('reset-dialog').showModal();break;
 case 'confirm-reset':pause();s=R.newGame();selected='aoba';tab='network';draft=null;throughOpen=false;recalc();$('reset-dialog').close();toast('新一局已开始。');break;
 case 'play':playing?pause():start();break;
 case 'step':advance();break;
 case 'build':pause();draft=[];render();toast('按顺序点击地图圆点，至少选择两站。');break;
 case 'undo-draft':draft.pop();renderMap();renderDraft();break;
 case 'cancel-draft':draft=null;render();break;
 case 'confirm-build':{const result=R.build(s,selected,draft);if(result.error){toast(result.error);break;}draft=null;recalc();toast('新线已开通。客流预测已更新，推进一季观察人口变化。');break;}
 case 'through-toggle':throughOpen=!throughOpen;renderPanel();break;
 case 'through-confirm':{const result=R.through(s,$('through-a').value,$('through-b').value);if(result.error){toast(result.error);break;}throughOpen=false;recalc();toast('直通已开行，双方各投入 12 百万円。');break;}
 case 'zoom-in':zoom=Math.min(1.7,zoom+.2);renderMap();break;
 case 'zoom-out':zoom=Math.max(.8,zoom-.2);renderMap();break;
 case 'zoom-reset':zoom=1;renderMap();break;
 case 'export':{pause();const blob=new Blob([JSON.stringify(s,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='rail-city-year'+(Math.floor(s.quarter/4)+1)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('存档已导出。');break;}
 case 'import-button':pause();$('import-file').click();break;
 }
});
document.addEventListener('keydown',e=>{if(e.target.dataset.tab&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const tabs=['network','finance','city'];tab=tabs[(tabs.indexOf(tab)+(e.key==='ArrowRight'?1:2))%3];render();$('tab-'+tab).focus();return;}const n=e.target.closest('[data-node]');if(n&&(e.key==='Enter'||e.key===' ')){e.preventDefault();nodeClick(+n.dataset.node);}if(e.key==='Escape'&&draft){draft=null;render();}});
document.addEventListener('change',e=>{
 if(e.target.id==='fare'){const r=R.setFare(s,selected,+e.target.value);if(r.error)toast(r.error);else toast('票价已更新；预测客流与收支已重新计算。');recalc();}
 if(e.target.dataset.headway){const r=R.setHeadway(s,e.target.dataset.headway,+e.target.value);if(r.error)toast(r.error);else toast('发车间隔已更新。');recalc();}
 if(e.target.id==='speed'){speed=+e.target.value;if(playing)start();}
});
$('import-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>2000000)throw Error();const candidate=JSON.parse(await file.text());if(!R.validate(candidate))throw Error();s=candidate;draft=null;selected='aoba';tab='network';recalc();toast('存档已恢复。');}catch{toast('无法导入：文件不是兼容的有效游戏存档。当前进度已保留。');}e.target.value='';});
document.addEventListener('visibilitychange',()=>{if(document.hidden){pause();save();}});
window.addEventListener('pagehide',()=>{pause();save();});
render();
