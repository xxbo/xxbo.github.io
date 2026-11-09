/* Network API adapter. Native commands own editing rules, validation and atomic candidates. */
(function(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports,
    R = node ? require('./engine') : root.RailSim,
    T = node ? require('./tokyo') : root.TokyoRegion,
    Editor = node ? require('./editor-wasm') : root.RailEditor,
    Stats = node ? require('./network-stats') : root.RailNetworkStats;
  const SNAP_KM = .06;
  const defaults = s => Editor.mutate(s, 'defaults');
  const tokyo = () => defaults(T.create(R));
  const fresh = () => defaults(R.newGame());

  function emptyWorld(region = 'tokyo') {
    const B = node ? require('./regions') : root.RailRegions,
      cfg = B.get(region),
      s = R.newGame();
    Object.assign(s, {
      region: cfg.id,
      routeModel: 9,
      world: {
        width: cfg.width,
        height: cfg.height
      },
      nodes: [],
      tracks: [],
      services: [],
      log: [],
      nextId: 1
    });
    return defaults(s);
  }
  const removePreset = s => Editor.command(R.clone(s), 'removePreset', {
    seed: T.create(R)
  });
  const runtime = (s, line) => Editor.query(s, 'runtime', {
    line
  });
  const snap = (s, point) => Editor.query(s, 'snap', {
    point
  });
  const insertion = (s, line, point) => Editor.query(s, 'insertion', {
    line,
    point
  });

  function stationInsertion(s, line, point, options = {}) {
    const plan = Editor.query(s, 'stationInsertion', {
      line,
      point,
      options
    });
    if (!Number.isInteger(point)) plan.stops[plan.index] = point;
    return plan;
  }
  const addLine = (s, points, options = null) => Editor.command(s, 'addLine', {
    points,
    options
  });
  const addStation = (s, id, point, options = {}) => Editor.command(s, 'addStation', {
    id,
    point,
    options
  });
  const removeStation = (s, id, nodeId) => Editor.command(s, 'removeStation', {
    id,
    nodeId
  });
  const removeLine = (s, id) => Editor.command(s, 'removeLine', {
    id
  });
  const configure = (s, id, values) => Editor.command(s, 'configure', {
    id,
    values
  });

  function validate(s) {
    try {
      return Editor.query(s, 'validate');
    } catch {
      return false;
    }
  }
  const renameStation = (s, id, name) => Editor.command(s, 'renameStation', {
    id,
    name
  });
  const mergeNearby = s => Editor.command(s, 'mergeNearby');
  const restore = checkpoint => Editor.restore(checkpoint);
  const upgrade = s => Editor.mutate(s, 'upgrade');

  function stats(s, forecast, id) {
    return Stats.line(s, forecast, id);
  }

  function allStats(s, forecast) {
    return Stats.all(s, forecast);
  }


  const api = {
    restore,
    mergeNearby,
    SNAP_KM,
    snap,
    upgrade,
    renameStation,
    emptyWorld,
    removePreset,
    tokyo,
    fresh,
    defaults,
    validate,
    addLine,
    addStation,
    removeStation,
    removeLine,
    configure,
    stats,
    allStats,
    runtime,
    insertion,
    stationInsertion
  };
  if (node) module.exports = api;
  else root.RailNetwork = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
