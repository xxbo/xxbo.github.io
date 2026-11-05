/* Pure HTML views. Selection, events, DOM patching and persistence stay in ui.js. */
(function(root) {
  'use strict';

  function create({
    REVIEW,
    Q,
    currency,
    clock,
    money,
    num,
    esc
  }) {
    function reviewTime(minute) {
      return '第 ' + Q.day(minute) + ' 天 ' + clock(minute);
    }

    function reviewPlan(p) {
      if (!p) return '无线路';
      const d = p.dispatch;
      return `${p.stations}站 · ${d.mode==='auto'?'平峰 '+d.offPeak+' / 高峰 '+d.peak:'手动 '+d.manual}列 · ${p.patterns.length}个交路 · ${clock(p.open)}—${p.close===1440?'24:00':clock(p.close)}`;
    }

    function reviewMetric(e, label, key, format, unit, better) {
      const a = e.beforeRates[key],
        b = e.afterRates[key],
        delta = e.comparable && a !== null && b !== null ? b - a : null,
        nearZero = delta !== null && Math.abs(delta) < (['load', 'quality'].includes(key) ? .0005 : key ===
          'wait' ? .05 : key === 'profit' ? 10 : .5),
        color = delta === null || nearZero || better === 0 ? '' : delta * better > 0 ? 'better' : 'worse',
        text = delta === null ? '—' : nearZero ? '≈0' : (delta > 0 ? '+' : '') + (key === 'profit' ? money(
            delta) : key === 'load' || key === 'quality' ? (delta * 100).toFixed(1) + ' 点' : key ===
          'wait' ? delta.toFixed(1) + ' 分' : num(delta) + ' /h');
      return `<div class="review-metric"><span>${label}<small>${unit}</small></span><b>${a===null?'—':format(a)}</b><b>${b===null?'—':format(b)}</b><em class="${color}">${text}</em></div>`;
    }

    function reviewCard(s, raw) {
      const e = REVIEW.view(raw),
        live = s.services.some(l => l.id === e.line),
        progress = Math.min(100, e.after.minutes / e.target * 100),
        ongoing = ['pending', 'warming', 'observing'].includes(e.status);
      return `<article class="review-card" data-review-id="${e.id}"><header><span>${reviewTime(e.minute)}</span><b class="review-status ${ongoing?'active':e.comparable?'done':''}">${e.statusLabel}</b></header><h3>${esc(e.name)}</h3><div class="review-kinds">${e.kinds.map(k=>`<span>${esc(k)}</span>`).join('')}</div>${ongoing?`<div class="review-progress"><i style="width:${progress}%"></i></div><p class="review-stage">${e.status==='pending'?'等待最新需求接入，现有列车与乘客继续运行。':e.status==='warming'?(e.awaitOpening?'等待线路开行，再预热15个游戏分钟。':'需求已更新，先预热15个游戏分钟。'):'已观察 '+e.after.minutes.toFixed(0)+' / '+e.target.toFixed(0)+' 个运营分钟'}</p>`:''}${e.reason?`<p class="review-stage">${esc(e.reason)}</p>`:''}<div class="review-window"><span>调整前：${e.before.minutes?reviewTime(e.before.from)+'—'+clock(e.before.to)+' · '+e.before.minutes.toFixed(0)+'分钟':'无历史采样'}</span><span>调整后：${e.afterFrom?reviewTime(e.afterFrom)+'—'+clock(e.afterTo||e.afterFrom+e.after.minutes)+' · '+e.after.minutes.toFixed(0)+'分钟':'尚未开始正式观察'}</span></div>${e.before.minutes<REVIEW.MINIMUM-1e-5?'<p class="review-caution">调整前样本不足30分钟，仅展示已采集数据，不判定改善。</p>':''}<div class="review-table"><div class="review-table-head"><span>实际运营</span><b>调整前</b><b>调整后</b><b>差值</b></div>${reviewMetric(e,'上车人次','boarded',num,'人次 / 小时',1)}${reviewMetric(e,'完成旅程','completed',num,'人次 / 小时',1)}${reviewMetric(e,'平均候车','wait',n=>n.toFixed(1),'分钟',-1)}${reviewMetric(e,'采样车载率','load',n=>(n*100).toFixed(1)+'%','快照均值',0)}${reviewMetric(e,'满意度','quality',n=>(n*100).toFixed(1),'分',1)}${reviewMetric(e,'运营结余','profit',money,'人民币 / 小时',1)}</div>${e.flags.length?`<div class="review-flags">${e.flags.map(f=>`<span>${esc(f)}</span>`).join('')}</div>`:''}<details class="review-plan"><summary>方案变化与判断口径</summary><p>前：${esc(reviewPlan(e.beforePlan))}</p><p>后：${esc(reviewPlan(e.afterPlan))}</p>${e.kinds.includes('票价')?`<p>票价档位（元）：${(e.beforePlan?.fares||[]).map(v=>currency.toCNY(v).toFixed(1)).join(' / ')} → ${(e.afterPlan?.fares||[]).map(v=>currency.toCNY(v).toFixed(1)).join(' / ')}</p>`:''}<p>客流和收支按实际观察分钟折算每小时；候车按本期上车乘客的实际等待统计，包含调整前已在等候的人。完成旅程指曾使用本线的完整出行，可能滞后于调整。车载率为5分钟快照，不是全时段连续测量；无在线列车时不填零。运营结余含发展金，不扣建设与贷款。差值按未四舍五入的原始值计算。满意度有平滑延迟；这些是前后观察信号，不是排除其他因素后的因果结论。</p></details>${live?`<div class="review-actions"><button data-line="${e.line}">线路详情</button><button data-review-observe="${e.line}">重新观察</button></div>`:''}</article>`;
    }

    function content(s, reviewLine, reviewFilter) {
      const r = s.operationsReview,
        events = (r?.events || []).filter(e => (!reviewLine || e.line === reviewLine) && (reviewFilter ===
          'all' || reviewFilter === 'active' && ['pending', 'warming', 'observing'].includes(e.status) ||
          reviewFilter === 'complete' && e.status === 'complete')),
        active = r?.events.filter(e => ['pending', 'warming', 'observing'].includes(e.status)).length || 0,
        complete = r?.events.filter(e => e.status === 'complete').length || 0;
      return `<div class="review-hero"><span>实际运营观察</span><strong>${active}<small>项观察中</small></strong><p>${complete} 项已完成 · 保留最近 ${REVIEW.LIMIT} 次调整</p></div><div class="review-tools"><select id="review-line-filter" aria-label="筛选效果记录线路"><option value="">全部线路</option>${s.services.map(l=>`<option value="${l.id}" ${reviewLine===l.id?'selected':''}>${esc(l.name)}</option>`).join('')}${reviewLine&&!s.services.some(l=>l.id===reviewLine)?`<option selected value="${esc(reviewLine)}">已删除线路</option>`:''}</select><button id="review-back-center">线路调度 →</button></div><div class="review-filters">${[['all','全部'],['active','观察中'],['complete','已完成']].map(([id,label])=>`<button data-review-filter="${id}" class="${reviewFilter===id?'active':''}">${label}</button>`).join('')}</div><div class="review-records">${events.map(event => reviewCard(s, event)).join('')||`<div class="review-empty"><h3>${r?.events.length?'当前筛选没有记录':'尚无调整记录'}</h3><p>加减车、调整交路、票价或车站后会自动记录。先运行至少30个运营分钟以积累基线；需求更新后预热15分钟，再观察前后各约一小时。</p>${reviewLine&&s.services.some(l=>l.id===reviewLine)?`<button data-review-observe="${reviewLine}">按当前方案开始观察</button>`:'<button data-ui-trigger="overview-toggle">查看线路调度</button>'}</div>`}</div>`;
    }

    function pulse(s) {
      const e = s.operationsReview?.events[0];
      if (!e) return '';
      const v = REVIEW.view(e);
      return `<button class="review-pulse" data-review-line="${e.line}"><span>最近调整 · ${esc(e.name)}</span><strong>${v.statusLabel} →</strong></button>`;
    }

    return {
      content,
      pulse
    };
  }
  const api = {
    create
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RailReviewView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
