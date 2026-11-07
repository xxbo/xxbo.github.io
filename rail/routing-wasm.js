/* Binary ABI adapter only. All search, heap, transfer and route-fare decisions live in Rust. */
(function(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const ABI = 1,
    STRIDE = 14,
    UNRESTRICTED = 0xffffffff;
  const DEFAULT_PRICES = [180, 210, 260, 300, 330, 400];
  const GRAPH = new WeakMap();
  let compiled = null,
    instance = null,
    active = null,
    ready = null,
    calls = 0,
    demandCalls = 0,
    forecastCalls = 0,
    simulationCalls = 0,
    activeSimulationToken = 0,
    activeQueueToken = 0,
    activeEngineToken = 0,
    engineSteps = 0,
    activeSamplingToken = 0,
    queueSteps = 0,
    statisticsCalls = 0,
    statisticsBatches = 0,
    operationsCalls = 0,
    temporalCalls = 0,
    timedArrivalCalls = 0,
    nativeTokens = 0,
    recycles = 0;
  let recycleBytes = 64 * 1024 * 1024;
  // A persistent queue may itself need more than the old transient 64 MiB budget.
  // Learn a bounded simulation working-set allowance, avoiding rebuild thrashing.
  let simulationRecycleBytes = 0,
    peakMemoryBytes = 0;
  const recycleLimit = () => recycleBytes === 0 ? 0 : Math.max(recycleBytes,
    simulationRecycleBytes);
  const asset = node ? null : new URL('wasm/rail-core-v9.wasm?v=49',
    root.document?.currentScript?.src || root.location.href).href;

  function install(module) {
    const next = new WebAssembly.Instance(module, {
      rail_math: {
        exp: Math.exp,
        log: Math.log,
        hypot: Math.hypot
      }
    });
    if (next.exports.routing_abi() !== ABI || next.exports.demand_abi?.() !== 1 || next.exports
      .world_abi?.() !== 1 || next.exports.simulation_abi?.() !== 1 || next.exports.queue_abi?.
      () !== 1 || next.exports.statistics_abi?.() !== 1 || next.exports.operations_abi?.() !== 1 || next.exports.engine_abi?.() !== 1)
      throw Error('寻路WASM接口版本不匹配');
    compiled = module;
    instance = next;
    active = null;
    activeSimulationToken = 0;
    activeQueueToken = 0;
    activeEngineToken = 0;
    activeSamplingToken = 0;
    return api;
  }

  function init() {
    if (instance) return Promise.resolve(api);
    if (ready) return ready;
    ready = (async () => {
      const response = await fetch(asset);
      if (!response.ok) throw Error('寻路模块加载失败（HTTP ' + response.status + '）');
      return install(await WebAssembly.compile(await response.arrayBuffer()));
    })().catch(error => {
      ready = null;
      throw error;
    });
    return ready;
  }

  function exports() {
    if (!instance) throw Error('Rust/WASM寻路模块尚未就绪');
    return instance.exports;
  }

  function write(values) {
    const wasm = exports(),
      pointer = wasm.input_resize(values.length);
    new Float64Array(wasm.memory.buffer, pointer, values.length).set(values);
  }
  const number = (value, fallback) => {
    if (value === undefined && fallback !== undefined) return fallback;
    if (!Number.isFinite(value)) throw Error('寻路输入含无效数字');
    return value;
  };

  function prepare(state, adjacency, legacy = false) {
    const services = [''],
      serviceIds = new Map([
        ['', 0]
      ]),
      lines = [''],
      lineIds = new Map([
        ['', 0]
      ]),
      groups = new Map(),
      edges = [],
      records = [],
      parts = [];

    function intern(map, names, id) {
      if (!map.has(id)) {
        map.set(id, names.length);
        names.push(id);
      }
      return map.get(id);
    }
    for (const line of state.services) intern(lineIds, lines, line.id);
    for (let from = 0; from < adjacency.length; from++) {
      for (const edge of adjacency[from]) {
        const service = intern(serviceIds, services, edge.service);
        const group = edge.service + '|' + (edge.dir || 0);
        if (!groups.has(group)) groups.set(group, groups.size);
        const start = parts.length / 2;
        for (const part of edge.parts || []) parts.push(intern(lineIds, lines, part.line), number(
          part.km));
        edges.push(edge);
        const owner = state.companies?.findIndex(c => c.id === edge.owner) ?? -1;
        records.push(from, edge.to, service, edge.dir || 0, 0, number(edge.km), number(edge
            .minutes),
          number(edge.headway), groups.get(group), start, parts.length / 2 - start,
          owner < 0 ? 31 : owner, number(edge.fare, 0), number(edge.penalty, 0), edge.through ?
          1 : 0);
      }
    }
    const data = new Float64Array(7 + records.length + parts.length);
    data.set([ABI, legacy ? 1 : 0, adjacency.length, lines.length, edges.length, parts.length / 2,
      state.companies?.length || 0
    ]);
    data.set(records, 7);
    data.set(parts, 7 + records.length);
    const graph = {
      data,
      services,
      lines,
      groups,
      edges,
      legacy
    };
    GRAPH.set(adjacency, graph);
    return graph;
  }

  function prices(state, graph) {
    const lines = new Map(state.services.map(line => [line.id, line]));
    const values = new Float64Array(graph.lines.length * 6 + (state.companies?.length || 0));
    graph.lines.forEach((id, index) => {
      const band = lines.get(id)?.fareBands || DEFAULT_PRICES;
      for (let i = 0; i < 6; i++) values[index * 6 + i] = number(band[i]);
    });
    state.companies?.forEach((company, index) => {
      values[graph.lines.length * 6 + index] = number(company.fare, 0);
    });
    return values;
  }

  function compactPaths(state, adjacency, origin, value = .045, firstKey = null, legacy = false) {
    const graph = GRAPH.get(adjacency) || prepare(state, adjacency, legacy);
    if (graph.legacy !== legacy) throw Error('寻路图版本不匹配');
    try {
      const wasm = exports();
      if (active !== graph) {
        write(graph.data);
        wasm.graph_load();
        active = graph;
      }
      write(prices(state, graph));
      const first = firstKey ? graph.groups.get(firstKey) ?? UNRESTRICTED - 1 : UNRESTRICTED;
      const pointer = wasm.route_search(origin, number(value), first);
      // Copy once: cached results survive future searches, memory.grow and instance recycling.
      const data = new Float64Array(wasm.memory.buffer, pointer, wasm.output_len()).slice();
      wasm.output_clear();
      if (data[0] !== ABI) throw Error('寻路结果接口版本不匹配');
      const tree = new Array(data[1]);
      for (let id = 0; id < tree.length; id++) {
        if (data[8 + id * STRIDE] !== -1) tree[id] = id;
      }
      Object.defineProperties(tree, {
        memoryWeight: {
          value: data[2]
        },
        routingData: {
          value: {
            data,
            graph
          }
        }
      });
      calls++;
      if (wasm.memory.buffer.byteLength > recycleLimit()) {
        install(compiled);
        recycles++;
      }
      return tree;
    } catch (error) {
      // A trapped instance is discarded. Caller preserves the last successful game forecast.
      if (compiled) install(compiled);
      throw Error('Rust/WASM寻路失败：' + error.message, {
        cause: error
      });
    }
  }

  function pathAt(tree, destination) {
    if (tree[destination] === undefined) return undefined;
    const {
      data,
      graph
    } = tree.routingData;
    const at = 8 + destination * STRIDE,
      edgeList = [];
    let trail = data[at + 11];
    while (data[data[5] + trail * 2] >= 0) {
      edgeList.push(graph.edges[data[data[5] + trail * 2 + 1]]);
      trail = data[data[5] + trail * 2];
    }
    edgeList.reverse();
    if (graph.legacy) return {
      node: data[at],
      service: graph.services[data[at + 1]],
      paid: data[at + 3],
      discounted: data[at + 4],
      cost: data[at + 6],
      minutes: data[at + 7],
      fare: data[at + 8],
      km: data[at + 9],
      edges: edgeList,
      transfers: data[at + 10]
    };
    const fares = {};
    for (let i = 0; i < data[at + 13]; i++) {
      const offset = data[at + 12] + i * 2;
      fares[graph.lines[data[offset]]] = data[offset + 1];
    }
    const service = graph.services[data[at + 1]],
      lastLine = graph.lines[data[at + 3]];
    return {
      node: data[at],
      service,
      dir: data[at + 2],
      lastLine,
      fareKm: data[at + 5],
      board: data[at + 4],
      cost: data[at + 6],
      minutes: data[at + 7],
      fare: data[at + 8],
      km: data[at + 9],
      edges: edgeList,
      transfers: data[at + 10],
      fares,
      key: edgeList.length ? [data[at], service, data[at + 2], lastLine, data[at + 4]].join('|') :
        data[at] + '|'
    };
  }

  function paths(state, adjacency, origin, value = .045, firstKey = null, legacy = false) {
    const tree = compactPaths(state, adjacency, origin, value, firstKey, legacy);
    return tree.map((_, id) => pathAt(tree, id));
  }

  function kernel(name, values, read = null, context = null) {
    if (!['demand_ipf', 'demand_distribution', 'demand_mode', 'demand_strategy',
        'demand_capacity', 'world_run', 'world_policy', 'simulation_run', 'simulation_step',
        'statistics_run', 'operations_run', 'temporal_run', 'engine_step'
      ].includes(name)) throw Error('未知需求核心操作');
    try {
      const wasm = exports();
      write(values);
      const pointer = wasm[name]();
      const view = new Float64Array(wasm.memory.buffer, pointer, wasm.output_len());
      // Short object projections consume synchronously; persistent matrices own a copy.
      const data = read ? read(view, context) : view.slice();
      wasm.output_clear();
      if (name === 'simulation_step' || name === 'engine_step') {
        if(name==='engine_step') {
          engineSteps++;activeEngineToken=values[2+values[0]+1];
          values=values.subarray(2,2+values[0]);
        }
        queueSteps++;
        if (values[0] === 2) statisticsBatches++;
        simulationCalls++;
        activeQueueToken = values[1];
        if (values[13] > 0) activeSimulationToken = values[15];
        if (recycleBytes >= 64 * 1024 * 1024) {
          simulationRecycleBytes = Math.max(simulationRecycleBytes,
            Math.min(192 * 1024 * 1024, Math.ceil(wasm.memory.buffer.byteLength * 1.5 / 65536) *
              65536));
        }
      } else if (name === 'simulation_run') {
        simulationCalls++;
        if (values[0] === 4 || values[0] === 6) activeSimulationToken = values[1];
        if (values[0] === 7 || values[0] === 8 || values[0] === 9) activeSamplingToken = values[1];
        if (values[0] === 8 || values[0] === 9) timedArrivalCalls++;
      } else if (name === 'statistics_run') statisticsCalls++;
      else if (name === 'operations_run') operationsCalls++;
      else if (name === 'temporal_run') temporalCalls++;
      else demandCalls++;
      peakMemoryBytes = Math.max(peakMemoryBytes, wasm.memory.buffer.byteLength);
      if (name === 'simulation_run' && activeQueueToken && recycleBytes >= 64 * 1024 * 1024) {
        simulationRecycleBytes = Math.max(simulationRecycleBytes,
          Math.min(192 * 1024 * 1024, Math.ceil(wasm.memory.buffer.byteLength * 1.5 / 65536) *
            65536));
      }
      if (wasm.memory.buffer.byteLength > recycleLimit()) {
        install(compiled);
        recycles++;
      }
      return data;
    } catch (error) {
      if (compiled) install(compiled);
      throw Error('Rust/WASM需求计算失败：' + error.message, {
        cause: error
      });
    }
  }

  function forecastKernel(state, adjacency, values, read, context) {
    const graph = GRAPH.get(adjacency) || prepare(state, adjacency);
    try {
      const wasm = exports();
      if (active !== graph) {
        write(graph.data);
        wasm.graph_load();
        active = graph;
      }
      const fees = prices(state, graph),
        input = new Float64Array(1 + fees.length + values.length);
      input[0] = fees.length;
      input.set(fees, 1);
      input.set(values, 1 + fees.length);
      write(input);
      const pointer = wasm.forecast_run();
      const view = new Float64Array(wasm.memory.buffer, pointer, wasm.output_len());
      calls += view[2];
      demandCalls++;
      forecastCalls++;
      const result = read(view, {
        ...context,
        graph
      });
      wasm.output_clear();
      if (wasm.memory.buffer.byteLength > recycleLimit()) {
        install(compiled);
        recycles++;
      }
      return result;
    } catch (error) {
      if (compiled) install(compiled);
      throw Error('Rust/WASM批量预测失败：' + error.message, {
        cause: error
      });
    }
  }

  function modeKernel(values) {
    try {
      if (values.length !== 10) throw Error('方式选择输入尺寸无效');
      const wasm = exports();
      const result = wasm.demand_mode_scalar(...values);
      demandCalls++;
      if (wasm.memory.buffer.byteLength > recycleLimit()) {
        install(compiled);
        recycles++;
      }
      return result;
    } catch (error) {
      if (compiled) install(compiled);
      throw Error('Rust/WASM方式选择失败：' + error.message, {
        cause: error
      });
    }
  }
  const api = {
    init,
    kernel,
    modeKernel,
    simulationToken: () => activeSimulationToken,
    queueToken: () => activeQueueToken,
    engineToken: () => activeEngineToken,
    allocateToken: () => ++nativeTokens,
    samplingToken: () => activeSamplingToken,
    recycleSimulation: () => {
      simulationRecycleBytes = 0;
      install(compiled);
      recycles++;
    },
    forecastKernel,
    prepare,
    compactPaths,
    pathAt,
    paths,
    status: () => ({
      backend: 'Rust/WASM',
      demandAbi: 1,
      demandCalls,
      forecastCalls,
      simulationCalls,
      queueSteps,
      statisticsCalls,
      statisticsBatches,
      statisticsAbi: 1,
      engineAbi: 1,
      engineSteps,
      operationsAbi: 1,
      temporalAbi: 1,
      temporalCalls,
      timedArrivalCalls,
      operationsCalls,
      queueAbi: 1,
      simulationAbi: 1,
      worldAbi: 1,
      abi: ABI,
      ready: !!instance,
      searches: calls,
      recycles,
      peakMemoryBytes,
      recycleLimitBytes: recycleLimit(),
      memoryBytes: instance?.exports.memory.buffer.byteLength || 0
    }),
    // Also used by deterministic module-failure/recycling tests; no alternate algorithm.
    create: (bytes, options = {}) => {
      if (options.recycleBytes !== undefined) recycleBytes = options.recycleBytes;
      simulationRecycleBytes = 0;
      peakMemoryBytes = 0;
      return install(new WebAssembly.Module(bytes));
    }
  };
  if (node) {
    const fs = require('node:fs'),
      path = require('node:path');
    install(new WebAssembly.Module(fs.readFileSync(path.join(__dirname,
      'wasm/rail-core-v9.wasm'))));
    module.exports = api;
  } else {
    root.RailRouting = api;
    root.RailRoutingReady = init();
    // Entry points await the original promise and display/return its failure.
    root.RailRoutingReady.catch(() => {});
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
