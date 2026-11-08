/* Presentation budgets never change passenger counts, fares or operating rules. */
(function(root) {
  'use strict';
  const MODES = {
    auto: {
      name: '自动',
      fps: 30,
      hud: 750,
      budget: 6
    },
    smooth: {
      name: '流畅',
      fps: 45,
      hud: 500,
      budget: 8
    },
    balanced: {
      name: '均衡',
      fps: 24,
      hud: 1000,
      budget: 6
    },
    economy: {
      name: '省电',
      fps: 12,
      hud: 1800,
      budget: 4
    }
  };

  function settings(value) {
    return {
      mode: MODES[value?.mode] ? value.mode : 'auto',
      trainLabels: value?.trainLabels !== false,
      queueLabels: value?.queueLabels !== false,
      detail: ['auto', 'full', 'trains', 'stations'].includes(value?.detail) ? value.detail : 'auto'
    };
  }

  function resolve(p, load = 0) {
    return MODES[p.mode === 'auto' ? (load > 160 ? 'economy' : load > 60 ? 'balanced' : 'auto') : p.mode] ||
      MODES.auto;
  }

  function createClock() {
    let pending = 0;
    return {
      reset() {
        pending = 0;
      },
      get pending() {
        return pending;
      },
      runBudget(elapsed, speed, budget, advance, now) {
        pending += Math.max(0, Math.min(.12, elapsed)) * speed;
        const start = now();
        let ok = true,
          steps = 0;
        if (pending > 1e-8) {
          const result = advance(pending, {budget, maxSteps: 100, now});
          if (!Number.isFinite(result.remaining) || result.remaining < 0 ||
            result.remaining > pending || !Number.isInteger(result.steps) ||
            result.steps < 0 || result.steps > 100) throw Error('Invalid simulation batch result');
          ok = result.running;
          steps = result.steps;
          pending = ok ? result.remaining : 0;
        }
        return {ok, steps, pending, ms: now() - start};
      },
      run(elapsed, speed, budget, advance, now) {
        pending += Math.max(0, Math.min(.12, elapsed)) * speed;
        const start = now();
        let steps = 0,
          ok = true;
        while (pending > 1e-8 && steps < 100) {
          const dt = Math.min(.1, pending);
          if (advance(dt) === false) {
            ok = false;
            pending = 0;
            break;
          }
          pending -= dt;
          steps++;
          if (now() - start >= budget) break;
        }
        return {
          ok,
          steps,
          pending,
          ms: now() - start
        };
      }
    };
  }
  const api = {
    MODES,
    settings,
    resolve,
    createClock
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RailPerformance = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
