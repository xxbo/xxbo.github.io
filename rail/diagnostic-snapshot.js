/* Only the fields used by operations-center/metrics cross the worker boundary.
   Returned objects are a transport projection; postMessage clones them before use. */
(function(root) {
  'use strict';

  function totals(rows) {
    return Object.fromEntries(Object.entries(rows || {}).map(([id, values]) => [id, {
      total: Object.values(values).reduce((sum, n) => sum + n, 0)
    }]));
  }

  function capture(state, runtime) {
    return {
      state: {
        routeModel: state.routeModel,
        operatingPlan: state.operatingPlan,
        services: state.services,
        tracks: state.tracks,
        nodes: state.nodes,
        depot: state.depot,
        ridership: state.ridership ? {
          model: state.ridership.model,
          lines: state.ridership.lines
        } : undefined,
        economy: {
          minute: state.economy.minute
        }
      },
      runtime: {
        minute: runtime.minute,
        trains: runtime.trains.map(train => ({
          parentLine: train.parentLine,
          service: train.service,
          onboard: train.onboard,
          capacity: train.capacity
        })),
        queues: runtime.nativeView?.queues||totals(runtime.queues),
        outside: runtime.nativeView?.outside||totals(runtime.outside)
      }
    };
  }

  const api = {
    capture
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RailDiagnosticSnapshot = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
