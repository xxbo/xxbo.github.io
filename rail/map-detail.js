/* Visual-only LOD and screen-space decluttering. No simulation state is changed. */
(function(root) {
  'use strict';
  const LABELS = {
    full: '完整显示',
    trains: '精简列车',
    stations: '精简车站'
  };

  function level(pixelsPerKm, choice = 'auto', editing = false, previous = null) {
    if (editing) return 'full';
    if (['full', 'trains', 'stations'].includes(choice)) return choice;
    const n = Number.isFinite(pixelsPerKm) ? pixelsPerKm : 0;
    if (previous === 'full' && n >= 54) return 'full';
    if (previous === 'stations' && n < 20) return 'stations';
    return n >= 60 ? 'full' : n >= 18 ? 'trains' : 'stations';
  }

  function inside(p, view, padding = 20) {
    return p.x >= -padding && p.y >= -padding && p.x <= view.width + padding && p.y <= view.height +
      padding;
  }

  function collisionIndex(size = 64) {
    const cells = new Map(),
      keys = b => {
        const out = [];
        for (let x = Math.floor(b.x / size); x <= Math.floor((b.x + b.w) / size); x++)
          for (let y = Math.floor(b.y / size); y <= Math.floor((b.y + b.h) / size); y++) out.push(x + ':' +
            y);
        return out;
      };
    return {
      hits(b) {
        return keys(b).some(k => (cells.get(k) || []).some(a => b.x < a.x + a.w && b.x + b.w > a.x && b.y <
          a.y + a.h && b.y + b.h > a.y));
      },
      add(b) {
        for (const k of keys(b)) {
          if (!cells.has(k)) cells.set(k, []);
          cells.get(k).push(b);
        }
      }
    };
  }

  function stations(points, lod) {
    if (lod !== 'stations') return new Set(points.map(p => p.id));
    const placed = collisionIndex(40),
      keep = new Set();
    for (const p of [...points].sort((a, b) => b.priority - a.priority || String(a.id).localeCompare(String(
        b.id), 'en', {
        numeric: true
      }))) {
      if (p.priority < 1 && !p.selected) continue;
      const radius = p.selected ? 13 : 19,
        box = {
          x: p.x - radius,
          y: p.y - radius,
          w: radius * 2,
          h: radius * 2
        };
      if (!placed.hits(box) || p.priority >= 4) {
        keep.add(p.id);
        placed.add(box);
      }
    }
    return keep;
  }

  function trains(points, lod, selected = null) {
    if (lod === 'stations') return [];
    if (lod === 'full') return points.map(p => ({
      ...p,
      key: p.id,
      ids: [p.id],
      count: 1,
      individual: true
    }));
    const groups = new Map(),
      out = [];
    for (const p of points) {
      if (p.line === selected) {
        out.push({
          ...p,
          key: p.id,
          ids: [p.id],
          count: 1,
          individual: true
        });
        continue;
      }
      const k = [p.line, p.dir, Math.floor(p.x / 48), Math.floor(p.y / 48)].join('|');
      let g = groups.get(k);
      if (!g) groups.set(k, g = {
        ...p,
        key: 'cluster:' + k,
        ids: [],
        count: 0,
        individual: false,
        x: 0,
        y: 0,
        onboard: 0,
        capacity: 0
      });
      g.count++;
      g.ids.push(p.id);
      g.x += p.x;
      g.y += p.y;
      g.onboard += p.onboard || 0;
      g.capacity += p.capacity || 0;
    }
    for (const g of groups.values()) {
      g.x /= g.count;
      g.y /= g.count;
      out.push(g);
    }
    return out;
  }
  const api = {
    LABELS,
    level,
    inside,
    collisionIndex,
    stations,
    trains
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RailMapDetail = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
