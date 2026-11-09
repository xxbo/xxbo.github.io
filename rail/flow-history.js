/* Bounded, actual passenger counts per operating day. Missing history stays missing. */
(function(root) {
  'use strict';
  const History = typeof module !== 'undefined' && module.exports ? require('./history-wasm') : root.RailHistory;
  const STEP = 15,
    SLOTS = 96,
    ORIGIN = 420,
    DAY = 1440,
    FIELDS = ['entered', 'boarded', 'completed'];
  const start = d => ORIGIN + (d.number - 1) * DAY;

  function touch(d, minute) {
    const base = start(d);
    if (minute < base || minute > base + DAY) return null;
    let f = d.flow;
    if (!f || f.version !== 1 || !FIELDS.every(k => Array.isArray(f[k]) && f[k].length === SLOTS)) {
      f = d.flow = {
        version: 1,
        since: minute,
        through: minute,
        ...Object.fromEntries(FIELDS.map(k => [k, Array(SLOTS).fill(0)]))
      };
    }
    f.through = Math.max(f.through, Math.min(base + DAY, minute));
    return f;
  }

  function record(d, minute, kind, n) {
    const field = kind === 'enter' ? 'entered' : kind === 'board' ? 'boarded' : kind === 'complete' ?
      'completed' : null;
    if (!field || !Number.isFinite(n) || n <= 0) return;
    const f = touch(d, minute),
      i = Math.floor((minute - start(d)) / STEP);
    if (f && i >= 0 && i < SLOTS) f[field][i] += n;
  }

  function view(d, field = 'entered', interval = 15) {
    if (!FIELDS.includes(field)) field = 'entered';
    if (![15, 30, 60].includes(interval)) interval = 15;
    return History.view(d, field, interval);
  }
  const api = {
    STEP,
    SLOTS,
    FIELDS,
    touch,
    record,
    view,
    start
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RailFlowHistory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
