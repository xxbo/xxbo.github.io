/* Display-only compact-kernel land-use field. Does not mutate city or passenger state. */
(function(root) {
  'use strict';
  const SIZE = 12,
    RADIUS = SIZE * 1.5,
    NORM = Math.PI * RADIUS * RADIUS / (3 * SIZE * SIZE),
    PALETTE = {
      r: {
        name: '住宅',
        color: [35, 139, 86],
        reference: 60000,
        levels: [0, 5000, 14000, 36000]
      },
      c: {
        name: '商业',
        color: [225, 127, 32],
        reference: 70000,
        levels: [0, 2800, 12000, 36000]
      },
      i: {
        name: '工业',
        color: [132, 80, 172],
        reference: 10000,
        levels: [0, 1100, 3000, 6000]
      }
    };
  const clamp = x => Math.max(0, Math.min(1, x)),
    weight = d2 => d2 >= RADIUS * RADIUS ? 0 : (1 - d2 / (RADIUS * RADIUS)) ** 2 / NORM;

  function values(c) {
    const area = c.area || .2916;
    return {
      r: (c.people || 0) / area,
      c: Math.max(0, (c.jobs || 0) - (c.industry || 0)) / area,
      i: (c.industry || 0) / area
    };
  }

  function level(k, d) {
    if (d < 1) return 0;
    return 1 + PALETTE[k].levels.slice(1).filter(v => d >= v).length;
  }

  function shade(v) {
    const scores = Object.keys(PALETTE).map(k => ({
        k,
        p: PALETTE[k],
        density: Math.max(0, v[k] || 0),
        strength: clamp(Math.log1p(Math.max(0, v[k] || 0) / 300) / Math.log1p(PALETTE[k].reference /
          300))
      })),
      sum = scores.reduce((a, s) => a + s.strength ** 4, 0);
    if (!sum) return {
      rgb: [255, 255, 255],
      dominant: null,
      level: 0,
      intensity: 0
    };
    const dominant = scores.reduce((a, b) => a.strength > b.strength ? a : b),
      intensity = dominant.strength,
      rgb = [0, 1, 2].map(j => Math.round(scores.reduce((a, s) => a + s.p.color[j] * s.strength ** 4, 0) /
        sum * intensity + 255 * (1 - intensity)));
    return {
      rgb,
      dominant: dominant.k,
      level: level(dominant.k, dominant.density),
      intensity
    };
  }

  function index(cells) {
    const bins = new Map();
    for (const c of cells) {
      const k = Math.floor(c.x / SIZE) + ':' + Math.floor(c.y / SIZE);
      if (!bins.has(k)) bins.set(k, []);
      bins.get(k).push({
        ...c,
        values: values(c)
      });
    }
    return {
      cells,
      bins
    };
  }

  function sample(field, p) {
    const v = {
        r: 0,
        c: 0,
        i: 0
      },
      x = Math.floor(p.x / SIZE),
      y = Math.floor(p.y / SIZE);
    for (let a = x - 2; a <= x + 2; a++)
      for (let b = y - 2; b <= y + 2; b++)
        for (const c of field.bins.get(a + ':' + b) || []) {
          const w = weight((c.x - p.x) ** 2 + (c.y - p.y) ** 2);
          if (w)
            for (const k of Object.keys(v)) v[k] += c.values[k] * w;
        }
    return {
      ...v,
      ...shade(v)
    };
  }

  function raster(cells, box, width, height) {
    const n = width * height,
      r = new Float32Array(n),
      c = new Float32Array(n),
      i = new Float32Array(n),
      dx = box.w / width,
      dy = box.h / height;
    for (const cell of cells) {
      if (cell.x + RADIUS < box.x || cell.x - RADIUS > box.x + box.w || cell.y + RADIUS < box.y || cell.y -
        RADIUS > box.y + box.h) continue;
      const val = values(cell),
        x0 = Math.max(0, Math.floor((cell.x - RADIUS - box.x) / dx)),
        x1 = Math.min(width - 1, Math.ceil((cell.x + RADIUS - box.x) / dx)),
        y0 = Math.max(0, Math.floor((cell.y - RADIUS - box.y) / dy)),
        y1 = Math.min(height - 1, Math.ceil((cell.y + RADIUS - box.y) / dy));
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const w = weight((box.x + (x + .5) * dx - cell.x) ** 2 + (box.y + (y + .5) * dy - cell.y) ** 2);
          if (!w) continue;
          const ix = y * width + x;
          r[ix] += val.r * w;
          c[ix] += val.c * w;
          i[ix] += val.i * w;
        }
    }
    const pixels = new Uint8ClampedArray(n * 4),
      dr = Math.log1p(60000 / 300),
      dc = Math.log1p(70000 / 300),
      di = Math.log1p(10000 / 300);
    for (let k = 0; k < n; k++) {
      const a = clamp(Math.log1p(r[k] / 300) / dr),
        b = clamp(Math.log1p(c[k] / 300) / dc),
        d = clamp(Math.log1p(i[k] / 300) / di),
        wa = a ** 4,
        wb = b ** 4,
        wd = d ** 4,
        total = wa + wb + wd,
        intensity = Math.max(a, b, d),
        white = 255 * (1 - intensity);
      if (total) {
        pixels[k * 4] = Math.round((35 * wa + 225 * wb + 132 * wd) / total * intensity + white);
        pixels[k * 4 + 1] = Math.round((139 * wa + 127 * wb + 80 * wd) / total * intensity + white);
        pixels[k * 4 + 2] = Math.round((86 * wa + 32 * wb + 172 * wd) / total * intensity + white);
      } else pixels[k * 4] = pixels[k * 4 + 1] = pixels[k * 4 + 2] = 255;
      pixels[k * 4 + 3] = 218;
    }
    return {
      pixels,
      r,
      c,
      i,
      width,
      height
    };
  }
  const api = {
    PALETTE,
    SIZE,
    RADIUS,
    index,
    sample,
    raster,
    shade,
    level
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RailDensity = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
