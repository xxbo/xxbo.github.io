/* Infrastructure geometry, distance tariffs and stop-pattern services. No UI dependencies. */
(function(root) {
  'use strict';
  const LIMITS = [6, 11, 19, 27, 40, 999],
    PRICES = [180, 210, 260, 300, 330, 400],
    KINDS = {
      local: '普通·大交路',
      short: '区间·小交路',
      express: '快速',
      direct: '直达',
      cross: '跨线'
    };
  const Editor = typeof module !== 'undefined' && module.exports ? require('./editor-wasm') : root
    .RailEditor;
  const F = typeof module !== 'undefined' && module.exports ? require('./fleet') : root.RailFleet;
  const TRANSFER = 4;
  const distance = (a, b) => Editor.numeric(2, [Number(a?.x), Number(a?.y), Number(b?.x), Number(b?.y)])[1];
  const sum = points => Editor.numeric(1, [points.length, ...Editor.coords(points)], points)[1];
  const smooth = (points, before = null, after = null, version = 12) => Editor.smooth(points, before, after,
    version);

  function rawTrackPoints(s, t, from = t.a) {
    const points = [s.nodes[t.a], ...(t.bends || []), s.nodes[t.b]];
    return from === t.a ? points : [...points].reverse();
  }

  function trackPoints(s, t, from = t.a) {
    let points = rawTrackPoints(s, t);
    if (t.curve) points = Editor.smooth(points, t.curve.before, t.curve.after, t.curve.version || 11, t);
    return from === t.a ? points : [...points].reverse();
  }
  const geometry = (s, line, shapes) => Editor.mutate(s, 'geometry', {
    line,
    shapes
  });

  function linePoints(s, l) {
    const out = [];
    for (let i = 0; i < l.trackIds.length; i++) {
      const points = trackPoints(s, s.tracks.find(t => t.id === l.trackIds[i]), l.stops[i]);
      out.push(...(i ? points.slice(1) : points));
    }
    return out;
  }

  function along(points, progress) {
    const v = Editor.numeric(3, [progress, points.length, ...Editor.coords(points)], points);
    return v[4] >= 0 ? {
      ...points[v[4]],
      angle: v[3]
    } : {
      x: v[1],
      y: v[2],
      angle: v[3]
    };
  }
  const draftLegs = (s, points) => Editor.query(s, 'draftLegs', {
    points
  });

  function bands(l) {
    return l.fareBands || PRICES;
  }

  function fare(l, km) {
    const index = Editor.numeric(7, [km])[1];
    return index < 0 ? 0 : bands(l)[index];
  }

  function patterns(l) {
    return l.patterns || [{
      kind: 'local',
      from: 0,
      to: l.stops.length - 1,
      calls: [...new Set(l.stops)],
      fleet: l.fleet,
      headway: l.headway
    }];
  }

  const compiledViews = new WeakMap();
  const PATTERN_CODES = ['local', 'short', 'express', 'direct', 'cross'];
  const COMPILE_ERRORS = ['', '跨线目标不存在。', '两条线路必须在同一座车站连接。', '跨线目标不能是本线路。', '跨线交路需要相同车型与编组。',
    '交路不能重复经过同一车站。',
    '直达交路的起终点必须不同。', '交路端点无效。', '交路车队分配无效。'
  ];

  function serviceFrame(s, minute, line = null, p = null, index, strict = false) {
    const sources = [...s.services];
    if (line && sources.indexOf(line) < 0) sources.push(line);
    const source = line ? sources.indexOf(line) : 0,
      trackNames = [],
      trackIds = new Map(),
      keys = new Map(),
      specs = new Map();
    const intern = (map, value) => {
      if (!map.has(value)) map.set(value, map.size);
      return map.get(value);
    };
    const track = id => {
      if (!trackIds.has(id)) {
        trackIds.set(id, trackNames.length);
        trackNames.push(id);
      }
      return trackIds.get(id);
    };
    const numericIndex = line ? ((typeof index === 'number' || typeof index === 'string') && String(Number(
      index)) === String(index) ? Number(index) : NaN) : 0;
    const values = [1, line ? 1 : 0, minute, source, numericIndex, sources.length];
    const num = v => strict ? (typeof v === 'number' ? v : NaN) : Number(v);
    const write = p => {
      const calls = Array.isArray(p.calls) ? (strict ? p.calls.filter(() => true) : p.calls).map(num) :
    [];
      values.push(PATTERN_CODES.indexOf(p.kind), num(p.from), num(p.to), num(p.fleet), p.kind ===
        'cross' ? s.services.findIndex(l => l.id === p.target) : -1, num(p.targetEnd), calls.length, ...
        calls);
    };
    for (const l of sources) {
      const d = l.dispatch;
      values.push(intern(keys, l.id), intern(specs, l.stockSpec), +!!l.fleetManaged, +(d?.mode === 'auto'),
        Number(d?.manual), Number(d?.offPeak), Number(d?.peak), Number(l.fleet), l.stops.length, ...l
        .stops,
        l.trackIds.length, ...l.trackIds.map(track), +!!l.patterns, l.patterns?.length || 0);
      for (const p of l.patterns || []) write(p);
    }
    if (line) write(p);
    return {
      input: Float64Array.from(values),
      sources,
      trackNames,
      trackIndex: trackIds
    };
  }

  function compileServices(s, minute, line = null, p = null, index) {
    // The native temporal rule supplies the only time-dependent compiler input.
    const frame = serviceFrame(s, F.peak(minute) ? 480 : 600, line, p, index);
    const entries = compiledViews.get(s) || [];
    let cached = entries.find(x => x.input.length === frame.input.length && x.input.every((v, i) => Object
      .is(
        v, frame.input[i])));
    if (!cached) {
      cached = {
        input: frame.input,
        data: ROUTING.kernel('service_compile', frame.input),
        rows: null
      };
      entries.unshift(cached);
      entries.length = Math.min(2, entries.length);
      compiledViews.set(s, entries);
    }
    const data = cached.data;

    if (data[0] !== 1) throw Error('交路编译接口版本不匹配');
    if (data[1]) throw Error(COMPILE_ERRORS[data[1]] || '交路配置无效。');
    const render = row => {
      const {
        source,
        ordinal: nativeOrdinal,
        isDefault,
        fleetMode,
        allocated,
        stops,
        trackIds,
        fareLines,
        callStops
      } = row, ordinal = line ? index : nativeOrdinal, l = frame.sources[source], pattern = p || (!
          isDefault ?
          l.patterns[ordinal] : null), kind =
        isDefault ? 'local' : pattern.kind;
      return {
        ...l,
        id: ordinal ? l.id + 'p' + ordinal : l.id,
        parentLine: l.id,
        patternIndex: ordinal,
        patternKind: kind,
        name: l.name + ' · ' + KINDS[kind],
        stops: stops.slice(),
        trackIds: trackIds.map(i => frame.trackNames[i]),
        fareLines: fareLines.map(i => frame.sources[i].id),
        callStops: callStops.slice(),
        fleet: [l.fleet, pattern?.fleet, allocated, undefined][fleetMode],
        dispatchCompiled: !!l.fleetManaged,
        headway: isDefault ? l.headway : pattern.headway,
        through: false,
        operators: undefined,
        parents: undefined
      };
    };
    if (cached.rows) return cached.rows.map(render);
    const rows = [];
    let at = 3;
    for (let n = 0; n < data[2]; n++) {
      const size = data[at++],
        end = at + size,
        source = data[at++],
        ordinal = data[at++],
        isDefault = data[at++],
        fleetMode = data[at++],
        allocated = data[at++];
      const stops = Array.from(data.subarray(at + 1, at + 1 + data[at]));
      at += 1 + data[at];
      const count = data[at++],
        trackIds = Array.from(data.subarray(at, at + count), i => i);
      at += count;
      const fareLines = Array.from(data.subarray(at, at + count), i => i);
      at += count;
      const callStops = Array.from(data.subarray(at + 1, at + 1 + data[at]));
      at += 1 + data[at];
      if (at !== end) throw Error('交路编译结果长度错误');
      rows.push({
        source,
        ordinal,
        isDefault,
        fleetMode,
        allocated,
        stops,
        trackIds,
        fareLines,
        callStops
      });
    }
    if (at !== data.length) throw Error('交路编译结果含多余数据');
    cached.rows = rows;
    return rows.map(render);
  }

  function compile(s, line, p, index, minute = s.economy?.minute ?? 420) {
    return compileServices(s, minute, line, p, index)[0];
  }

  function expand(s, minute = s.economy?.minute ?? 420) {
    if (s.routeModel !== 9 || s.operatingPlan) return s;
    return {
      ...s,
      operatingPlan: true,
      baseLines: s.services,
      services: compileServices(s, minute)
    };
  }

  const duration = (s, l) => Editor.metric(s, l, 1);
  const headway = (s, l) => Editor.metric(s, l, 2);
  const loopDwell = (s, l) => Editor.metric(s, l, 3);

  const directionViews=new WeakMap();
  function directions(l){const first=l.stops[0],last=l.stops.at(-1),dir=l.loopDirection;let c=directionViews.get(l);if(!c||c.first!==first||c.last!==last||c.dir!==dir){const mask=Editor.numeric(6,[+(first===last),['both','forward','reverse'].indexOf(dir)+1],l)[1];c={first,last,dir,value:mask===1?[1]:mask===2?[-1]:[1,-1]};directionViews.set(l,c);}return c.value.slice();}

  function directionName(s, l, dir) {
    const points = l.stops.map(id => s.nodes[id]);
    return Editor.numeric(5, [dir, points.length, ...Editor.coords(points)], l)[1] ? '外环' : '内环';
  }

  function validate(s) {
    try {
      const frame = serviceFrame(s, s.economy?.minute ?? 420, null, null, undefined, true);
      const num = v => typeof v === 'number' ? v : NaN;
      const values = [1, frame.input.length, ...frame.input, +(s.routeModel === 9 && !s.operatingPlan), +!!s
        .world, Number(s.world?.width), Number(s.world?.height), frame.trackNames.length, s.tracks.length
      ];
      for (const t of s.tracks) {
        values.push(frame.trackIndex.get(t.id) ?? -1, Number(t.km));
        for (const p of [t.curve?.before, t.curve?.after]) {
          values.push(+!!p);
          if (p) values.push(num(p.x), num(p.y));
        }
        const bends = t.bends,
          points = Array.isArray(bends) ? bends.filter(() => true) : [];
        values.push(!bends ? 0 : Array.isArray(bends) ? 1 : -1, Array.isArray(bends) ? bends.length : 0,
          points
          .length);
        for (const p of points) values.push(num(p.x), num(p.y));
      }
      for (const l of s.services) {
        const bands = l.fareBands,
          n = Array.isArray(bands) ? bands.length : 0;
        values.push(!bands ? 0 : Array.isArray(bands) ? 1 : -1, n);
        for (let i = 0; i < n; i++) values.push(+(i in bands), num(bands[i]));
        values.push(!l.loopDirection ? 0 : ['both', 'forward', 'reverse'].indexOf(l.loopDirection) + 1 || -
          1,
          Number(l.headway), Number(l.callStops ? l.callStops.length : l.stops.length), +!!l
          .dispatchCompiled);
        for (const p of l.patterns || [{
            headway: l.headway
          }]) values.push(num(p.headway), +Array.isArray(p.calls));
      }
      const result = ROUTING.kernel('service_validate', Float64Array.from(values));
      return result[0] === 1 && result[1] === 1;
    } catch {
      return false;
    }
  }

  function network(s) {
    const adj = Editor.query(s, 'graph');
    ROUTING.prepare(s, adj);
    return adj;
  }

  // Search implementation is Rust-only; JS preserves the existing public object contract.
  const ROUTING = typeof module !== 'undefined' && module.exports ? require('./routing-wasm') : root
    .RailRouting;

  function paths(s, adj, origin, value = .045, firstKey = null) {
    return ROUTING.paths(s, adj, origin, value, firstKey);
  }

  function compactPaths(s, adj, origin, value = .045, firstKey = null) {
    return ROUTING.compactPaths(s, adj, origin, value, firstKey);
  }

  function pathAt(tree, destination) {
    return ROUTING.pathAt(tree, destination);
  }
  const VOT = {
    work: 40,
    shopping: 25,
    leisure: 20
  };

  function modeShare({
    purpose,
    minutes,
    walk,
    fare: price,
    km
  }) {
    const v = Editor.numeric(8, [purpose === 'work' ? 0 : purpose === 'leisure' ? 2 : 1, minutes, walk,
      price, km
    ]);
    return {
      share: v[1],
      railCost: v[2],
      alternativeCost: v[3]
    };
  }
  const api = {
    loopDwell,
    directionName,
    smooth,
    rawTrackPoints,
    geometry,
    directions,
    TRANSFER,
    LIMITS,
    PRICES,
    KINDS,
    VOT,
    distance,
    trackPoints,
    linePoints,
    along,
    sum,
    draftLegs,
    fare,
    patterns,
    compile,
    expand,
    duration,
    headway,
    validate,
    network,
    paths,
    compactPaths,
    pathAt,
    routingStatus: ROUTING.status,
    modeShare
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RailServicePlan = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
