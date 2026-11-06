/* Demand never blocks map input. Worker caches the fixed city-wide OD distribution. */
importScripts('game-balance.js?v=17', 'fleet.js?v=18', 'regions.js?v=16', 'gba-data.js?v=16',
  'routing-wasm.js?v=45', 'service-plan.js?v=41', 'engine.js?v=41', 'tokyo-data.js?v=9', 'hubs.js?v=43', 'connection-model.js?v=43',
  'bounded-cache.js?v=40', 'demand-kernels.js?v=43', 'demand-world.js?v=43', 'demand-model.js?v=43', 'city-development.js?v=35', 'urban-growth.js?v=36',
  'city.js?v=19',
  'flow-history.js?v=32', 'ridership.js?v=45', 'operations.js?v=30', 'demand-rates.js?v=31',
  'simulation-wasm.js?v=45', 'queue-runtime.js?v=45', 'passengers.js?v=45');
onmessage = async ({
  data: m
}) => {
  try {
    await Promise.all([self.RailDataReady, self.RailRoutingReady]);
    const result = RailCity.evaluate(m.state);
    result.preparedDefinitions = RailPassengers.definitions(m.state, result);
    postMessage({
      id: m.id,
      result
    });
  } catch (e) {
    postMessage({
      id: m.id,
      error: e.message
    });
  }
};
