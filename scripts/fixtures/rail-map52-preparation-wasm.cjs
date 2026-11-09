/* Feedback -> sampling -> dispatch is ordered inside one native preparation batch. */
(function(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const Core = node ? require('./rail-map52-routing-wasm.cjs') : root.RailRouting;
  const Native = node ? require('./rail-map52-operations-wasm.cjs') : root.RailNativeOperations;
  const SIM = node ? require('./rail-map52-simulation-wasm.cjs') : root.RailSimulation;

  function encode(feedback, sampling, dispatch) {
    if (!feedback && !sampling && !dispatch) return null;
    const parts = [feedback?.input || [], sampling?.input || [], dispatch?.input || []];
    const mapping = sampling?.context.names.map(
      id => feedback?.context.ids.get(id) ?? -1) || [];
    const input = new Float64Array(5 + mapping.length + parts.reduce(
      (length, part) => length + part.length, 0));
    input.set([1, ...parts.map(part => part.length), mapping.length]);
    input.set(mapping, 5);
    let at = 5 + mapping.length;
    for (const part of parts) {
      input.set(part, at);
      at += part.length;
    }
    return input;
  }
  function run(feedback,sampling,dispatch) {
    const input=encode(feedback,sampling,dispatch);
    if(!input) return {sampled:null,dispatch:[]};
    const data = Core.kernel('engine_prepare', input);
    if (data[0] !== 1) throw Error('原生准备批次版本错误');
    let at = 4;
    if (feedback) Native.projectFeedback(feedback, data.subarray(at, at + data[1]));
    at += data[1];
    const sampled = sampling ? SIM.projectArrivals(data.subarray(at, at + data[2])) : null;
    at += data[2];
    return {
      sampled,
      dispatch: dispatch ? SIM.projectDispatch(dispatch, data.subarray(at)) : []
    };
  }
  if (node) module.exports = {run,encode};
  else root.RailPreparation = {run,encode};
})(typeof globalThis !== 'undefined' ? globalThis : this);
