/* Numeric transport and JSON/view projection for native history and record rules. */
(function(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const Core = node ? require('./routing-wasm') : root.RailRouting;
  const run = values => Core.kernel('history_run', new Float64Array(values));
  function archive(q, minute) {
    const lines = Object.entries(q.lines), input = [1,0,minute,q.current.number,+!!q.current.flow,
      Number(q.current.flow?.through),q.history.length,lines.length];
    for (const [,line] of lines) input.push(Number(line.awareness),Number(line.trust));
    const result = run(input);
    return {number: result[0], boundary: result[1], archive: !!result[2], touchPrevious: !!result[3],
      continuous: !!result[4], drop: result[5], maturity: Object.fromEntries(lines.map(([id],i) => [id,result[6+i]]))};
  }
  function merge(a, b, fields) {
    const input = [1,1,fields.length];
    for (const k of fields) input.push(Number.isFinite(a[k]) ? a[k] : NaN,Number.isFinite(b[k]) ? b[k] : NaN);
    const values = run(input), entries = [];
    fields.forEach((k,i) => {if(values[i*2]) entries.push([k,values[i*2+1]]);});
    return Object.fromEntries(entries);
  }
  function lengths(s) {
    const tracks = new Map(s.tracks.map((t,i) => [t.id,i])),input = [1,2,s.tracks.length];
    for (const t of s.tracks) input.push(Number(t.km));
    input.push(s.services.length);
    const last = new Map(s.services.map((l,i) => [l.id,i]));
    for (let i=0;i<s.services.length;i++) {
      const line=s.services[i];
      input.push(+(last.get(line.id)===i),line.trackIds.length);
      for (const id of line.trackIds) input.push(tracks.get(id) ?? s.tracks.length);
    }
    const values = run(input);
    return {byLine:Object.fromEntries(s.services.map((l,i) => [l.id,values[i+2]])),networkKm:values[0],longestKm:values[1]};
  }
  function view(d, field, interval) {
    const flow = d.flow,valid = flow?.version === 1 && Array.isArray(flow[field]) && flow[field].length === 96;
    const input = [1,3,d.number,+!!valid,interval,Number(flow?.since),Number(flow?.through)];
    for (let i=0;i<96;i++) input.push(valid ? Number(flow[field][i]) : 0);
    const values = run(input),points = [];
    for(let i=0;i<values[6];i++) {
      const at=7+i*5;
      points.push({start:values[at],end:values[at+1],value:values[at+2]?values[at+3]:null,partial:!!values[at+4]});
    }
    return {points,total:values[0],peak:values[1]<0?null:points[values[1]],available:!!values[2],
      since:valid?flow.since:null,through:valid?flow.through:null,partial:!!values[5]};
  }
  function awards(list) {
    const input=[1,4,list.length];
    for(const a of list) input.push(a.value,a.target,+(a.category==='收入'));
    const values=run(input);
    return list.map((a,i)=>({...a,displayTarget:values[i*4],displayValue:values[i*4+1],
      unlocked:!!values[i*4+2],progress:values[i*4+3]}));
  }
  const api = {archive,merge,lengths,view,awards};
  if(node) module.exports = api; else root.RailHistory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
