/* Forecast passenger indicators; physical track IDs count once, irrespective of services. */
(function(root) {
  'use strict';
  const Q = typeof module !== 'undefined' && module.exports ? require('./ridership') : root.RailRidership;

  function summary(s, f) {
    const trackIds = new Set(s.services.flatMap(l => l.trackIds)),
      tracks = s.tracks.filter(t => trackIds.has(t.id)),
      stations = new Map();
    for (const l of s.services)
      for (const id of new Set(l.stops)) {
        if (!stations.has(id)) stations.set(id, new Set());
        stations.get(id).add(l.id);
      }
    const tracksById = new Map(s.tracks.map(track => [track.id, track]));
    const networkKm = tracks.reduce((sum, track) => sum + track.km, 0);
    const lineKm = s.services.reduce((sum, line) => sum + line.trackIds.reduce(
      (length, id) => length + (tracksById.get(id)?.km || 0), 0), 0);
    let journeys = 0;
    let passengerKm = 0;
    let transferTrips = 0;
    for (const flow of f.flows || []) {
      const trips = flow.trips * Q.factor(s, flow);
      journeys += trips;
      passengerKm += trips * flow.path.km;
      if (flow.path.transfers > 0) transferTrips += trips;
    }
    return {
      networkKm,
      lineKm,
      stations: stations.size,
      interchanges: [...stations.values()].filter(v => v.size > 1).length,
      lines: s.services.length,
      fleet: s.services.reduce((a, l) => a + l.fleet, 0),
      journeys,
      passengerKm,
      intensity: networkKm ? journeys / networkKm : 0,
      averageDistance: journeys ? passengerKm / journeys : 0,
      transferShare: journeys ? transferTrips / journeys : 0,
      coverage: f.population ? f.catchment.covered / f.population : 0
    };
  }
  const api = {
    summary
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RailMetrics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
