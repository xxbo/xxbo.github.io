function world(lines = 3, patterns = 1) {
  const s = {
    routeModel: 9,
    economy: {
      minute: 480
    },
    world: {
      width: 1000,
      height: 1000
    },
    nodes: [],
    tracks: [],
    services: []
  };
  for (let i = 0; i < lines; i++) {
    const stops = Array.from({
        length: 20
      }, (_, j) => i * 20 + j),
      trackIds = stops.slice(1).map((_, j) => 't' + i + '_' + j);
    s.nodes.push(...stops.map((id, j) => ({
      id,
      x: 40 + j * 10,
      y: 40 + i * 10
    })));
    s.tracks.push(...trackIds.map((id, j) => ({
      id,
      a: stops[j],
      b: stops[j + 1],
      km: .45
    })));
    s.services.push({
      id: 'l' + i,
      name: 'line' + i,
      stops,
      trackIds,
      headway: 8,
      fleet: 10,
      fleetManaged: true,
      stockSpec: '6B',
      dispatch: {
        mode: 'auto',
        manual: 10,
        offPeak: 10,
        peak: 10
      },
      patterns: Array.from({
        length: patterns
      }, (_, j) => ({
        kind: j ? 'express' : 'local',
        from: 0,
        to: 19,
        calls: [2, 5, 9, 13, 17].map(j=>i*20+j),
        fleet: 2,
        headway: 8
      }))
    });
  }
  return s;
}
module.exports = {
  world
};
