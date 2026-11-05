/* Deterministic dense grid for memory work; no external data or network requests. */
const N = require('../../rail/network'),
  M = require('../../rail/management'),
  F = require('../../rail/fleet'),
  Q = require('../../rail/ridership');

function create(size = 7) {
  const s = M.init(N.upgrade(N.emptyWorld('gba'))),
    point = (x, y) => ({
      x: 600 + x * 24,
      y: 500 + y * 24,
      nameSeed: .25
    });
  for (let y = 0; y < size; y++) {
    const r = N.addLine(s, Array.from({
      length: size
    }, (_, x) => point(x, y)), {
      stockSpec: '6B'
    });
    if (r.error) throw Error(r.error);
  }
  for (let x = 0; x < size; x++) {
    const r = N.addLine(s, Array.from({
      length: size
    }, (_, y) => point(x, y)), {
      stockSpec: '6B'
    });
    if (r.error) throw Error(r.error);
  }
  for (let stock = 0; stock < s.services.length * 8; stock += 80) F.purchase(s, '6B', 80);
  for (const l of s.services) {
    const r = N.configure(s, l.id, {
      dispatch: {
        mode: 'manual',
        manual: 8,
        offPeak: 8,
        peak: 8
      }
    });
    if (r.error) throw Error(r.error);
  }
  Q.enableSatisfaction(s);
  return s;
}
module.exports = {
  create
};
