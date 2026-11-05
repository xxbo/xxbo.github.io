/* Presentation only: explicit state inputs; no DOM, storage or simulation writes. */
(function(root) {
  'use strict';

  function create({
    F,
    X,
    Q,
    V,
    currency,
    num,
    money,
    clock,
    esc
  }) {
    function fmtHeadway(h) {
      return Number.isFinite(h) ? h.toFixed(1) + ' 分钟 / 班' : '未投放';
    }

    function specOptions(value) {
      return Object.values(F.SPECS).map(v =>
        `<option value="${v.id}" ${v.id===value?'selected':''}>${v.id} · 游戏定员 ${num(v.capacity)} 人</option>`
      ).join('');
    }

    function trainOptions(value) {
      return Array.from({
          length: 41
        }, (_, i) => i * 2).map(n => `<option value="${n}" ${n===value?'selected':''}>${n} 列</option>`)
        .join('');
    }

    function frequency(s, l, p, i) {
      try {
        return fmtHeadway(X.headway(s, X.compile(s, l, p, i)));
      } catch {
        return '应用后计算';
      }
    }

    function vehicleControls(s, minute, l, st) {
      const spec = F.SPECS[l.stockSpec],
        d = l.dispatch,
        n = F.planned(l, minute);
      return `<div class="section-title">车辆与投放<small>规格已锁定</small></div><div class="stock-identity"><b>${l.stockSpec}</b><span>${spec.cars} 辆 · ${spec.type} 型 · 游戏定员 ${num(spec.capacity)} 人 / 列</span></div><div class="stat-grid"><div><span>本线预留 / 兼容库存</span><strong>${l.fleet}<small> / ${s.depot.stock[l.stockSpec]} 列</small></strong></div><div><span>当前计划投放</span><strong id="dispatch-live">${n}<small>列 · ${d.mode==='auto'?(F.peak(minute)?'高峰':'平峰'):'手动'}</small></strong></div></div><div class="config-row"><label for="dispatch-mode">投放方式</label><select id="dispatch-mode"><option value="manual" ${d.mode==='manual'?'selected':''}>手动投放</option><option value="auto" ${d.mode==='auto'?'selected':''}>自动 · 平峰 / 高峰</option></select></div><div class="config-row" data-dispatch-row="manual" ${d.mode==='manual'?'':'hidden'}><label for="dispatch-manual">手动投放</label><select id="dispatch-manual">${trainOptions(d.manual)}</select></div><div class="config-row" data-dispatch-row="auto" ${d.mode==='auto'?'':'hidden'}><label for="dispatch-offpeak">平峰投放</label><select id="dispatch-offpeak">${trainOptions(d.offPeak)}</select></div><div class="config-row" data-dispatch-row="auto" ${d.mode==='auto'?'':'hidden'}><label for="dispatch-peak">高峰投放</label><select id="dispatch-peak">${trainOptions(d.peak)}</select></div><div class="plan-actions"><button id="recommend-dispatch">按客流推荐</button><button id="save-dispatch" class="primary">应用投放</button><button id="open-depot">列车库 / 购车</button></div><p id="dispatch-pending" class="dispatch-pending" hidden>投放调整尚未应用，当前间隔仍按已生效计划显示。</p><div class="auto-headway"><span>计划行车间隔 · 自动计算</span><b id="computed-headway">${fmtHeadway(st.headway)}</b></div><p class="station-note">高峰 07:00—09:00、17:00—19:00，其余为平峰。推荐按预测客流、周转时间、80%目标满载和兼容库存估算，可手动微调。预留量为当前模式最大投放量，同规格库存不重复分配；0 列停运。双向各半，最短间隔 2 分钟。收车完成本次运行后入库，可能暂时多于计划数量。</p><div class="config-row"><label>运营时间</label><div class="hours"><input type="time" id="open" aria-label="首班时间" value="${clock(l.open)}"><span>—</span><input type="time" id="close" aria-label="末班时间" value="${clock(l.close)}"></div></div>`;
    }

    function identityControls(l) {
      return `<div class="section-title">线路设置</div><div class="identity-form"><label for="line-name">线路名称</label><input id="line-name" maxlength="40" value="${esc(l.name)}"><label for="line-color">线路颜色</label><input type="color" id="line-color" value="${l.color}"><button id="save-line-identity">保存名称与颜色</button></div>`;
    }

    function stopOptions(s, l, index) {
      return l.stops.map((id, i) =>
        `<option value="${i}" ${i===index?'selected':''}>${i+1}. ${esc(s.nodes[id].name)}</option>`).join(
        '');
    }

    function ringControls(s, l) {
      if (l.stops[0] !== l.stops.at(-1)) return '';
      return `<div class="section-title">环线运行</div><div class="config-row"><label for="loop-direction">运行方向</label><select id="loop-direction">${[['both','内外环双向'],['forward',X.directionName(s,l,1)+'单向'],['reverse',X.directionName(s,l,-1)+'单向']].map(([id,name])=>`<option value="${id}" ${(l.loopDirection||'both')===id?'selected':''}>${name}</option>`).join('')}</select></div><p class="station-note">列车连续绕行，不在起点折返。双向运营时各分配一半车辆；乘客按行车方向、票价与候车时间选择路径，经过编号起点不需要换车。为维持计划间隔，时刻表余量分摊到沿途停站。</p>`;
    }

    function operationControls(s, l) {
      const fares = X.bands ? X.bands(l) : l.fareBands || X.PRICES,
        patterns = X.patterns(l);
      return `${ringControls(s,l)}<div class="section-title">里程票价<small>人民币 · 元</small></div><div class="fare-grid">${X.LIMITS.map((limit,i)=>`<label>${i?X.LIMITS[i-1]+1:1}—${i===5?'更远':limit} km<input type="number" min="1" max="150" step="0.05" data-fare-band="${i}" aria-label="第 ${i+1} 档票价" value="${currency.toCNY(fares[i])}"></label>`).join('')}</div><button id="save-fares">应用票价</button><p class="station-note">按实际轨道里程向上取整分档计价；跨线分段合计。客流通过广义成本 Logit 模型比较票价、候车、行车、换乘与步行时间。参数为游戏设定，非真实客流预测。</p><div class="section-title">交路与停站规则</div><p class="station-note">全程普通车是大交路；区间车是小交路。快速可勾选停站，直达仅停起终点，跨线需共用车站。各交路共享本线预留车辆，配额合计不得超过 ${l.fleet} 列；平峰按配额比例分配，间隔由车辆数自动计算。</p><div id="pattern-list">${patterns.map((p,i)=>patternCard(s,l,p,i)).join('')}</div><div class="plan-actions"><select id="new-pattern-kind" aria-label="新增交路类型">${Object.entries(X.KINDS).map(([id,name])=>`<option value="${id}">${name}</option>`).join('')}</select><button id="add-pattern">增加交路</button></div><div class="plan-actions"><button id="save-patterns">应用运营规则</button><button id="reset-patterns">恢复普通交路</button></div>`;
    }

    function patternCard(s, l, p, i) {
      let actual = '应用后计算';
      try {
        actual = '当前 ' + fmtHeadway(X.headway(s, X.compile(s, l, p, i)));
      } catch {}
      const other = s.services.find(x => x.id === p.target),
        validTargets = s.services.filter(x => x.id !== l.id && x.stops.some(n => l.stops.includes(n)));
      return `<fieldset class="pattern-card" data-pattern-index="${i}" data-kind="${p.kind}"><legend>${i+1}. ${X.KINDS[p.kind]}</legend><div class="plan-actions"><label>起点<select data-field="from">${stopOptions(s,l,p.from)}</select></label><label>${p.kind==='cross'?'接轨站':'终点'}<select data-field="to">${stopOptions(s,l,p.to)}</select></label></div><div class="plan-actions"><label>高峰配额<input type="number" min="2" max="80" step="2" data-field="fleet" value="${p.fleet}"></label><label>自动间隔<output>${frequency(s,l,p,i)}</output></label></div>${p.kind==='cross'?`<label>接续线路<select data-field="target">${validTargets.map(x=>`<option value="${x.id}" ${p.target===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label><label>跨线终点<select data-field="targetEnd">${other?stopOptions(s,other,p.targetEnd):''}</select></label>`:''}${p.kind==='express'?`<div class="call-options">${l.stops.map((id,j)=>`<label><input type="checkbox" data-call="${id}" ${p.calls?.includes(id)?'checked':''}>${esc(s.nodes[id].name)}</label>`).join('')}</div>`:''}<p class="pattern-frequency">${actual}</p><button data-drop-pattern="${i}">删除此交路</button></fieldset>`;
    }

    function lineTabs() {
      return [
        ['overview', '概况'],
        ['dispatch', '车辆'],
        ['stations', '车站'],
        ['rules', '交路'],
        ['settings', '设置']
      ];
    }

    function connectionCard(forecast, l) {
      const r = forecast.lineConnections?.[l.id];
      if (!r) return '';
      const names = {
          work: '通勤',
          shopping: '购物',
          leisure: '休闲 / 到访'
        },
        total = r.demand,
        dominant = Object.entries(r.purposes).sort((a, b) => b[1] - a[1])[0]?.[0];
      return `<details id="line-connections" class="connection-card"><summary>需求构成与连接<small>${total?(names[dominant]||'多用途')+'为主':'待形成需求'}</small></summary><p class="connection-caption">基础需求 · 运能约束前</p><div class="connection-purposes">${Object.entries(names).map(([key,name])=>`<div><span>${name}</span><i><b style="width:${total?r.purposes[key]/total*100:0}%"></b></i><strong>${total?Math.round(r.purposes[key]/total*100):0}%</strong></div>`).join('')}</div><div class="connection-facts"><span>沿线接驳居民 <b>${num(r.people)}</b></span><span>沿线接驳岗位 <b>${num(r.jobs)}</b></span><span>市内通勤覆盖岗位 <b>${num(r.reachableJobs)}</b></span><span>平均全程耗时 <b>${total?Math.round(r.minutes)+' 分钟':'暂无需求'}</b></span></div><details id="line-choices" class="console-details"><summary>线路选择与分流</summary><div class="detail-row"><span>有其他可接受路线的客流占比</span><b>${Math.round(r.sharedShare*100)}%</b></div><div class="detail-row"><span>需要换乘的客流占比</span><b>${Math.round(r.transferShare*100)}%</b></div><div class="detail-row"><span>其中枢纽接驳需求</span><b>${num(r.hub)} 人次/日</b></div><p class="station-note">每份出行需求先受居民和目的地活动供给约束，再选择交通方式与路线。平行服务共享同一份需求，增加有效班次可以缩短候车；票价高、绕行或换乘多会降低竞争力。沿线接驳按步行800米分摊；市内通勤覆盖岗位为本线所参与市内通勤路径的就业端接驳岗位，含经其他线路到达，不是新增工作岗位或保证客流。枢纽接驳包含在上方用途内，不能再次相加。</p></details></details>`;
    }

    function cultivationCard(s, l) {
      const r = Q.line(s, l.id),
        scores = r.scores || {},
        observed = r.observations || {};
      return `<section class="cultivation-card satisfaction-card"><div><b>乘客满意度</b><strong>${((r.satisfaction??.7)*100).toFixed(1)}<small> / 100</small></strong></div><div class="cultivation-track"><i style="width:${(r.satisfaction??.7)*100}%"></i></div><p>客流系数 ×${r.factor.toFixed(2)} · 本线单日最高 ${num(r.bestDay||0)} 人次</p><details class="console-details satisfaction-breakdown"><summary>查看评分构成</summary><div class="satisfaction-factors">${Object.entries(Q.WEIGHTS).map(([k,w])=>`<div><span>${Q.LABELS[k]}<small> ${Math.round(w*100)}%</small></span><i><b style="width:${(scores[k]??.7)*100}%"></b></i><strong>${Math.round((scores[k]??.7)*100)}</strong></div>`).join('')}</div></details><small>按当前计划与实际运营估算，非真实问卷。候车约 ${(observed.wait||0).toFixed(1)} 分钟 · 平均车载 ${Math.round((observed.load||0)*100)}% · 拒入 ${Math.round((observed.loss||0)*100)}%。满意度在运营中平滑变化，影响到站客流；不再按开通天数自动增长。</small></section>`;
    }

    function content({
      state: s,
      forecast,
      minute,
      line: l,
      stats: st,
      tab: lineTab,
      deleteConfirm,
      salvage
    }) {
      const loop = l.stops[0] === l.stops.at(-1),
        stops = loop ? l.stops.slice(0, -1) : l.stops,
        controls = operationControls(s, l),
        cut = controls.indexOf('<div class="section-title">交路与停站规则'),
        fare = controls.slice(0, cut),
        rules = controls.slice(cut);
      return [
        `<div class="panel-header" style="--color:${l.color}"><div class="panel-heading"><span class="line-mark">${s.services.indexOf(l)+1}</span><h2>${esc(l.name)}</h2><button class="panel-close" id="close-panel" aria-label="关闭线路详情">×</button></div><div class="panel-subtitle"><span>${stops.length} 站 · ${st.km.toFixed(1)} km${loop?' · 环线':''}</span><b><span id="line-running">0</span> 列在线</b></div></div><div class="line-tabbar" role="tablist" aria-label="线路详情分类">${lineTabs().map(([id,label])=>`<button role="tab" id="line-tab-${id}" aria-controls="line-view-${id}" data-line-tab="${id}" aria-selected="${lineTab===id}">${label}</button>`).join('')}</div><div class="panel-scroll"><div id="line-alarm"></div><section role="tabpanel" id="line-view-overview" aria-labelledby="line-tab-overview" data-line-view="overview" ${lineTab==='overview'?'':'hidden'}>${cultivationCard(s,l)}<div class="section-title">日运营预测<small>工作日模型</small></div><div class="stat-grid"><div><span>线路客流量</span><strong>${num(st.riders)}<small>人次 / 日</small></strong></div><div><span>交路合计运力</span><strong>${num(60/st.headway*st.capacity)}<small>人 / h</small></strong></div><div><span>预计票款</span><strong>${money(st.revenue)}</strong></div><div><span>预计经营结余</span><strong>${money(st.totalIncome-st.cost)}</strong></div></div>${connectionCard(forecast,l)}<div class="line-next-actions"><button data-line-tab="dispatch">调整车辆 →</button><button data-line-tab="stations">查看车站 →</button><button data-review-line="${l.id}">调整效果 →</button></div><p class="station-note">以上为工作日预测，经营结余包含发展金。实际收支见财务，实时完成客流见线网客流。</p></section>`,
        `<section role="tabpanel" id="line-view-dispatch" aria-labelledby="line-tab-dispatch" data-line-view="dispatch" ${lineTab==='dispatch'?'':'hidden'}>${vehicleControls(s,minute,l,st)}<details class="console-details"><summary>在线列车与满载率</summary><div id="live-trains" class="live-trains"></div></details></section>`,
        `<section role="tabpanel" id="line-view-stations" aria-labelledby="line-tab-stations" data-line-view="stations" ${lineTab==='stations'?'':'hidden'}><div class="station-actions"><button id="add-station">＋ 增加车站</button><button id="remove-station" class="danger" ${stops.length<=(loop?3:2)?'disabled':''}>− 减少车站</button></div><div class="section-title">车站客流<small>上 / 下车人次 · 每日预测</small></div><div class="station-table-head"><span>车站</span><span>上车</span><span>下车</span><span></span></div><div class="stops" style="--color:${l.color}">${stops.map((id,i)=>{const n=s.nodes[id],x=st.stations[id];return `${i?`<div class="stop-spacing">↕ ${V.formatDistance(s.tracks.find(t=>t.id===l.trackIds[i-1]).km)}</div>`:''}<div class="stop-row"><button class="stop-name" data-station="${id}"><i></i>${esc(n.name)}</button><span>${num(x.board)}</span><span>${num(x.alight)}</span><span></span></div>`;}).join('')}</div></section>`,
        `<section role="tabpanel" id="line-view-rules" aria-labelledby="line-tab-rules" data-line-view="rules" ${lineTab==='rules'?'':'hidden'}>${rules}</section>`,
        `<section role="tabpanel" id="line-view-settings" aria-labelledby="line-tab-settings" data-line-view="settings" ${lineTab==='settings'?'':'hidden'}>${identityControls(l)}${fare}<details class="console-details line-danger" ${deleteConfirm?'open':''}><summary>删除线路</summary><p>删除前将显示影响及预计资产回收。</p><button class="danger-button" data-ui-trigger="delete-line">删除这条线路</button>${deleteConfirm?`<div class="confirm-delete"><p>删除「${esc(l.name)}」及其服务？其他线路和共用车站会保留。预计资产回收 ${money(salvage)}。</p><div><button id="cancel-delete">取消</button><button class="danger-button" id="confirm-delete">确认删除线路</button></div></div>`:''}</details></section></div>`
      ].join('');
    }

    return {
      content,
      fmtHeadway,
      specOptions,
      trainOptions,
      patternCard,
      stopOptions
    };
  }
  const api = {
    create
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RailLineView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
