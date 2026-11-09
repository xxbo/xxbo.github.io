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
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) * .045;
  const sum = points => points.slice(1).reduce((n, p, i) => n + distance(points[i], p), 0);
  const F = typeof module !== 'undefined' && module.exports ? require('../../rail/fleet') : root.RailFleet;
  const TRANSFER = 4;

  function smooth(points, before = null, after = null, version = 12) {
    const length = (a, b) => Math.hypot(b.x - a.x, b.y - a.y),
      out = [points[0]],
      handles = points.map((b, i) => {
        const a = i ? points[i - 1] : before,
          c = i < points.length - 1 ? points[i + 1] : after;
        if (!a || !c) return null;
        const d1 = length(a, b),
          d2 = length(b, c);
        if (d1 < 1e-6 || d2 < 1e-6) return null;
        const u = {
            x: (b.x - a.x) / d1,
            y: (b.y - a.y) / d1
          },
          v = {
            x: (c.x - b.x) / d2,
            y: (c.y - b.y) / d2
          },
          angle = Math.acos(Math.max(-1, Math.min(1, -u.x * v.x - u.y * v.y))) * 180 / Math.PI;
        if (angle > (version === 12 ? 170.00001 : 120.00001)) return null;
        let x = u.x + v.x,
          y = u.y + v.y,
          n = Math.hypot(x, y);
        if (n < 1e-6) {
          x = -u.y;
          y = u.x;
          n = 1;
        }
        return {
          x: x / n,
          y: y / n,
          len: version === 12 ? Math.min(d1 * .46, d2 * .46, 42) : Math.min(d1 * .22, d2 * .22, 12)
        };
      });
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        h = handles[i - 1],
        j = handles[i];
      if (!h && !j) {
        out.push(b);
        continue;
      }
      const d = length(a, b),
        u = h ? {
          x: a.x + h.x * Math.min(h.len, d * (version === 12 ? .46 : .3)),
          y: a.y + h.y * Math.min(h.len, d * (version === 12 ? .46 : .3))
        } : {
          x: a.x + (b.x - a.x) / 3,
          y: a.y + (b.y - a.y) / 3
        },
        v = j ? {
          x: b.x - j.x * Math.min(j.len, d * (version === 12 ? .46 : .3)),
          y: b.y - j.y * Math.min(j.len, d * (version === 12 ? .46 : .3))
        } : {
          x: b.x - (b.x - a.x) / 3,
          y: b.y - (b.y - a.y) / 3
        };
      for (let k = 1; k <= 16; k++) {
        const z = k / 16,
          q = 1 - z;
        out.push({
          x: q * q * q * a.x + 3 * q * q * z * u.x + 3 * q * z * z * v.x + z * z * z * b.x,
          y: q * q * q * a.y + 3 * q * q * z * u.y + 3 * q * z * z * v.y + z * z * z * b.y
        });
      }
    }
    return out;
  }

  function rawTrackPoints(s, t, from = t.a) {
    const points = [s.nodes[t.a], ...(t.bends || []), s.nodes[t.b]];
    return from === t.a ? points : [...points].reverse();
  }

  function trackPoints(s, t, from = t.a) {
    let points = rawTrackPoints(s, t);
    if (t.curve) points = smooth(points, t.curve.before, t.curve.after, t.curve.version || 11);
    return from === t.a ? points : [...points].reverse();
  }

  function geometry(s, l, shapes) {
    const loop = l.stops[0] === l.stops.at(-1),
      count = l.trackIds.length;
    for (let i = 0; i < count; i++) {
      const t = s.tracks.find(t => t.id === l.trackIds[i]);
      if (t.curve) continue;
      const prev = i ? i - 1 : loop ? count - 1 : -1,
        next = i < count - 1 ? i + 1 : loop ? 0 : -1,
        raw = ix => [s.nodes[l.stops[ix]], ...(shapes?.[ix] || rawTrackPoints(s, s.tracks.find(t => t.id ===
          l.trackIds[ix]), l.stops[ix]).slice(1, -1)), s.nodes[l.stops[ix + 1]]],
        before = prev < 0 ? null : raw(prev).at(-2),
        after = next < 0 ? null : raw(next)[1];
      const xy = p => p ? {
        x: p.x,
        y: p.y
      } : null;
      t.curve = t.a === l.stops[i] ? {
        before: xy(before),
        after: xy(after),
        version: 12
      } : {
        before: xy(after),
        after: xy(before),
        version: 12
      };
      t.km = sum(trackPoints(s, t));
    }
  }

  function linePoints(s, l) {
    const out = [];
    for (let i = 0; i < l.trackIds.length; i++) {
      const points = trackPoints(s, s.tracks.find(t => t.id === l.trackIds[i]), l.stops[i]);
      out.push(...(i ? points.slice(1) : points));
    }
    return out;
  }

  function along(points, progress) {
    const total = sum(points),
      target = total * Math.max(0, Math.min(1, progress));
    let km = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        d = distance(a, b);
      if (km + d >= target || i === points.length - 1) {
        const f = d ? Math.max(0, Math.min(1, (target - km) / d)) : 0;
        return {
          x: a.x + (b.x - a.x) * f,
          y: a.y + (b.y - a.y) * f,
          angle: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI
        };
      }
      km += d;
    }
    return {
      ...points[0],
      angle: 0
    };
  }

  function draftLegs(s, points) {
    const resolve = p => Number.isInteger(p) ? s.nodes[p] : p,
      out = [];
    let from = null,
      bends = [];
    for (const point of points) {
      const p = resolve(point);
      if (p.waypoint) {
        if (from) bends.push(p);
        continue;
      }
      if (from) {
        const path = [from, ...bends, p];
        out.push({
          from,
          to: p,
          raw: path
        });
      }
      from = p;
      bends = [];
    }
    const loop = out.length > 2 && distance(out[0].from, out.at(-1).to) < 1e-6;
    return out.map((e, i) => {
      const prev = out[i - 1] || (loop ? out.at(-1) : null),
        next = out[i + 1] || (loop ? out[0] : null),
        path = smooth(e.raw, prev?.raw.at(-2), next?.raw[1]);
      return {
        ...e,
        points: path,
        km: sum(path)
      };
    });
  }

  function bands(l) {
    return l.fareBands || PRICES;
  }

  function fare(l, km) {
    if (km <= 1e-9) return 0;
    const rounded = Math.ceil(km - 1e-8);
    const index = LIMITS.findIndex(v => rounded <= v);
    return bands(l)[index < 0 ? LIMITS.length - 1 : index];
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
  const COMPILE_ERRORS = ['', '跨线目标不存在。', '两条线路必须在同一座车站连接。', '跨线目标不能是本线路。', '跨线交路需要相同车型与编组。', '交路不能重复经过同一车站。',
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
      const calls=Array.isArray(p.calls)?(strict?p.calls.filter(()=>true):p.calls).map(num):[];
      values.push(PATTERN_CODES.indexOf(p.kind), num(p.from), num(p.to), num(p.fleet), p.kind ===
        'cross' ? s.services.findIndex(l => l.id === p.target) : -1, num(p.targetEnd),calls.length,...calls);
    };
    for (const l of sources) {
      const d = l.dispatch;
      values.push(intern(keys, l.id), intern(specs, l.stockSpec), +!!l.fleetManaged, +(d?.mode === 'auto'),
        Number(d?.manual), Number(d?.offPeak), Number(d?.peak), Number(l.fleet), l.stops.length, ...l.stops,
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
    let cached = entries.find(x => x.input.length === frame.input.length && x.input.every((v, i) => Object.is(
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
      } = row, ordinal = line ? index : nativeOrdinal, l = frame.sources[source], pattern = p || (!isDefault ?
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

  function duration(s, l) {
    return l.trackIds.reduce((v, id) => v + s.tracks.find(t => t.id === id).km / 48 * 60, 0) + (l
      .callStops ? l.callStops.length - 1 : l.stops.length - 1) * .6;
  }

  function directionName(s, l, dir) {
    let area = 0;
    for (let i = 1; i < l.stops.length; i++) {
      const a = s.nodes[l.stops[i - 1]],
        b = s.nodes[l.stops[i]];
      area += a.x * b.y - b.x * a.y;
    }
    return (area >= 0 ? dir === 1 : dir === -1) ? '外环' : '内环';
  }

  function directions(l) {
    return l.stops[0] === l.stops.at(-1) && l.loopDirection === 'forward' ? [1] : l.stops[0] === l.stops.at(
      -1) && l.loopDirection === 'reverse' ? [-1] : [1, -1];
  }

  function headway(s, l) {
    if (l.fleetManaged) {
      const fleet = l.dispatchCompiled ? l.fleet : F.planned(l, s.economy?.minute ?? 420);
      if (!fleet) return Infinity;
      const loop = l.stops[0] === l.stops.at(-1),
        cycle = loop ? duration(s, l) * directions(l).length : 2 * (duration(s, l) + 1);
      return Math.max(2, cycle / fleet);
    }
    const loop = l.stops[0] === l.stops.at(-1);
    return Math.max(l.headway, loop ? duration(s, l) / (l.fleet / directions(l).length) : 2 * (duration(s,
      l) + 1) / l.fleet);
  }

  function loopDwell(s, l) {
    if (l.stops[0] !== l.stops.at(-1)) return .6;
    const cycle = duration(s, l),
      h = headway(s, l),
      n = Math.max(1, Math.ceil(cycle / h - 1e-8)),
      calls = new Set(l.callStops || l.stops).size;
    return .6 + Math.max(0, n * h - cycle) / Math.max(1, calls);
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
        values.push(!bends ? 0 : Array.isArray(bends) ? 1 : -1, Array.isArray(bends) ? bends.length : 0, points
          .length);
        for (const p of points) values.push(num(p.x), num(p.y));
      }
      for (const l of s.services) {
        const bands = l.fareBands,
          n = Array.isArray(bands) ? bands.length : 0;
        values.push(!bands ? 0 : Array.isArray(bands) ? 1 : -1, n);
        for (let i = 0; i < n; i++) values.push(+(i in bands), num(bands[i]));
        values.push(!l.loopDirection ? 0 : ['both', 'forward', 'reverse'].indexOf(l.loopDirection) + 1 || -1,
          Number(l.headway), Number(l.callStops ? l.callStops.length : l.stops.length), +!!l.dispatchCompiled);
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
    const op = expand(s),
      adj = s.nodes.map(() => []);
    for (const l of op.services) {
      let start = 0;
      for (let end = 1; end < l.stops.length; end++) {
        if (!l.callStops.includes(l.stops[end])) continue;
        const ids = l.trackIds.slice(start, end),
          km = ids.reduce((v, id) => v + s.tracks.find(t => t.id === id).km, 0),
          parts = [];
        for (let i = start; i < end; i++) {
          const line = l.fareLines[i],
            d = s.tracks.find(t => t.id === l.trackIds[i]).km;
          if (parts.at(-1)?.line === line) parts.at(-1).km += d;
          else parts.push({
            line,
            km: d
          });
        }
        if (!l.fleet) continue;
        const e = {
          service: l.id,
          line: l.parentLine,
          owner: l.owner,
          km,
          track: ids[0],
          tracks: ids,
          parts,
          headway: headway(op, l),
          minutes: km / 48 * 60 + loopDwell(op, l)
        };
        if (directions(l).includes(1)) adj[l.stops[start]].push({
          ...e,
          to: l.stops[end],
          dir: 1
        });
        if (directions(l).includes(-1)) adj[l.stops[end]].push({
          ...e,
          to: l.stops[start],
          dir: -1,
          tracks: [...ids].reverse(),
          parts: [...parts].reverse()
        });
        start = end;
      }
    }
    ROUTING.prepare(s, adj);
    return adj;
  }

  // Search implementation is Rust-only; JS preserves the existing public object contract.
  const ROUTING = typeof module !== 'undefined' && module.exports ? require('../../rail/routing-wasm') : root.RailRouting;
  function paths(s, adj, origin, value = .045, firstKey = null) {
    return ROUTING.paths(s, adj, origin, value, firstKey);
  }
  function compactPaths(s, adj, origin, value = .045, firstKey = null) {
    return ROUTING.compactPaths(s, adj, origin, value, firstKey);
  }
  function pathAt(tree, destination) { return ROUTING.pathAt(tree, destination); }
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
    const value = VOT[purpose] || 25,
      rail = minutes + walk * 1.7 + price / value,
      road = 8 + km / 23 * 60 * 1.22 + (120 + km * 18) / value,
      walking = km * 1.25 / 4.8 * 60,
      alternative = Math.min(road, walking),
      share = .98 / (1 + Math.exp(Math.max(-40, Math.min(40, .12 * (rail - alternative)))));
    return {
      share,
      railCost: rail,
      alternativeCost: alternative
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
