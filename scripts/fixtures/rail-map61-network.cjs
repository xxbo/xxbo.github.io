/* Focused map editor model. Hidden legacy city accounts are not part of this UI. */
(function(root) {
  'use strict';
  const R = typeof module !== 'undefined' && module.exports ? require('./rail-map61-engine.cjs') : root.RailSim;
  const T = typeof module !== 'undefined' && module.exports ? require('../../rail/tokyo.js') : root.TokyoRegion;
  const X = typeof module !== 'undefined' && module.exports ? require('./rail-map61-service-plan.cjs') : root
    .RailServicePlan;
  const F = typeof module !== 'undefined' && module.exports ? require('../../rail/fleet') : root.RailFleet;
  const Names = typeof module !== 'undefined' && module.exports ? require('./rail-map61-place-names.cjs') : root
    .RailPlaceNames;
  const Stats = typeof module !== 'undefined' && module.exports ? require('../../rail/network-stats') : root
    .RailNetworkStats;
  const COLORS = ['#4479cf', '#159781', '#d18150', '#a26bc4', '#d25d80', '#789641'];

  function defaults(s) {
    for (const [i, l] of s.services.entries()) {
      l.color = l.color || COLORS[i % COLORS.length];
      l.cars = l.cars || 8;
      l.fleet = l.fleet ?? Math.min(80, 2 * Math.ceil((runtime(s, l) + 1) / l.headway));
      l.open = l.open ?? 360;
      l.close = l.close ?? 1440;
    }
    return s;
  }

  function tokyo() {
    return defaults(T.create(R));
  }

  function emptyWorld(region = 'tokyo') {
    const B = typeof module !== 'undefined' && module.exports ? require('../../rail/regions') : root.RailRegions,
      cfg = B.get(region);
    const s = R.newGame();
    s.region = cfg.id;
    s.routeModel = 9;
    s.world = {
      width: cfg.width,
      height: cfg.height
    };
    s.nodes = [];
    s.tracks = [];
    s.services = [];
    s.log = [];
    s.nextId = 1;
    return defaults(s);
  }

  function removePreset(s) {
    const c = R.clone(s),
      seed = T.create(R),
      ids = new Set(seed.services.map(l => l.id));
    c.services = c.services.filter(l => !ids.has(l.id));
    prune(c);
    const keep = new Set(c.services.flatMap(l => l.stops));
    for (const n of c.nodes)
      if (n.id >= seed.nodes.length) keep.add(n.id);
    const mapping = new Map(),
      nodes = [];
    for (const n of c.nodes)
      if (keep.has(n.id)) {
        mapping.set(n.id, nodes.length);
        nodes.push({
          ...n,
          id: nodes.length
        });
      } c.nodes = nodes;
    for (const l of c.services) l.stops = l.stops.map(id => mapping.get(id));
    for (const tr of c.tracks) {
      tr.a = mapping.get(tr.a);
      tr.b = mapping.get(tr.b);
    }
    return c;
  }

  function fresh() {
    return defaults(R.newGame());
  }

  function runtime(s, l) {
    return l.trackIds.reduce((v, id) => v + s.tracks.find(t => t.id === id).km / 48 * 60 + .6, 0);
  }

  function commit(s, copy) {
    if (!validate(copy)) return {
      error: '线路配置无效，操作未保存。'
    };
    for (const k of Object.keys(s)) delete s[k];
    Object.assign(s, copy);
    return {};
  }
  const SNAP_KM = .06;

  function snap(s, point) {
    if (Number.isInteger(point)) return point;
    let best = null,
      d = SNAP_KM;
    for (const n of s.nodes) {
      if (n.mergedInto !== undefined) continue;
      const km = X.distance(n, point);
      if (km <= d) {
        d = km;
        best = n.id;
      }
    }
    return best;
  }

  function node(s, point) {
    if (Number.isInteger(point)) {
      if (!s.nodes[point]) throw Error('车站不存在。');
      return s.nodes[point].mergedInto ?? point;
    }
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 25 || point.x > (s
        .world?.width || 1040) - 25 || point.y < 25 || point.y > (s.world?.height || 740) - 25) throw Error(
      '请在地图范围内设置车站。');
    const close = snap(s, point);
    if (close !== null) return close;
    if (s.nodes.filter(n => n.mergedInto === undefined).length >= (s.region ? 400 : 200)) throw Error(
      '测试地图最多支持 400 个车站。');
    const id = s.nodes.length,
      naming = Names.suggest(s, point, point.nameSeed ?? Math.random());
    s.nodes.push({
      id,
      name: naming.name,
      nameSource: naming.source,
      nearbyPlace: naming.place,
      x: Math.round(point.x * 1000) / 1000,
      y: Math.round(point.y * 1000) / 1000,
      type: '住宅',
      people: 2200,
      jobs: 500,
      housing: 8000,
      growth: 0,
      initialPeople: 2200,
      initialJobs: 500
    });
    return id;
  }

  function route(s, l, stops, shapes) {
    const oldStops = [...l.stops || []];
    const loop = stops[0] === stops.at(-1),
      unique = loop ? stops.slice(0, -1) : stops;
    if (new Set(unique).size !== unique.length || unique.length < (loop ? 3 : 2)) throw Error(
      '普通线路至少保留两个不同车站，环线至少三个。');
    if (stops.length > (s.region ? 60 : 30)) throw Error('当前地图的单线车站数量已达上限。');
    const ids = [];
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1],
        b = stops[i];
      const bends = shapes?.[i - 1];
      let t = s.tracks.find(t => R.key(t.a, t.b) === R.key(a, b) && t.owner === l.owner && (!bends || JSON
        .stringify(X.rawTrackPoints(s, t, a).slice(1, -1).map(p => ({
          x: p.x,
          y: p.y
        }))) === JSON.stringify(bends.map(p => ({
          x: p.x,
          y: p.y
        })))));
      if (!t) {
        const points = [s.nodes[a], ...(bends || []), s.nodes[b]];
        t = {
          id: 't' + s.nextId++,
          a,
          b,
          owner: l.owner,
          km: X.sum(points),
          ...(bends?.length ? {
            bends: bends.map(p => ({
              x: p.x,
              y: p.y
            }))
          } : {})
        };
        s.tracks.push(t);
      }
      ids.push(t.id);
    }
    if (l.patterns)
      for (const p of l.patterns) {
        const a = oldStops[p.from],
          b = oldStops[p.to];
        p.from = p.kind === 'local' ? 0 : stops.indexOf(a);
        p.to = p.kind === 'local' ? stops.length - 1 : stops.indexOf(b);
        if (p.from < 0 || p.to < 0) throw Error('请先调整以该站为端点的交路。');
        if (p.calls) p.calls = p.calls.filter(id => stops.includes(id));
      }
    for (const other of s.services)
      if (other.id !== l.id && other.patterns)
        for (const p of other.patterns)
          if (p.target === l.id) {
            p.targetEnd = stops.indexOf(oldStops[p.targetEnd]);
            if (p.targetEnd < 0) throw Error('请先调整跨线交路终点。');
          } l.stops = [...stops];
    l.trackIds = ids;
    l.through = false;
    delete l.parents;
    delete l.operators;
    for (const id of l.trackIds)
      if (!s.services.some(x => x.id !== l.id && x.trackIds.includes(id))) delete s.tracks.find(t => t
        .id === id).curve;
    X.geometry(s, l, shapes);
    // This editor gives each overlapping service its own corridor when the combined slots overflow.
    for (let i = 0; i < ids.length; i++)
      if (R.loadTph(s, ids[i]) > 30 + .0001) {
        const old = s.tracks.find(t => t.id === ids[i]),
          t = {
            ...old,
            id: 't' + s.nextId++,
            owner: l.owner
          };
        s.tracks.push(t);
        l.trackIds[i] = t.id;
      }
    prune(s);
  }

  function prune(s) {
    const used = new Set(s.services.flatMap(l => l.trackIds));
    s.tracks = s.tracks.filter(t => used.has(t.id));
  }

  function addLine(s, points, options = null) {
    const c = R.clone(s);
    try {
      if (c.services.length >= 30) return {
        error: '测试地图最多支持 30 条线路。'
      };
      if (!points.length || points[0]?.waypoint || points.at(-1)?.waypoint) throw Error('线路必须以车站开始、以车站结束。');
      const stationPoints = points.filter(p => !p?.waypoint),
        legs = X.draftLegs(c, points),
        stops = stationPoints.map(p => node(c, p));
      if (legs.length !== stops.length - 1) throw Error('线路几何无效。');
      const l = {
        id: 's' + c.nextId++,
        name: '新线路 ' + String(c.services.length + 1).padStart(2, '0'),
        owner: c.companies[c.services.length % 3].id,
        headway: 8,
        through: false,
        color: COLORS[c.services.length % COLORS.length],
        fleet: 12,
        cars: 6,
        open: 360,
        close: 1380
      };
      if (options) {
        if (!F.SPECS[options.stockSpec]) throw Error('请选择线路车型。');
        if (!c.depot) F.upgrade(c);
        l.fleetManaged = true;
        l.stockSpec = options.stockSpec;
        l.cars = F.SPECS[l.stockSpec].cars;
        l.fleet = 0;
        l.dispatch = {
          mode: 'manual',
          manual: 0,
          offPeak: 0,
          peak: 0
        };
      }
      c.services.push(l);
      route(c, l, stops, legs.map(e => e.raw.slice(1, -1)));
      const r = commit(s, c);
      return r.error ? r : {
        id: l.id
      };
    } catch (e) {
      return {
        error: e.message
      };
    }
  }

  function closest(points, n) {
    let best = {
      dist: Infinity,
      segment: 0,
      u: 0
    };
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        dx = b.x - a.x,
        dy = b.y - a.y,
        d = dx * dx + dy * dy,
        u = d ? ((n.x - a.x) * dx + (n.y - a.y) * dy) / d : 0,
        v = Math.max(0, Math.min(1, u)),
        dist = Math.hypot(n.x - a.x - dx * v, n.y - a.y - dy * v);
      if (dist < best.dist) best = {
        dist,
        segment: i - 1,
        u
      };
    }
    return best;
  }

  function insertion(s, l, p) {
    const n = s.nodes[p];
    let best = {
      dist: Infinity,
      index: 1
    };
    for (let i = 1; i < l.stops.length; i++) {
      const t = s.tracks.find(t => t.id === l.trackIds[i - 1]),
        points = X.trackPoints(s, t, l.stops[i - 1]),
        hit = closest(points, n);
      if (hit.dist < best.dist) {
        let index = i;
        if (l.stops[0] !== l.stops.at(-1)) {
          if (i === 1 && hit.segment === 0 && hit.u < 0) index = 0;
          if (i === l.stops.length - 1 && hit.segment === points.length - 2 && hit.u > 1) index = l.stops
            .length;
        }
        best = {
          dist: hit.dist,
          index
        };
      }
    }
    return best.index;
  }

  function stationInsertion(s, l, point, options = {}) {
    const object = !Number.isInteger(point),
      id = object ? s.nodes.length : point,
      model = object ? {
        ...s,
        nodes: [...s.nodes, {
          ...point,
          id
        }]
      } : s,
      index = options.index ?? insertion(model, l, id),
      bends = options.bends || [];
    if (!Number.isInteger(index) || index < 0 || index > l.stops.length || bends.length > 120 || bends.some(
        p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 25 || p.y < 25 || p.x > s.world.width -
        25 || p.y > s.world.height - 25)) throw Error('固定点或插入位置无效。');
    const stops = [...l.stops],
      shapes = l.trackIds.map((id, i) => X.rawTrackPoints(s, s.tracks.find(t => t.id === id), l.stops[i])
        .slice(1, -1));
    stops.splice(index, 0, point);
    const clean = bends.map(p => ({
      x: p.x,
      y: p.y
    }));
    if (index === 0) shapes.unshift([...clean].reverse());
    else if (index === l.stops.length) shapes.push(clean);
    else {
      const points = X.rawTrackPoints(s, s.tracks.find(t => t.id === l.trackIds[index - 1]), l.stops[index -
          1]),
        hit = closest(points, model.nodes[id]);
      shapes.splice(index - 1, 1, [...points.slice(1, hit.segment + 1), ...clean], points.slice(hit
        .segment + 1, -1));
    }
    return {
      index,
      stops,
      shapes
    };
  }

  function addStation(s, id, point, options = {}) {
    const c = R.clone(s);
    try {
      const l = c.services.find(l => l.id === id);
      if (!l) throw Error('请先选择线路。');
      const n = node(c, point);
      if (l.stops.includes(n)) throw Error('该站已经在线路上。');
      const plan = stationInsertion(c, l, n, options);
      route(c, l, plan.stops, plan.shapes);
      return commit(s, c);
    } catch (e) {
      return {
        error: e.message
      };
    }
  }

  function removeStation(s, id, nodeId) {
    const c = R.clone(s);
    try {
      const l = c.services.find(l => l.id === id);
      if (!l || !l.stops.includes(nodeId)) throw Error('车站不在线路中。');
      const loop = l.stops[0] === l.stops.at(-1),
        stops = l.stops.filter(n => n !== nodeId);
      if (loop && stops[0] !== stops.at(-1)) stops.push(stops[0]);
      const shapes = [];
      for (let i = 1; i < stops.length; i++) {
        const a = l.stops.indexOf(stops[i - 1]),
          b = l.stops.indexOf(stops[i]),
          end = loop && b <= a ? b + l.stops.length - 1 : b;
        let path = [];
        for (let j = a; j < end; j++) {
          const ix = j % l.trackIds.length,
            points = X.rawTrackPoints(c, c.tracks.find(t => t.id === l.trackIds[ix]), l.stops[ix]);
          path.push(...(path.length ? points.slice(1) : points));
        }
        shapes.push(path.slice(1, -1));
      }
      route(c, l, stops, shapes);
      return commit(s, c);
    } catch (e) {
      return {
        error: e.message
      };
    }
  }

  function removeLine(s, id) {
    const c = R.clone(s);
    const Core = typeof module !== 'undefined' && module.exports ? require('../../rail/routing-wasm') : root.RailRouting;
    const names = new Map(),
      intern = v => {
        if (!names.has(v)) names.set(v, names.size);
        return names.get(v);
      };
    const values = [1, c.services.length, c.tracks.length];
    for (const l of c.services) {
      const patterns = l.patterns || [];
      values.push(+(l.id === id), patterns.length, ...patterns.map(p => +(p.target === id)), l.trackIds.length,
        ...l.trackIds.map(intern));
    }
    values.push(...c.tracks.map(t => intern(t.id)));
    const plan = Core.kernel('network_remove_line', Float64Array.from(values));
    if (plan[1]) return {
      error: plan[1] === 1 ? '线路不存在。' : '其他线路存在跨线交路，请先移除相关交路。'
    };
    let at = 3;
    const lines = plan.slice(at, at + plan[2]);
    at += plan[2];
    const n = plan[at++];
    c.services = Array.from(lines, i => c.services[i]);
    c.tracks = Array.from(plan.slice(at, at + n), i => c.tracks[i]);
    return commit(s, c);
  }

  function configure(s, id, values) {
    const c = R.clone(s),
      l = c.services.find(l => l.id === id);
    if (!l) return {
      error: '线路不存在。'
    };
    if (l.fleetManaged) {
      if (('cars' in values && values.cars !== l.cars) || ('stockSpec' in values && values.stockSpec !== l
          .stockSpec)) return {
        error: '线路已建成，车型和编组已锁定。'
      };
      if ('fleet' in values || 'headway' in values) return {
        error: '请通过车库投放设置调整列车数量，间隔自动计算。'
      };
      if (values.dispatch) {
        const r = F.configure(l, values.dispatch);
        if (r.error) return r;
        if (F.free(c, l.stockSpec, l.id) < l.fleet) return {
          error: '兼容列车不足，请先到列车库购买或收回其他线路的配属车辆。'
        };
      }
    }
    for (const k of ['fleet', 'cars', 'headway', 'open', 'close', 'name', 'color', 'fareBands', 'patterns',
        'loopDirection'
      ])
      if (k in values) l[k] = values[k];
    if (!l.name?.trim() || l.name.length > 40) return {
      error: '线路名称须为 1–40 个字符。'
    };
    if (c.routeModel === 9 && !X.validate(c)) return {
      error: '交路无效：请检查端点、停站、车队分配、跨线共用站和区间容量（每方向 30 班/小时）。'
    };
    if (R.loadTph(c, l.trackIds[0]) > 30 + .0001) return {
      error: '当前线路间隔超过轨道容量。'
    };
    return commit(s, c);
  }

  function validate(s) {
    return R.validate(s) && F.validate(s) && s.services.every(l => Number.isInteger(l.fleet) && l.fleet >= (
        l.fleetManaged ? 0 : 2) && l.fleet <= 80 && l.fleet % 2 === 0 && [4, 6, 8].includes(l.cars) &&
      Number.isInteger(l.open) && Number.isInteger(l.close) && l.open >= 0 && l.close <= 1440 && l.close -
      l.open >= 60 && /^#[0-9a-f]{6}$/i.test(l.color));
  }

  // Editing owns validation/mutations; forecast metrics live in a read-only module.
  function stats(s, forecast, id) {
    return Stats.line(s, forecast, id);
  }

  function allStats(s, forecast) {
    return Stats.all(s, forecast);
  }

  function renameStation(s, id, name) {
    const c = R.clone(s);
    if (!c.nodes[id] || !name?.trim() || name.trim().length > 40) return {
      error: '站名须为 1–40 个字符。'
    };
    c.nodes[id].name = name.trim();
    c.nodes[id].nameSource = 'manual';
    return commit(s, c);
  }

  function mergeNearby(s) {
    const ids = [...new Set(s.services.flatMap(l => l.stops))].sort((a, b) => a - b);
    let count = 0;
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i],
          b = ids[j];
        if (s.nodes[a].mergedInto !== undefined || s.nodes[b].mergedInto !== undefined || X.distance(s
            .nodes[a], s.nodes[b]) > SNAP_KM || s.services.some(l => l.stops.includes(a) && l.stops
            .includes(b))) continue;
        const c = R.clone(s);
        for (const l of c.services) {
          l.stops = l.stops.map(n => n === b ? a : n);
          for (const p of l.patterns || [])
            if (p.calls) p.calls = [...new Set(p.calls.map(n => n === b ? a : n))];
        }
        c.nodes[b].mergedInto = a;
        for (const t of c.tracks) {
          if (t.a === b) t.a = a;
          if (t.b === b) t.b = a;
          delete t.curve;
        }
        for (const l of c.services) X.geometry(c, l);
        if (validate(c)) {
          Object.assign(s, c);
          count++;
        }
      }
    return count;
  }

  function upgrade(s) {
    s.routeModel = 9;
    for (const l of s.services) X.geometry(s, l);
    if (s.mapVersion !== 11 && s.mapVersion !== 12) mergeNearby(s);
    if (s.mapVersion !== 12) {
      for (const t of s.tracks)
        if (t.curve) {
          t.curve.version = 12;
          t.km = X.sum(X.trackPoints(s, t));
        } s.mapVersion = 12;
    }
    defaults(s);
    F.upgrade(s);
    Names.migrate(s);
    return s;
  }

  const api = {
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
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RailNetwork = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
