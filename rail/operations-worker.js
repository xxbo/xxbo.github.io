/* Read-only diagnostics. Forecast cloned once per revision; never changes the simulation. */
importScripts('game-balance.js?v=17', 'fleet.js?v=48', 'regions.js?v=16', 'routing-wasm.js?v=57', 'temporal-wasm.js?v=48', 'service-plan.js?v=41',
  'value-wire.js?v=57', 'history-wasm.js?v=57', 'flow-history.js?v=57', 'statistics-wasm.js?v=57', 'operations-wasm.js?v=50', 'ridership.js?v=57', 'engine.js?v=41', 'network-stats.js?v=38', 'network.js?v=38',
  'metrics.js?v=38',
  'operations-center.js?v=38');
let forecast = null,
  version = null;
onmessage = async ({
  data: m
}) => {
  try {
    await self.RailRoutingReady;
    if (m.forecast) {
      forecast = m.forecast;
      version = m.version;
    }
    if (!forecast || version !== m.version) throw Error('诊断预测版本不匹配');
    const start = performance.now(),
      rows = RailOperationsCenter.analyze(m.state, forecast, m.runtime),
      metrics = RailMetrics.summary(m.state, forecast);
    postMessage({
      id: m.id,
      version,
      rows,
      metrics,
      ms: performance.now() - start
    });
  } catch (e) {
    postMessage({
      id: m.id,
      error: e.message
    });
  }
};
