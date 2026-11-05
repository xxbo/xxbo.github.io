/* Byte-for-byte MAP38 presentation contracts plus pure station-list behavior. */
const assert = require('node:assert/strict'),
  crypto = require('node:crypto');
const fixture = require('./fixtures/rail-ui-scenario.cjs');
const {
  format,
  N,
  M,
  F,
  Q,
  X,
  V,
  OC,
  Currency
} = fixture;
const line = require('../rail/ui-line-view').create({
  ...format,
  F,
  Q,
  X,
  V,
  currency: Currency
});
const center = require('../rail/ui-center-view').create({
  ...format,
  F,
  Q,
  X,
  OC,
  fmtHeadway: line.fmtHeadway
});
const finance = require('../rail/ui-finance-view').create({
  ...format,
  M
});
const stations = require('../rail/ui-stations-view').create({
  ...format,
  Q
});
const saves = require('../rail/ui-save-view').create({
  ...format,
  B: require('../rail/regions')
});
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

function cases() {
  const output = {};
  for (const empty of [true, false]) {
    const {
      s,
      f,
      rt,
      rows,
      metrics
    } = fixture.fixture(empty), prefix = empty ? 'empty' : 'network';
    const available = M.available(s),
      before = JSON.stringify({
        s,
        f,
        rt
      });
    output[prefix + '.finance'] = hash(finance.content(s, N.allStats(s, f), available));
    output[prefix + '.financeLive'] = hash(JSON.stringify(finance.live(s)));
    output[prefix + '.stations'] = hash(stations.shell('住区', 'name'));
    for (const pending of [false, true]) output[prefix + '.saves.' + pending] = hash(saves.content({
      state: s,
      cfg: {
        name: '粤港澳大湾区'
      },
      pendingImport: pending ? {
        state: s,
        region: 'tokyo',
        runtime: {}
      } : null,
      saveStatus: '已保存 <测试>',
      saveMeta: {
        bytes: 1024
      },
      importError: pending ? '示例 <错误>' : '',
      region: 'gba'
    }));
    for (const tab of ['overview', 'dispatch', 'stations', 'rules', 'settings'])
      for (const l of s.services) {
        output[prefix + '.line.' + l.id + '.' + tab] = hash(line.content({
          state: s,
          forecast: f,
          minute: rt.minute,
          line: l,
          stats: N.stats(s, f, l.id),
          tab,
          deleteConfirm: tab === 'settings',
          salvage: tab === 'settings' ? Math.max(0, -(M.preview(s, c => N.removeLine(c, l.id)).net ||
            0)) : 0
        }));
      }
    const counts = {
      add: rows.filter(x => x.suggestions.some(a => ['add', 'stock', 'crowd'].includes(a.type))).length,
      reduce: rows.filter(x => x.suggestions.some(a => a.type === 'reduce')).length,
      pattern: rows.filter(x => x.suggestions.some(a => a.action === 'pattern' || ['short', 'express']
        .includes(a.type))).length,
      attention: rows.filter(x => x.priority >= 60).length
    };
    for (const filter of ['all', 'add', 'reduce', 'pattern', 'attention']) {
      const review = rows.length ? {
        id: rows[0].id,
        preview: {
          error: '需复核 <库存>'
        }
      } : null;
      output[prefix + '.center.' + filter] = hash(center.content({
        state: s,
        minute: rt.minute,
        rows,
        metrics,
        counts,
        sort: 'default',
        query: '',
        filter,
        error: '',
        expanded: new Set(rows.map(r => r.id)),
        review,
        pulse: ''
      }));
    }
    assert.equal(JSON.stringify({
      s,
      f,
      rt
    }), before, 'presentation must not change game data');
  }
  return output;
}

function run() {
  assert.deepEqual(cases(), require('./fixtures/rail-ui-map38-hashes.json'));
  const {
    s,
    rt
  } = fixture.fixture(), ids = [...new Set(s.services.flatMap(l => l.stops))], counts = Object.fromEntries(ids
    .map((id, i) => [id, i * 3]));
  const m = stations.model(s, rt, '', 'waiting', counts);
  assert.equal(m.rows[0].waiting, Math.max(...Object.values(counts)));
  assert.equal(m.count, ids.length);
  const shared = s.services[0].stops[2];
  assert.equal(m.rows.find(r => r.id === shared).lines, s.services.filter(l => l.stops.includes(shared)).map(
    l => l.name).join('、'));
  const original = m.rows.find(r => r.id === 0);
  s.nodes[0].name = '更新 <站名>';
  s.services[0].name = '更新线名';
  const renamed = stations.model(s, rt, '更新线名', 'waiting', counts);
  assert(renamed.rows.some(r => r.id === 0 && r.name === '更新 <站名>'));
  const html = stations.row({
    ...original,
    name: '<img src=x onerror=1>'
  }, {
    entered: 3,
    boarded: 2
  }, 10);
  assert(html.includes('&lt;img'));
  assert(!html.includes('<img'));
  assert.equal(stations.model(s, rt, '查无此站', 'name', counts).rows.length, 0);
  console.log(
    'MAP39 passed: 35 MAP38 markup hashes (all line tabs, cross/express/loop, finance, center filters, saves), read-only models, station sorting/shared membership/rename/search and escaping.'
    );
}
if (require.main === module) run();
module.exports = {
  cases
};
