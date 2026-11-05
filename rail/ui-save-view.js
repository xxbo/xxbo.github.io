/* Presentation only: explicit state inputs; no DOM, storage or simulation writes. */
(function(root) {
  'use strict';

  function create({
    B,
    money,
    clock,
    esc
  }) {
    function content({
      state: s,
      cfg,
      pendingImport,
      saveStatus,
      saveMeta,
      importError,
      region
    }) {
      const c = pendingImport,
        st = c?.state,
        target = c ? B.get(c.region) : null;
      return `<div class="urban-hero"><span>本地存档 · 已暂停 · ${cfg.name}</span><strong>${s.services.length}<small>条线路</small></strong><p>第 ${Math.floor((s.economy.minute-420)/1440)+1} 天 · ${money(s.economy.cash)} · ${[...new Set(s.services.flatMap(l=>l.stops))].length} 站</p></div><div class="save-status" role="status"><b>IndexedDB · 本机数据库</b><span>${esc(saveStatus)}</span>${saveMeta?.bytes?'<small>当前存档 '+(saveMeta.bytes/1024/1024).toFixed(2)+' MB</small>':''}</div><div class="plan-actions"><button id="save-local-now">立即保存到浏览器</button><button id="export-local-save" class="primary">导出当前存档 · JSON</button></div><p class="station-note">保存已建成的线网、车辆、城市、财务、满意度、客流运行进度和本地图纪录；未应用的草图与编辑不包含在内。</p><div class="section-title">从文件恢复</div><input id="local-save-file" type="file" accept=".json,application/json" hidden><button id="choose-local-save">选择本地存档文件</button><p class="station-note">文件只在此浏览器解析，不上传服务器。支持64MB以内JSON，先校验并预览，确认后存入本机数据库并替换对应地图；其他地图保留。导入后保持暂停。</p>${importError?`<p class="save-error" role="alert">${esc(importError)}</p>`:''}${c?`<section class="save-preview"><h3>待导入 · ${target.name}</h3><div class="detail-row"><span>线路 / 运营站</span><b>${st.services.length} / ${new Set(st.services.flatMap(l=>l.stops)).size}</b></div><div class="detail-row"><span>游戏时间</span><b>第 ${Math.floor((st.economy.minute-420)/1440)+1} 天 ${clock(st.economy.minute)}</b></div><div class="detail-row"><span>可用资金</span><b>${money(st.economy.cash)}</b></div><div class="detail-row"><span>城市设施</span><b>${st.urban?.facilities?.length||0}</b></div><p>${c.runtime?'包含列车、候车与在途乘客进度。':'此文件仅包含建设进度，导入后重新安排运行班次。'}</p><p>将替换本机「${target.name}」存档。可先导出当前进度保留备份。</p><div class="plan-actions"><button id="cancel-local-import">取消导入</button><button id="confirm-local-import" class="primary">确认导入${c.region!==region?'并切换地图':''}</button></div></section>`:''}`;
    }

    return {
      content
    };
  }
  const api = {
    create
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RailSaveView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
