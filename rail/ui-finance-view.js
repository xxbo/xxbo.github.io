/* Presentation only: explicit state inputs; no DOM, storage or simulation writes. */
(function(root) {
  'use strict';

  function create({
    M,
    num,
    money,
    clock,
    esc
  }) {
    function content(s, lineStats, available) {
      const e = s.economy;
      return [
        `<header class="screen-header"><div><span>RAIL MANAGEMENT</span><h1>财务</h1></div><button id="goto-stations">候车 →</button><button id="close-account" class="panel-close" aria-label="关闭财务">×</button></header><div class="finance-content"><div class="balance-rule">发展模式 · 票款另奖11倍发展金 · 运营成本65%</div><div class="finance-summary"><div><span>可用余额</span><strong id="account-cash">${money(e.cash)}</strong><small id="account-blocked"></small></div><div><span>本局票款收入</span><strong id="actual-revenue">${money(e.revenue)}</strong></div><div><span>运营发展金 · 游戏奖励</span><strong id="actual-grant">${money(e.operatingGrant)}</strong></div><div><span>运营与维护支出</span><strong id="actual-operating">${money(e.operating)}</strong></div><div><span>未偿贷款本金</span><strong id="finance-principal"></strong></div></div><div class="finance-columns"><section class="finance-card"><h2>资金收支</h2><div class="detail-row"><span>建设成本调整返还 · 一次性</span><b>${money(e.infrastructureRebate)}</b></div><div class="detail-row"><span>建设与购车投入</span><b>${money(e.construction)}</b></div><div class="detail-row"><span>资产回收</span><b>${money(e.salvage)}</b></div><div class="detail-row"><span>已偿本金</span><b id="finance-repaid"></b></div><div class="detail-row"><span>已付利息</span><b id="actual-interest"></b></div><div class="detail-row"><span>待付运营账款</span><b id="actual-arrears"></b></div><h2>资金流水</h2><div id="money-ledger"></div></section>`,
        `<section class="finance-card"><h2>贷款</h2><p class="finance-note">本金合计上限 1.5 亿元，最多 3 笔。每笔 500 万—5000 万元；日息 0.05%，30 个游戏日等额本金，每 24 个模拟小时自动还本付息，可提前结清。无自动借款。</p><div class="loan-actions"><select id="loan-amount" aria-label="贷款金额"><option value="100000000">500 万元</option><option value="500000000">2500 万元</option><option value="1000000000">5000 万元</option></select><button id="borrow-money" ${available<1e8?'disabled':''}>申请贷款</button></div><p class="finance-note">当前单笔可申请 ${money(available)}</p><div id="loan-list"></div><details class="finance-rules"><summary>游戏计费规则</summary><p>金额均为人民币。初始余额 2.5 亿元，不预置线路、车站或车辆。轨道每 km 400 万元，车站 200 万元，车厢每节 15 万元。拆除回收轨道/车站的 20%、车辆的 50%。票款只在完成旅程后入账；每收到1元实际票款另发11元运营发展金，单独记账。车辆运行及固定运营成本按原版65%结算；借款利息与还本不打折。余额不足或到期未还会暂停运营。以上均为游戏规则。</p></details></section></div>`,
        `<section class="finance-card finance-lines"><h2>线路财务预测</h2><p class="finance-note">工作日预测：票款＋运营发展金−运营支出。实际结算受运能、候车与完成量影响。</p><div class="table-wrap"><table><thead><tr><th>线路</th><th>日票款</th><th>日发展金</th><th>日支出</th><th>日净收入</th></tr></thead><tbody>${s.services.map(l=>{const st=lineStats.get(l.id);return `<tr><td>${esc(l.name)}</td><td>${money(st.revenue)}</td><td>${money(st.operatingGrant)}</td><td>${money(st.cost)}</td><td>${money(st.totalIncome-st.cost)}</td></tr>`;}).join('')||'<tr><td colspan="5">建成线路后显示每日预测</td></tr>'}</tbody></table></div></section></div>`
      ].join('');
    }

    function live(s) {
      const e = s.economy;
      return {
        fields: {
          'account-cash': money(e.cash),
          'account-blocked': e.blocked ? '资金不足或贷款到期未还，运营暂停' : '',
          'actual-revenue': money(e.revenue),
          'actual-grant': money(e.operatingGrant),
          'actual-operating': money(e.operating),
          'actual-interest': money(e.interestPaid),
          'actual-arrears': money(e.arrears),
          'finance-principal': money(e.loans.reduce((v, l) => v + l.principal, 0)),
          'finance-repaid': money(e.principalPaid)
        },
        loans: e.loans.map(l =>
          `<div class="loan-card"><b>贷款 ${l.id} · 剩余 ${money(l.principal)}</b><span>已计利息 ${money(l.interest)} · 下次应还约 ${money(Math.min(l.principal,l.installment)+l.interest+l.principal*M.RATE*Math.max(0,l.nextDue-e.minute)/1440)}</span><span>${Math.max(0,(l.nextDue-e.minute)/1440).toFixed(2)} 天后扣款</span><button data-repay="${l.id}">提前结清 ${money(l.principal+l.interest)}</button></div>`
        ).join('') || '<p class="station-note">暂无贷款</p>',
        ledger: e.ledger.slice(0, 12).map(x =>
          `<div class="detail-row"><span>第 ${Math.floor((x.minute-420)/1440)+1} 天 ${clock(x.minute)}<br>${esc(x.type)}</span><b>${x.amount>=0?'+':'−'}${money(Math.abs(x.amount))}</b></div>`
        ).join('')
      };
    }

    return {
      content,
      live
    };
  }
  const api = {
    create
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RailFinanceView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
