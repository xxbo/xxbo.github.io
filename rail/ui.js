'use strict';
const R=RailSim,O=RailOperations,$=id=>document.getElementById(id),STORE='guanchao-rail-v1';
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=n=>Math.round(n).toLocaleString('zh-CN'),money=n=>n.toFixed(1),season=q=>`第 ${Math.floor(q/4)+1} 年 · ${['春','夏','秋','冬'][q%4]}`;
let s=R.newGame(),selected='aoba',tab='network',district=14,layer='city',draft=null,playing=false,speed=1,timer=null,zoom=window.matchMedia('(max-width:520px)').matches?1.7:1,throughOpen=false,toastTimer,storageOK=true,buildMode='dedicated',selectedTrain=null,followTrain=false,camera={x:520,y:370},lastFrame=0,lastHUD=0;
try{const saved=localStorage.getItem(STORE);if(saved){const candidate=R.upgrade(JSON.parse(saved));if(R.validate(candidate))s=candidate;else storageOK=false;}}catch{storageOK=false;}
let metrics=R.evaluate(s),traffic=O.create(s,metrics);
function save(){try{localStorage.setItem(STORE,JSON.stringify(s));storageOK=true;$('save-state').textContent='已存到本机';}catch{storageOK=false;$('save-state').textContent='存档不可用 · 请导出';}}
function toast(text){$('toast').textContent=text;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),4300);}
function pause(){playing=false;$('play').textContent='▶ 运行';$('play').setAttribute('aria-label','开始自动运行');$('operating-label').textContent='已暂停';}
function start(){if(draft){toast('请先完成或取消线路草图。');return;}playing=true;lastFrame=0;$('play').textContent='Ⅱ 暂停';$('play').setAttribute('aria-label','暂停自动运行');$('operating-label').textContent='运行中';}
function advance(){R.step(s);metrics=R.evaluate(s);traffic=O.create(s,metrics,traffic.minute);save();render();toast('季度已结算；人口与经营预测已更新。');}
function frame(now){
 if(playing&&!document.hidden&&lastFrame){O.advance(traffic,s,Math.min(.15,(now-lastFrame)/1000)*speed);renderTrains();}
 lastFrame=now;if(now-lastHUD>350){updateOperations();lastHUD=now;}requestAnimationFrame(frame);
}
function company(){return R.company(s,selected);}
function render(){
 $('date').textContent=season(s.quarter);$('metrics').innerHTML=`<div class="metric"><span>都市圈人口</span><strong>${(metrics.population/10000).toFixed(1)}<small>万人</small></strong></div><div class="metric"><span>铁路日均出行</span><strong>${(metrics.riders/10000).toFixed(2)}<small>万次</small></strong></div><div class="metric"><span>平均出行时间</span><strong>${metrics.avgTime.toFixed(1)}<small>分钟</small></strong></div><div class="metric"><span>轨道分担率</span><strong>${(metrics.share*100).toFixed(1)}<small>%</small></strong></div>`;
 $('companies').innerHTML=s.companies.map(c=>`<button data-company="${c.id}" style="--company:${c.color}" class="${c.id===selected?'active':''}" aria-pressed="${c.id===selected}"><i class="company-dot"></i>${c.short}</button>`).join('');
 const c=company(),a=metrics.accounts[c.id],net=a.revenue+a.accessIncome-a.cost;
 $('company-heading').innerHTML=`<div class="company-title"><h2>${c.name}</h2><span>${selected==='aoba'?'郊区私铁':selected==='metro'?'都心地下铁':'都市圈干线'}</span></div><div class="cash ${c.cash<0?'negative':''}">${money(c.cash)}<small>百万円 · 可用资金</small></div><div class="cash-hint">预计本季经营 ${net>=0?'+':''}${money(net)} · 未含建设支出</div>`;
 document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===tab)));
 renderPanel();renderMap();renderDraft();$('track-count').textContent=R.serviceKm(s,{trackIds:s.tracks.map(t=>t.id)}).toFixed(1);
 $('events').innerHTML=s.log.slice(0,2).map(e=>`<div><time>${season(e.q)}</time>${esc(e.text)}</div>`).join('');
 $('map-status').textContent=draft?'按顺序点击候选站，规划 '+c.name+' 的新线':layer==='flow'?'线宽表示需求 · 橙红色表示高峰运力紧张':layer==='growth'?'绿色外圈表示上一季新增人口':'拖动地图 · 点击列车或车站';
 $('step').disabled=!!draft;
 if(!storageOK)$('save-state').textContent='存档需重新保存 · 可导出备份';
}
function lineCard(l){
 const owners=R.participants(s,l),km=R.serviceKm(s,l),flow=metrics.serviceFlow[l.id]||0;
 const shared=l.trackIds.filter(id=>s.tracks.find(t=>t.id===id).owner!==R.operatorAt(s,l,l.trackIds.indexOf(id))).length;
 return `<article class="line-card" style="--company:${R.company(s,l.owner).color}"><div class="line-title"><i></i>${esc(l.name)}${l.through?'<span class="badge">跨公司直通</span>':''}</div><div class="line-route">${l.stops.map(id=>s.nodes[id].name).join(' → ')}</div><div class="line-foot"><span>${km.toFixed(1)} km · ${num(flow)} 乘次/日</span><select data-headway="${l.id}" aria-label="${esc(l.name)}发车间隔">${[4,5,6,8,10,12,15].map(h=>`<option value="${h}" ${h===l.headway?'selected':''}>每 ${h} 分钟一班</option>`).join('')}</select></div>${!l.through?`<button class="line-expand" data-parallel="${l.id}">＋ 沿线加建独立复线</button>`:''}${shared?'<p class="panel-note">借用其他公司轨道 · 按季支付租用费</p>':''}${owners.length>1?'<p class="panel-note">'+owners.map(id=>R.company(s,id).name).join(' × ')+' · 共享轨道时隙</p>':''}</article>`;
}
function renderPanel(){
 const c=company(),a=metrics.accounts[c.id],lines=s.services.filter(l=>R.participants(s,l).includes(selected));
 if(tab==='infrastructure'){
 $('panel').innerHTML=`<div class="section-heading"><span>线路建设</span><b>BUILD / CONNECT</b></div>${buildChoices()}<button class="primary wide" id="build">在地图上规划线路 →</button><div class="subhead"><span>本公司轨道资产</span><span>${s.tracks.filter(t=>t.owner===selected).length} 区段</span></div>${s.tracks.filter(t=>t.owner===selected).map(t=>`<div class="asset-row"><div><strong>${s.nodes[t.a].name}—${s.nodes[t.b].name}</strong><small>独立上下行 · ${t.km.toFixed(1)} km</small></div><b>${R.loadTph(s,t.id).toFixed(1)}<small>/30 班/时</small></b></div>`).join('')}<p class="panel-note">复线是新增一组上下行轨道。地图上会并排显示，列车使用各自的轨道时隙。</p>`;
 }else if(tab==='network'){
 const candidates=s.services.filter(l=>!l.through&&l.stops[0]!==l.stops.at(-1));
 $('panel').innerHTML=`<div class="panel-actions"><button class="primary" id="build">＋ 新建线路</button><button id="through-toggle">⇄ 跨公司直通</button></div><div class="fare-row"><label for="fare">公司基础票价 <small>円 / 次行程</small></label><select id="fare">${[100,150,180,200,220,240,250,280,300,350,400,450,500,...(![100,150,180,200,220,240,250,280,300,350,400,450,500].includes(c.fare)?[c.fare]:[])].sort((a,b)=>a-b).map(v=>`<option value="${v}" ${v===c.fare?'selected':''}>¥ ${v}</option>`).join('')}</select></div>${throughOpen?`<div class="through-box"><h3>接续两家公司的端点站</h3><select id="through-a" aria-label="第一条直通线路">${candidates.map(l=>`<option value="${l.id}" ${l.owner==='aoba'?'selected':''}>${esc(l.name)} · ${R.company(s,l.owner).short}</option>`).join('')}</select><select id="through-b" aria-label="第二条直通线路">${candidates.map(l=>`<option value="${l.id}" ${l.owner==='metro'?'selected':''}>${esc(l.name)} · ${R.company(s,l.owner).short}</option>`).join('')}</select><p class="panel-note">双方各投入 12 百万円 · 新增每 10 分钟一班的直通服务 · 联程票价优惠 15%</p><button id="through-confirm" class="primary wide">开通直通服务</button></div>`:''}<div class="subhead"><span>运营服务</span><span>${lines.length} 条</span></div>${lines.map(lineCard).join('')||'<p class="empty">还没有线路。先在地图上连接两个候选站。</p>'}<p class="panel-note">修改后即更新预测；结算一季才记账。轨道每方向合计最多 30 班/小时。票款按承运里程分配。</p>`;
 }else if(tab==='finance'){
 const latest=c.ledger[0];$('panel').innerHTML=`<div class="subhead"><span>下一季经营预测</span><span>百万円 / 季</span></div><div class="finance-grid"><div><span>票务收入</span><strong>${money(a.revenue)}</strong></div><div><span>运营与维护</span><strong>${money(a.cost)}</strong></div><div><span>经营结余</span><strong class="${a.revenue+a.accessIncome>=a.cost?'positive':'negative'}">${money(a.revenue+a.accessIncome-a.cost)}</strong></div><div><span>待计入建设投入</span><strong>${money(c.pendingCapital||0)}</strong></div></div><div class="rental-summary"><span>轨道租用收入 <b>${money(a.accessIncome)}</b></span><span>租用费支出 <b>${money(a.accessCost)}</b> <small>已计运营支出</small></span></div><div class="subhead"><span>现金走势 · 季度结算</span><span>${c.ledger.length} 季</span></div><div class="mini-bars">${[...c.ledger].slice(0,12).reverse().map(l=>`<i title="${season(l.q-1)}：${money(l.cash)} 百万円" style="height:${Math.max(3,Math.min(100,l.cash/Math.max(1,...c.ledger.map(v=>v.cash))*100))}%"></i>`).join('')||'<span class="panel-note">推进一季后开始记录</span>'}</div><table class="ledger"><thead><tr><th>季度</th><th>收入</th><th>运营¹</th><th>建设</th><th>期末现金</th></tr></thead><tbody>${c.ledger.slice(0,8).map(l=>`<tr><td>${Math.floor((l.q-1)/4)+1}年${(l.q-1)%4+1}季</td><td>${money(l.revenue)}</td><td>${money(l.cost)}</td><td>${money(l.capital)}</td><td>${money(l.cash)}</td></tr>`).join('')||'<tr><td colspan="5">尚未结算</td></tr>'}</tbody></table><p class="panel-note">¹ 运营支出包含轨道租用费，租用收入另计入结余。建设资金即时扣款；季度账本单独列示，不会重复扣除。独立账户允许出现负现金，此时不能继续投资；本版暂不计债务与利息。</p>`;
 }else{
 const n=s.nodes[district],served=s.services.filter(l=>l.stops.includes(n.id)),reach=metrics.reach[n.id];let reason;
 if(!served.length)reason='目前没有轨道服务。修建到就业中心的连接线，有机会吸引新增居民。';else if(reach<15000)reason='已有车站，但 45 分钟内可达岗位仍然不足，增长受限。可改善连接、班次或减少换乘。';else if(n.people>=n.housing*.95)reason='交通条件较好，但住房接近容量上限。第一版暂不开放扩容，新增人口会转向其他地区。';else reason='已连入就业网络，且有剩余住房容量，具备吸引新增居民的条件。人口会在季度结算时逐步增加。';
 $('panel').innerHTML=`<div class="district-head"><h3>${n.name}</h3><span>${n.type}</span></div><div class="detail-row"><span>居住人口</span><b>${num(n.people)} 人</b></div><div class="detail-row"><span>就业岗位</span><b>${num(n.jobs)} 个</b></div><div class="detail-row"><span>住房容量</span><b>${num(n.housing)} 人</b></div><div class="detail-row"><span>轨道 45 分钟可达岗位</span><b>${num(reach)} 个</b></div><div class="detail-row"><span>上一季人口变化</span><b class="positive">+${num(n.growth||0)} 人</b></div><div class="insight">${reason}</div><div class="subhead"><span>本站服务</span><span>${served.length} 条</span></div>${served.map(lineCard).join('')||'<p class="empty">○ 尚未建站</p>'}`;
 }
}
function renderMap(){
 const svg=$('map'),colors={'住宅':'#b4c5d2','办公':'#8ea7bb','商业':'#b1a6bd','工业':'#8e9dab','教育':'#b8b89c','田园':'#a5bda8'};
 const built=new Set(s.services.flatMap(l=>l.stops)),focus=draft?new Set(draft):new Set([district]);
 let html=`<defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#dce5e9" stroke-width=".5"/></pattern><pattern id="water" width="15" height="15" patternUnits="userSpaceOnUse"><path d="M0 8h6m3-3h6" stroke="#a9c6c5" stroke-width=".7"/></pattern><filter id="soft"><feGaussianBlur stdDeviation="13"/></filter></defs><rect width="1040" height="740" fill="#edf2f4"/><path d="M0 0H220Q140 140 75 300T0 550Z" fill="#dce8df"/><path d="M0 0H105Q70 190 0 280Z" fill="#cbded0"/><rect width="1040" height="740" fill="url(#grid)"/><path d="M1040 460Q930 490 905 590Q880 675 710 740H1040Z" fill="#c6e3ee"/><path d="M1040 460Q930 490 905 590Q880 675 710 740H1040Z" fill="url(#water)"/><path d="M860 -20Q810 100 850 240T855 440Q835 510 900 560" fill="none" stroke="#b7d7e4" stroke-width="18"/><path d="M-10 550Q155 525 300 560T540 710" fill="none" stroke="#b7d7e4" stroke-width="13"/><path d="M-10 550Q155 525 300 560T540 710" fill="none" stroke="#d7eaf1" stroke-width="2"/><text x="110" y="70" class="district-name">多摩丘陵</text><text x="505" y="105" class="district-name">東京都市圏</text><text x="870" y="687" class="district-name" transform="rotate(-25 870 687)">TOKYO BAY</text>`;
 // Faint road network exists before rail; it remains an alternative transport mode.
 for(const n of s.nodes){const nearest=s.nodes.filter(m=>m.id!==n.id).sort((a,b)=>R.distance(n,a)-R.distance(n,b)).slice(0,2);for(const m of nearest)html+=`<path d="M${n.x} ${n.y}L${m.x} ${m.y}" stroke="#ffffff" stroke-width="5" fill="none"/><path d="M${n.x} ${n.y}L${m.x} ${m.y}" stroke="#d4dfe6" stroke-width="1" fill="none"/>`;}
 for(const n of s.nodes){const count=Math.min(38,Math.round((n.people+n.jobs)/1400)),opacity=layer==='flow'?.32:.8;
  html+=`<g class="district-tile" opacity="${opacity}">`;
  for(let i=0;i<count;i++){const x=n.x+((i%6)-2.5)*16+((n.id*3+i)%4),y=n.y+(Math.floor(i/6)-2.5)*16,w=8+(i*7+n.id)%5,h=8+(i*3)%5;html+=`<rect x="${(x+1.4).toFixed(1)}" y="${(y+2).toFixed(1)}" width="${w}" height="${h}" rx="1" fill="#7893a2" opacity=".15"/><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w}" height="${h}" rx="1" stroke="#ffffff90" stroke-width=".7" fill="${colors[n.type]}" opacity="${.65+(i%4)*.08}"/>`;}
  html+='</g>';if(layer==='growth'&&n.growth>0)html+=`<circle cx="${n.x}" cy="${n.y}" r="${20+n.growth/24}" fill="#078a7318" stroke="#078a7350"/><text x="${n.x}" y="${n.y-30}" text-anchor="middle" class="growth-label">+${num(n.growth)}</text>`;
 }
 if(layer==='flow')for(const f of metrics.flows.slice(0,18)){const a=s.nodes[f.from],b=s.nodes[f.to];html+=`<path class="flow-link" d="M${a.x} ${a.y} Q${(a.x+b.x)/2} ${(a.y+b.y)/2-65} ${b.x} ${b.y}" fill="none" stroke="#365b7b" stroke-opacity=".15" stroke-width="${Math.min(8,Math.max(1,f.trips/250))}"/>`;}
 for(const t of s.tracks){const a=s.nodes[t.a],b=s.nodes[t.b],c=R.company(s,t.owner),load=metrics.trackLoad[t.id]||0,color=layer==='flow'?(load>1?'#d95e4b':load>.65?'#d19a3e':c.color):c.color;
 const same=s.tracks.filter(x=>R.key(x.a,x.b)===R.key(t.a,t.b)).sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true})),index=same.findIndex(x=>x.id===t.id),dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy),offset=(index-(same.length-1)/2)*9*(t.a<t.b?1:-1),ox=-dy/len*offset,oy=dx/len*offset;
 const path=`M${a.x+ox} ${a.y+oy}L${b.x+ox} ${b.y+oy}`;
 html+=`<path d="${path}" stroke="#f8fafb" stroke-width="8" fill="none" stroke-linecap="round"/><path d="${path}" stroke="${color}" stroke-width="5.6" fill="none" stroke-linecap="round"/><path d="${path}" stroke="#ffffff90" stroke-width=".65" fill="none"><title>${c.name} · ${a.name}—${b.name} · ${R.loadTph(s,t.id).toFixed(1)}/30 班/时/方向 · 需求/运力 ${(load*100).toFixed(0)}%</title></path>`;
 }
 html+='<g id="train-layer"></g>';
 if(draft?.length)html+=`<path d="${draft.map((id,i)=>(i?'L':'M')+s.nodes[id].x+' '+s.nodes[id].y).join(' ')}" fill="none" stroke="${company().color}" stroke-width="5" class="draft"/>`;
 for(const n of s.nodes){const b=built.has(n.id),f=focus.has(n.id),label=n.name;html+=`<g class="station" data-node="${n.id}" tabindex="0" role="button" aria-label="${label}，${n.type}，${num(n.people)} 人${b?'，已有铁路':'，候选站'}"><circle class="node-hit" cx="${n.x}" cy="${n.y}" r="20"/>${f?`<circle cx="${n.x}" cy="${n.y}" r="14" fill="none" stroke="${draft?company().color:'#254c53'}" stroke-opacity=".45" stroke-width="2"/>`:''}<circle class="station-ring" cx="${n.x}" cy="${n.y}" r="${b?6:4}" fill="${b?'#fffdf6':'#edf2f4'}" stroke="${b?'#294b50':'#78917d'}" stroke-width="${b?2:1.5}"/><text class="node-label" x="${n.x}" y="${n.y+24}" text-anchor="middle">${label}</text><title>${n.name} · 人口 ${num(n.people)} · 岗位 ${num(n.jobs)}</title></g>`;}
 html+=`<g transform="translate(970 80)" fill="#526e69"><path d="M0 25V0L-5 9M0 0L5 9" fill="none" stroke="#526e69" stroke-width="1.4"/><text x="0" y="-8" text-anchor="middle" font-size="10">N</text></g><g transform="translate(775 705)" stroke="#526e69"><path d="M0 0h111m-111-4v8m111-8v8"/><text x="55" y="-7" text-anchor="middle" fill="#526e69" stroke="none" font-size="9">约 5 km</text></g>`;
 svg.innerHTML=html;applyCamera();renderTrains();updateOperations();
}
function renderDraft(){
 const el=$('buildbar');el.hidden=!draft;document.body.classList.toggle('building',!!draft);if(!draft)return;
 const q=R.quoteBuild(s,selected,draft,buildMode);el.innerHTML=`${buildChoices()}<div class="build-info"><strong>${draft.length?draft.map(id=>s.nodes[id].name).join(' → '):'点击地图上的候选站，按顺序规划线路'}</strong><p class="${q.error&&draft.length>1?'error':''}">${q.error?esc(q.error):`新增复线 ${q.newKm.toFixed(1)} km · 借轨 ${q.sharedKm.toFixed(1)} km · 投入 ${q.cost.toFixed(1)} 百万円`}</p></div><button id="undo-draft" ${!draft.length?'disabled':''}>撤销一站</button><button id="cancel-draft">取消</button><button class="primary" id="confirm-build" ${q.error||q.cost>company().cash?'disabled':''}>确认开通</button>`;
}
function nodeClick(id){if(draft){if(draft.includes(id)){toast('该站已经在草图中；可以撤销最后一站。');return;}if(draft.length>=10){toast('第一版每条新线最多 10 站。');return;}draft.push(id);renderMap();renderDraft();}else{district=id;tab='city';render();}}
function recalc(){metrics=R.evaluate(s);traffic=O.create(s,metrics,traffic.minute);selectedTrain=null;followTrain=false;save();render();}
document.addEventListener('click',e=>{
 const b=e.target.closest('button,a,g[data-node],g[data-train]');if(!b)return;
 if(b.dataset.train){selectedTrain=b.dataset.train;followTrain=false;updateOperations();renderTrains();return;}
 if(b.dataset.mode){buildMode=b.dataset.mode;renderPanel();renderDraft();return;}
 if(b.dataset.parallel){const l=s.services.find(x=>x.id===b.dataset.parallel);pause();buildMode='dedicated';draft=[...l.stops];if(draft[0]===draft.at(-1)){draft=null;toast('环状线请在建设面板分段扩建。');return;}render();toast('已预览沿线独立复线，可比较借轨开行的成本。');return;}
 if(b.dataset.node!==undefined){nodeClick(+b.dataset.node);return;}
 if(b.dataset.company){if(draft){toast('请先完成或取消当前草图，再切换公司。');return;}selected=b.dataset.company;render();return;}
 if(b.dataset.tab){tab=b.dataset.tab;render();return;}
 if(b.dataset.layer){layer=b.dataset.layer;document.querySelectorAll('[data-layer]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b));});renderMap();$('map-status').textContent=layer==='flow'?'线宽表示需求 · 橙红色表示高峰运力紧张':layer==='growth'?'绿色外圈表示上一季新增人口':'拖动地图 · 点击列车或车站';return;}
 if(b.dataset.close){$(b.dataset.close).close();return;}
 switch(b.id){
 case 'help-button':pause();$('help').showModal();break;
 case 'reset-button':pause();$('reset-dialog').showModal();break;
 case 'confirm-reset':pause();s=R.newGame();traffic.minute=420;selected='aoba';tab='network';draft=null;throughOpen=false;recalc();$('reset-dialog').close();toast('新一局已开始。');break;
 case 'train-close':selectedTrain=null;followTrain=false;updateOperations();renderTrains();break;
 case 'train-follow':followTrain=!followTrain;if(followTrain)zoom=Math.max(2,zoom);renderTrains();updateOperations();break;
 case 'play':playing?pause():start();break;
 case 'step':advance();break;
 case 'build':pause();draft=[];render();toast('按顺序点击地图圆点，至少选择两站。');break;
 case 'undo-draft':draft.pop();renderMap();renderDraft();break;
 case 'cancel-draft':draft=null;render();break;
 case 'confirm-build':{const result=R.build(s,selected,draft,buildMode);if(result.error){toast(result.error);break;}draft=null;recalc();toast('新线已开通。客流预测已更新，结算一季观察人口变化。');break;}
 case 'through-toggle':throughOpen=!throughOpen;renderPanel();break;
 case 'through-confirm':{const result=R.through(s,$('through-a').value,$('through-b').value);if(result.error){toast(result.error);break;}throughOpen=false;recalc();toast('直通已开行，双方各投入 12 百万円。');break;}
 case 'zoom-in':zoom=Math.min(3,zoom+.25);renderMap();break;
 case 'zoom-out':zoom=Math.max(.8,zoom-.2);renderMap();break;
 case 'zoom-reset':zoom=window.matchMedia('(max-width:520px)').matches?1.7:1;camera={x:520,y:370};followTrain=false;renderMap();break;
 case 'export':{pause();const blob=new Blob([JSON.stringify(s,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='rail-city-year'+(Math.floor(s.quarter/4)+1)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('存档已导出。');break;}
 case 'import-button':pause();$('import-file').click();break;
 }
});
document.addEventListener('keydown',e=>{if(e.target.dataset.tab&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const tabs=['network','infrastructure','finance','city'];tab=tabs[(tabs.indexOf(tab)+(e.key==='ArrowRight'?1:3))%4];render();$('tab-'+tab).focus();return;}const n=e.target.closest('[data-node]');if(n&&(e.key==='Enter'||e.key===' ')){e.preventDefault();nodeClick(+n.dataset.node);}if(e.key==='Escape'&&draft){draft=null;render();}});
document.addEventListener('change',e=>{
 if(e.target.id==='fare'){const r=R.setFare(s,selected,+e.target.value);if(r.error)toast(r.error);else toast('票价已更新；预测客流与收支已重新计算。');recalc();}
 if(e.target.dataset.headway){const r=R.setHeadway(s,e.target.dataset.headway,+e.target.value);if(r.error)toast(r.error);else toast('发车间隔已更新。');recalc();}
 if(e.target.id==='speed'){speed=+e.target.value;if(playing)start();}
});
$('import-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>2000000)throw Error();const candidate=R.upgrade(JSON.parse(await file.text()));if(!R.validate(candidate))throw Error();s=candidate;draft=null;selected='aoba';tab='network';recalc();toast('存档已恢复。');}catch{toast('无法导入：文件不是兼容的有效游戏存档。当前进度已保留。');}e.target.value='';});
document.addEventListener('visibilitychange',()=>{if(document.hidden){pause();save();}});
window.addEventListener('pagehide',()=>{pause();save();});
render();
requestAnimationFrame(frame);
if(!document.hidden)start();

function buildChoices(){const price=mode=>{if(!draft||draft.length<2)return mode==='dedicated'?'独立容量':'共享容量';const q=R.quoteBuild(s,selected,draft,mode);return q.error?'不可用':q.cost.toFixed(1)+' M';};return `<div class="build-choices"><button data-mode="dedicated" class="${buildMode==='dedicated'?'chosen':''}" aria-pressed="${buildMode==='dedicated'}"><span>▥</span><div><strong>新建独立复线</strong><small>较贵 · 新增轨道和独立容量</small></div><i>${price('dedicated')}</i></button><button data-mode="shared" class="${buildMode==='shared'?'chosen':''}" aria-pressed="${buildMode==='shared'}"><span>⇄</span><div><strong>借轨开行</strong><small>优先借用 · 无轨道区段仍需新建</small></div><i>${price('shared')}</i></button></div>`;}
function viewSpan(){const rect=$('map').getBoundingClientRect(),aspect=rect.width/Math.max(1,rect.height),w=Math.max(1040,740*aspect)/zoom;return {w,h:w/aspect};}
function applyCamera(){const {w,h}=viewSpan();camera.x=w>=1040?520:Math.max(w/2,Math.min(1040-w/2,camera.x));camera.y=h>=740?370:Math.max(h/2,Math.min(740-h/2,camera.y));$('map').setAttribute('viewBox',`${camera.x-w/2} ${camera.y-h/2} ${w} ${h}`);}
function renderTrains(){
 const container=$('train-layer');if(!container)return;
 const active=new Set(traffic.trains.map(t=>t.id));container.querySelectorAll('[data-train]').forEach(el=>{if(!active.has(el.dataset.train))el.remove();});
 for(const t of traffic.trains){let el=container.querySelector(`[data-train="${t.id}"]`);const l=s.services.find(l=>l.id===t.service),c=R.company(s,l.owner),pos=O.position(s,t);
  if(!el){el=document.createElementNS('http://www.w3.org/2000/svg','g');el.dataset.train=t.id;el.setAttribute('class','sim-train');el.setAttribute('role','button');el.setAttribute('tabindex','0');el.innerHTML=`<title></title><rect class="train-target" x="-20" y="-12" width="40" height="24" rx="7"/><rect class="train-shadow" x="-17" y="-2" width="34" height="9" rx="3"/><g class="carriages" fill="#fdfefe" stroke="${c.color}" stroke-width="1.6"><rect x="-17" y="-4" width="10" height="8" rx="2"/><rect x="-5" y="-4" width="10" height="8" rx="1.4"/><rect x="7" y="-4" width="10" height="8" rx="2"/></g><path d="M-15-1h5M-3-1h6M10-1h4" stroke="${c.color}" stroke-width="2"/><rect x="13.5" y="-2" width="2" height="4" fill="#193944"/><circle class="train-light" cx="17" cy="0" r="1.3" fill="#f7cf65"/>`;container.appendChild(el);}
  el.setAttribute('transform',`translate(${pos.x.toFixed(2)} ${pos.y.toFixed(2)}) rotate(${pos.angle.toFixed(1)}) scale(.66)`);el.classList.toggle('selected',selectedTrain===t.id);el.setAttribute('data-status',t.status);el.setAttribute('data-onboard',String(Math.round(t.onboard)));el.setAttribute('aria-label',`${t.id} ${l.name} ${t.status==='moving'?'行进中':t.status==='signal'?'等待信号':'停站中'} ${num(t.onboard)}人`);el.querySelector('title').textContent=`${t.id} · ${l.name} · ${num(t.onboard)}/800 人 · 点击查看`;
  if(followTrain&&selectedTrain===t.id){camera={x:pos.x,y:pos.y};applyCamera();}
 }
}
function updateOperations(){
 const q=O.summary(traffic),m=Math.floor(traffic.minute)%1440;$('operating-time').textContent=String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');$('running-count').textContent=q.active;$('moving-count').textContent=q.moving;$('waiting-count').textContent=num(q.waiting);$('onboard-count').textContent=num(q.onboard);
 const box=$('train-inspector'),t=traffic.trains.find(t=>t.id===selectedTrain);if(!t){box.hidden=true;return;}box.hidden=false;
 const l=s.services.find(l=>l.id===t.service),c=R.company(s,l.owner),p=O.position(s,t);
 if(box.dataset.train!==t.id){box.dataset.train=t.id;box.innerHTML=`<div class="inspector-top"><span style="color:${c.color}">● ${esc(l.name)}</span><button id="train-close" aria-label="关闭列车详情">✕</button></div><h3>${t.id}<small id="train-state"></small></h3><p id="train-location"></p><div class="train-metrics"><div><span>运行速度</span><b id="train-speed"></b><small>km/h</small></div><div><span>车内人数</span><b id="train-load"></b><small>/ 800</small></div><button id="train-follow">跟随列车 ↗</button></div>`;}
 $('train-state').textContent=t.status==='moving'?'行进中':t.status==='signal'?'等待共用区段信号':'停车上下客';$('train-location').textContent=t.status==='moving'?s.nodes[t.segment.from].name+' → '+s.nodes[t.segment.to].name+' · 约 '+Math.max(0,t.arriveAt-traffic.minute).toFixed(1)+' 分钟到站':'停靠 '+s.nodes[t.stops[t.index]].name;$('train-speed').textContent=Math.round(p.speed);$('train-load').textContent=num(t.onboard);$('train-follow').textContent=followTrain?'取消跟随':'跟随列车 ↗';
}
let drag=null;
$('map').addEventListener('pointerdown',e=>{if(e.target.closest('[data-node],[data-train]')||draft)return;followTrain=false;drag={x:e.clientX,y:e.clientY,cx:camera.x,cy:camera.y};$('map').setPointerCapture(e.pointerId);});
$('map').addEventListener('pointermove',e=>{if(!drag)return;const rect=$('map').getBoundingClientRect();camera={x:drag.cx-(e.clientX-drag.x)/rect.width*viewSpan().w,y:drag.cy-(e.clientY-drag.y)/rect.height*viewSpan().h};applyCamera();});
$('map').addEventListener('pointerup',()=>{drag=null;});$('map').addEventListener('pointercancel',()=>{drag=null;});
$('map').addEventListener('keydown',e=>{const t=e.target.closest('[data-train]');if(t&&['Enter',' '].includes(e.key)){e.preventDefault();selectedTrain=t.dataset.train;followTrain=false;updateOperations();renderTrains();}});

window.addEventListener('resize',()=>{applyCamera();});
