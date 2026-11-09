/* Native editor transport and projections. Business choices execute in Rust. */
(function(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports,
    Core = node ? require('./routing-wasm') : root.RailRouting,
    Wire = node ? require('./value-wire') : root.RailValueWire;
  const FIELDS = ['version', 'quarter', 'nodes', 'tracks', 'services', 'companies', 'nextId', 'log',
    'region', 'world', 'routeModel', 'operatingPlan', 'depot', 'mapVersion'
  ];
  const MUTABLE = ['nodes', 'tracks', 'services', 'nextId', 'depot', 'mapVersion', 'routeModel'];
  const cache = new WeakMap();
  let configuration;

  function config() {
    if (!configuration) {
      const R = node ? require('./engine') : root.RailSim,
        F = node ? require('./fleet') : root.RailFleet,
        B = node ? require('./regions') : root.RailRegions,
        Names = node ? require('./place-names') : root.RailPlaceNames;
      const seed = R.newGame();
      configuration = {
        specs: F.SPECS,
        seedNodes: seed.nodes,
        identities: Object.fromEntries(seed.companies.map(c => [c.id, {
          name: c.name,
          short: c.short,
          color: c.color
        }])),
        regions: Object.fromEntries(['tokyo', 'gba'].map(k => [k, {
          width: B.get(k).width,
          height: B.get(k).height
        }])),
        places: Object.fromEntries(['tokyo', 'gba'].map(k => [k, Names?.places?.(k) || []]))
      };
    }
    return configuration;
  }

  function snapshot(s) {
    const v = {};
    for (const k of FIELDS)
      if (Object.hasOwn(s, k)) v[k] = s[k];
    v.economy = {
      minute: s.economy?.minute
    };
    return v;
  }

  function projection(s, op, query, args) {
    const out = snapshot(s);
    if (query && ['graph', 'loadTph', 'runtime'].includes(op)) {
      out.nodes = (s.nodes || []).map(() => null);
      out.tracks = s.tracks.map(t => ({
        id: t.id,
        km: t.km
      }));
      for (const k of ['companies', 'log', 'depot', 'mapVersion', 'quarter', 'version']) delete out[k];
    }
    if (query && op === 'draftLegs') {
      const used = new Set(args?.points?.filter(Number.isInteger) || []);
      out.nodes = s.nodes.map((n, i) => used.has(i) ? n : null);
      out.tracks = [];
      out.services = [];
    }
    if (query && op === 'geometry') {
      out.nodes = s.nodes.map(n => ({
        x: n.x,
        y: n.y
      }));
      out.services = [];
    }
    if (query && op === 'suggestName') {
      out.nodes = s.nodes.map(n => ({
        id: n.id,
        name: n.name,
        ...(n.mergedInto === undefined ? {} : {
          mergedInto: n.mergedInto
        })
      }));
      out.tracks = [];
      out.services = [];
    }
    return out;
  }

  function run(s, op, args, query = false) {
    if (!Core.editorReady()) Core.kernel('editor_config', Wire.encode(config()));
    const out = Wire.decode(Core.kernel('editor_run', Wire.encode({
      state: projection(s, op, query, args),
      op,
      args,
      query
    }))).value;
    if (out.patch) {
      const state = {};
      for (const [key, mode, value] of out.patch) {
        state[key] = mode === 0 ? s[key] : mode === 1 ? value.map(row => row[0] >= 0 ? s[key][row[0]] : row[
          1]) : value;
      }
      out.state = state;
    }
    return out;
  }

  function query(s, op, args = {}) {
    const out = run(s, op, args, true);
    if (out.result?.error) throw Error(out.result.error);
    return out.result;
  }

  function restore(checkpoint) {
    const state = JSON.parse(JSON.stringify(checkpoint)),
      out = run(state, 'restore', {});
    if (!out.changed) return out.result;
    apply(state, out.state);
    return {
      state
    };
  }

  function apply(target, state) {
    for (const k of MUTABLE)
      if (!Object.hasOwn(state, k) && Object.hasOwn(target, k)) delete target[k];
    for (const k of Object.keys(state))
      if (MUTABLE.includes(k)) target[k] = state[k];
  }

  function command(s, op, args = {}) {
    const copy = JSON.parse(JSON.stringify(s));
    let out;
    try {
      out = run(copy, op, args);
    } catch (e) {
      if (['addLine', 'addStation', 'removeStation'].includes(op)) return {
        error: e.message
      };
      throw e;
    }
    if (!out.changed) return out.result;
    if (op === 'mergeNearby' && !out.result) return out.result;
    if (!['mergeNearby', 'defaults', 'upgrade'].includes(op))
      for (const k of Object.keys(s)) delete s[k];
    Object.assign(s, copy);
    apply(s, out.state);
    return ['defaults', 'upgrade', 'removePreset'].includes(op) ? s : out.result;
  }

  function mutate(s, op, args = {}) {
    const out = run(s, op, args, op === 'geometry');
    if (out.result?.error) throw Error(out.result.error);
    if (op === 'geometry') {
      for (let i = 0; i < s.tracks.length; i++) {
        const v = out.state.tracks[i];
        if (v !== s.tracks[i]) {
          s.tracks[i].curve = v.curve;
          s.tracks[i].km = v.km;
        }
      }
      return;
    }
    if (op === 'migrateNames') {
      for (let i = 0; i < s.nodes.length; i++) {
        const v = out.state.nodes[i];
        if (v !== s.nodes[i])
          for (const k of ['name', 'nameSource', 'nearbyPlace']) s.nodes[i][k] = v[k];
      }
      return s;
    }
    if (op === 'defaults') {
      for (let i = 0; i < s.services.length; i++) {
        const v = out.state.services[i];
        if (v !== s.services[i])
          for (const k of ['color', 'cars', 'fleet', 'open', 'close']) s.services[i][k] = v[k];
      }
      return s;
    }

    apply(s, out.state);
    return s;
  }

  function numeric(op, values, key) {
    let entries = key && cache.get(key),record=entries?.get(op);
    let same=!!record&&record.input.length===values.length+2;
    if(same)for(let i=0;i<values.length;i++)if(!Object.is(record.input[i+2],Number(values[i]))){same=false;break;}
    if(!same){const input=new Float64Array(values.length+2);input.set([1,op]);input.set(values,2);
      record = {
        input,
        result: Core.kernel('geometry_run', input)
      };
      if (key) {
        if (!entries) {
          entries = new Map();
          cache.set(key, entries);
        }
        entries.set(op, record);
      }
    }
    return record.result;
  }
  const coords = points => points.flatMap(p => [Number(p?.x), Number(p?.y)]);

  function smooth(points, before = null, after = null, version = 12, key = points) {
    const v = numeric(0, [typeof version === 'number' ? version : NaN, +!!before, Number(before?.x), Number(
        before?.y), +!!after, Number(after?.x), Number(after?.y), points.length, ...coords(points)], key),
      out = [];
    for (let i = 0; i < v[1]; i++) {
      const at = 2 + i * 3,
        index = v[at];
      out.push(index >= 0 ? points[index] : {
        x: v[at + 1],
        y: v[at + 2]
      });
    }
    return out;
  }

  function metric(s, l, field) {
    const d = l.dispatch,
      loop = l.stops[0] === l.stops.at(-1),
      code = ['both', 'forward', 'reverse'].indexOf(l.loopDirection) + 1;

    const values = [+!!l.fleetManaged, +!!l.dispatchCompiled, +(d?.mode === 'auto'), Number(s.economy
        ?.minute ?? 420), Number(d?.manual), Number(d?.offPeak), Number(d?.peak), Number(l.fleet), Number(
        l.headway), +loop, code, l.stops.length, +!!l.callStops, Number(l.callStops?.length), l.trackIds
      .length
    ];
    for (const id of l.trackIds) {
      const t = s.tracks.find(t=>t.id===id);
      values.push(+!!t, Number(t?.km));
    }
    values.push(new Set(l.callStops || l.stops).size);
    const data = numeric(4, values, l);
    if (data[5] && !(field === 2 && data[6]) && !(field === 3 && !loop)) throw Error('线路几何无效。');
    return data[field];
  }
  const api = {
    snapshot,
    query,
    command,
    mutate,
    restore,
    numeric,
    coords,
    smooth,
    metric
  };
  if (node) module.exports = api;
  else root.RailEditor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
