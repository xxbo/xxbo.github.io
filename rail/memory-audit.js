/* Bounded, cheap samples. Browser heap values describe this JS isolate, not total RAM. */
(function(root) {
  'use strict';

  function create(limit = 48) {
    const samples = [];
    let last = -Infinity,
      peak = 0;

    function record(phase, state, forecast, runtime, queue = null) {
      let used = null;
      try {
        const heap = root.performance?.memory;
        used = Number.isFinite(heap?.usedJSHeapSize) ? heap.usedJSHeapSize : null;
      } catch {}
      if (used !== null) peak = Math.max(peak, used);
      const row = {
        phase,
        minute: runtime?.minute ?? state?.economy?.minute ?? 0,
        flows: forecast?.flows?.length || 0,
        profiles: runtime?.demandCatalog?.length || 0,
        realized: runtime?.defs?.length || 0,
        trains: runtime?.trains?.length || 0,
        heap: used,
        peak: peak || null,
        save: queue?.stats() || null
      };
      samples.push(row);
      if (samples.length > limit) samples.shift();
      return row;
    }
    return {
      record,
      tick(now, ...args) {
        if (now - last < 5000) return;
        last = now;
        return record('running', ...args);
      },
      latest() {
        return samples.at(-1) || null;
      },
      history() {
        return samples.map(row => ({
          ...row,
          save: row.save ? {
            ...row.save
          } : null
        }));
      }
    };
  }
  const api = {
    create
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RailMemoryAudit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
