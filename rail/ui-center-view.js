/* Presentation only: explicit state inputs; no DOM, storage or simulation writes. */
(function(root) {
  'use strict';

  function create({
    Q,
    X,
    F,
    OC,
    num,
    clock,
    esc,
    fmtHeadway
  }) {
    function percent(v) {
      return Number.isFinite(v) ? Math.round(v * 100) + '%' : '超出供给';
    }

    function match(row, centerFilter, centerQuery) {
      const types = row.suggestions.map(x => x.type),
        filter = centerFilter === 'all' || centerFilter === 'add' && types.some(t => ['add', 'stock',
          'crowd'
        ].includes(t)) || centerFilter === 'reduce' && types.includes('reduce') || centerFilter ===
        'pattern' && row.suggestions.some(x => x.action === 'pattern' || ['short', 'express'].includes(x
          .type)) || centerFilter === 'attention' && row.priority >= 60;
      return filter && row.l.name.toLocaleLowerCase().includes(centerQuery.toLocaleLowerCase());
    }

    function satisfaction(s, rows) {
      const scored = rows.filter(r => r.satisfaction !== null),
        total = scored.reduce((v, r) => v + Math.max(0, r.stats.riders), 0),
        weight = r => total ? Math.max(0, r.stats.riders) / total : 1 / Math.max(1, scored.length),
        average = scored.reduce((v, r) => v + r.satisfaction * weight(r), 0),
        scores = Object.fromEntries(Object.keys(Q.WEIGHTS).map(k => [k, scored.reduce((v, r) => v + (Q.line(
          s, r.id).scores?.[k] ?? r.satisfaction) * weight(r), 0)]));
      return `<section class="center-satisfaction"><div class="section-title">乘客满意度总览<small>${total?'按预测客流加权':'按线路平均'}</small></div><div class="satisfaction-network"><strong>${scored.length?(average*100).toFixed(1):'—'}<small> / 100</small></strong><span>${scored.filter(r=>r.satisfaction<.6).length} 条低于60分 · ${scored.filter(r=>r.satisfaction>=.85).length} 条达到85分</span></div><details class="console-details"><summary>全网评分构成</summary><div class="satisfaction-overview-factors">${Object.entries(Q.LABELS).map(([k,label])=>`<span>${label}<b>${scored.length?Math.round(scores[k]*100):'—'}</b></span>`).join('')}</div></details></section>`;
    }

    function reviewContent(rows, centerReview) {
      if (!centerReview) return '';
      const row = rows.find(x => x.id === centerReview.id);
      if (!row) return '';
      const p = centerReview.preview;
      return `<section class="center-review"><div class="section-title">审核投放方案 · ${esc(row.l.name)}<button id="center-cancel">取消</button></div>${p.error?`<p>${esc(p.error)}</p>`:`<div class="center-plan-table"><span>时段</span><span>当前</span><span>调整后</span><b>平峰</b><b>${row.beforeOff} 列</b><b>${p.offPeak} 列</b><b>高峰</b><b>${row.beforePeak} 列</b><b>${p.peak} 列</b></div><p>改为自动投放 · ${row.l.stockSpec} · 当前兼容可配属 ${row.available} 列。${row.shortage?'理想高峰尚缺 '+row.shortage+' 列，本方案仅使用现有库存。':''}</p><p>调整后高峰断面预测负荷 ${percent(p.peakRatio)}，目标80%。${p.peakRatio>1?'现有车辆或交路分配仍不足，需继续购车或调整交路。':''}</p><p class="station-note">保留原交路和停站，仅按比例调整交路配车。现有车上乘客、候车和累计收入保留；减车在完成本次运行后退出。方案将重算需求与间隔。</p><button id="center-confirm" class="primary">应用此投放方案</button>`}</section>`;
    }

    function evidence(s, row) {
      const l = row.l,
        st = row.stats;
      return `<div class="section-title">预测断面高峰需求<small>人 / 小时 · 较忙方向</small></div><div class="center-segments">${row.segments.map(x=>`<div><span>${esc(s.nodes[x.from].name)}—${esc(s.nodes[x.to].name)}</span><i><b style="width:${row.maxDemand?Math.max(1,x.demand/row.maxDemand*100):0}%"></b></i><strong>${num(x.demand*OC.PEAK)}</strong></div>`).join('')}</div><div class="section-title">交路使用占比<small>当前OD路径选择</small></div>${row.runUsage.map((x,i)=>`<div class="detail-row"><span>${i+1}. ${X.KINDS[x.kind]||'普通车'}</span><b>${percent(x.share)}</b></div>`).join('')}<p class="station-note">平峰预测最忙断面负荷 ${row.demand?percent(row.offLoad):'暂无OD'}；当前合计间隔 ${fmtHeadway(st.headway)}。${row.open?'':'当前已正常收车，零候车不作为减车依据。'}站外人数可能由多线共享，需到车站候车页判断。</p><button data-line="${l.id}">打开线路详情与交路编辑</button>`;
    }

    function card(s, minute, row, expanded, centerMatch) {
      const l = row.l,
        st = row.stats,
        suggestions = row.suggestions;
      return `<article class="center-line" data-center-row="${l.id}" style="--color:${l.color}" ${centerMatch(row)?'':'hidden'}><header><i></i><button data-line="${l.id}">${esc(l.name)}</button><span class="line-score-pill" title="乘客满意度">${row.satisfaction===null?'—':Math.round(row.satisfaction*100)}<small> 分</small></span><span class="center-status ${row.priority>=90?'urgent':row.priority>=60?'attention':''}">${row.priority>=90?'优先处理':row.priority>=60?'需要关注':suggestions.length?'优化机会':'运行平稳'}</span></header><div class="center-line-sub">${l.stockSpec} · ${new Set(l.stops).size}站 · ${st.km.toFixed(1)}km · ${row.open?(F.peak(minute)?'高峰运营':'平峰运营'):'非运营时段'}</div><div class="center-metrics"><span>预测日客流<b>${num(st.riders)}</b></span><span>高峰断面负荷<b class="${row.peakLoad>.9?'negative':''}">${row.demand?percent(row.peakLoad):'暂无OD'}</b></span><span>实时最高满载<b>${row.online?percent(row.maxLoad):'无在线列车'}</b></span><span>本线站台候车<b>${num(row.waiting)} 人</b></span></div><div class="center-dispatch"><span>平峰 <b>${row.beforeOff}</b> / 建议 ${row.demand?row.idealOff:'—'} 列</span><span>高峰 <b>${row.beforePeak}</b> / 建议 ${row.demand?row.idealPeak:'—'} 列</span><span>在线 ${row.online} · 预留 ${l.fleet}</span></div><div class="center-advice">${suggestions.map(a=>`<div class="center-advice-row"><span><b>${esc(a.title)}</b><small>${esc(a.reason)}</small></span>${a.action==='dispatch'?`<button data-center-dispatch="${l.id}">审核方案</button>`:a.action==='buy'?`<button data-center-buy="${l.id}">查看车库</button>`:a.action==='pattern'?`<button data-center-pattern="${l.id}" data-center-key="${a.key}">准备草案</button>`:`<button data-line="${l.id}">检查线路</button>`}</div>`).join('')||'<p class="station-note">当前没有明显的运力或交路调整信号。</p>'}</div><details data-center-detail="${l.id}"><summary>查看断面与交路依据</summary><div data-center-evidence="${l.id}">${expanded?evidence(s,row):''}</div></details></article>`;
    }

    function content({
      state: s,
      minute,
      rows,
      metrics: m,
      counts,
      sort,
      query: centerQuery,
      filter: centerFilter,
      error: centerError,
      expanded: open,
      review,
      pulse
    }) {
      const centerMatch = row => match(row, centerFilter, centerQuery);
      const centerSatisfaction = rows => satisfaction(s, rows);
      const centerReviewContent = () => reviewContent(rows, review);
      const centerCard = (row, expanded) => card(s, minute, row, expanded, centerMatch);
      const reviewPulse = () => pulse;
      return [
        `<div class="panel-header"><div class="panel-heading"><div><small class="center-eyebrow">NETWORK CONTROL</small><h2>运营中心</h2></div><button id="close-overview" class="panel-close" aria-label="关闭运营中心">×</button></div><div class="panel-subtitle">${clock(minute)} · ${m.lines} 条线路 · ${m.stations} 站 · ${m.networkKm.toFixed(1)} km线网</div></div><div class="panel-scroll"><div class="center-summary"><div><span>加车 / 库存关注</span><strong>${counts.add}</strong></div><div><span>减车机会</span><strong>${counts.reduce}</strong></div><div><span>交路优化机会</span><strong>${counts.pattern}</strong></div></div><div class="center-tools"><input id="center-search" aria-label="搜索运营线路" placeholder="搜索线路名称" value="${esc(centerQuery)}"><select id="overview-sort" aria-label="线路排序"><option value="default" ${sort==='default'?'selected':''}>优先处理在前</option><option value="riders" ${sort==='riders'?'selected':''}>日客流从高到低</option></select><button id="center-refresh">刷新诊断</button></div><div class="center-filters">${[['all','全部',rows.length],['attention','关注',counts.attention],['add','加车',counts.add],['reduce','减车',counts.reduce],['pattern','交路',counts.pattern]].map(([id,name,n])=>`<button data-center-filter="${id}" class="${centerFilter===id?'active':''}">${name} <b>${n}</b></button>`).join('')}</div>`,
        reviewPulse(),
        ``,
        centerSatisfaction(rows),
        ``,
        centerReviewContent(),
        `<div class="section-title">线路行动清单<small id="center-result-count">${rows.filter(centerMatch).length} / ${rows.length} 条</small></div><div class="center-lines">${rows.map(row=>centerCard(row,open.has(row.id))).join('')}</div><div id="center-empty" ${rows.some(centerMatch)?'hidden':''}><p>${centerError?'后台诊断暂不可用：'+esc(centerError):s.services.length?rows.length?'没有符合当前筛选的线路。':'正在后台分析线网，列车继续运行…':'先建成第一条线路，运营中心就会开始诊断。'}</p></div>`,
        `<details id="center-network"><summary>线网专业指标</summary><div class="stat-grid network-grid"><div><span>日客运量</span><strong>${num(m.journeys)}</strong></div><div><span>客流强度 · 人次/(km·日)</span><strong>${num(m.intensity)}</strong></div><div><span>客运周转量 · 人公里/日</span><strong>${num(m.passengerKm)}</strong></div><div><span>平均运距</span><strong>${m.averageDistance.toFixed(1)} km</strong></div><div><span>换乘站</span><strong>${m.interchanges}</strong></div><div><span>换乘出行占比</span><strong>${percent(m.transferShare)}</strong></div><div><span>步行人口覆盖率</span><strong>${percent(m.coverage)}</strong></div><div><span>线路累计长度</span><strong>${m.lineKm.toFixed(1)} km</strong></div></div></details><details id="center-method"><summary>诊断口径与限制</summary><p class="station-note">预测按当前OD路径中容量约束前需求计算，高峰18%、平峰6%折算最忙小时，以80%满载为目标；基础服务目标为高峰8分钟、平峰12分钟，参数属于游戏设定。需求未形成时不自动建议减车。实时最高满载与排队为当前时刻，收车后不用于推断全天空载。交路建议是规则诊断，准备草案不会生效，需要在编辑器审阅并应用。共享轨道容量、环线方向、最低交路配车与兼容库存仍由原规则校验。诊断在后台每10秒更新，修改前再次校验；单线建议可能争用同一份库存，应用顺序会影响后续方案。</p></details></div>`
      ].join('');
    }

    return {
      content,
      match,
      evidence
    };
  }
  const api = {
    create
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RailCenterView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
