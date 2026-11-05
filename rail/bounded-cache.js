/* Per-calculation LRU. Eviction changes recomputation only, never route availability. */
(function(root) {
  'use strict';

  function create(options) {
    const {
      limit,
      maxWeight = Infinity,
      weight = () => 1
    } = typeof options === 'number' ? {
      limit: options
    } : options;
    if (!Number.isInteger(limit) || limit < 1 || !(maxWeight > 0)) throw Error('Invalid cache budget');
    const entries = new Map();
    let hits = 0,
      misses = 0,
      evictions = 0,
      peak = 0,
      totalWeight = 0,
      peakWeight = 0,
      oversized = 0;

    function remove(key) {
      const row = entries.get(key);
      if (row) {
        totalWeight -= row.weight;
        entries.delete(key);
      }
    }
    return {
      get(key) {
        const row = entries.get(key);
        if (!row) {
          misses++;
          return undefined;
        }
        hits++;
        entries.delete(key);
        entries.set(key, row);
        return row.value;
      },
      set(key, value) {
        remove(key);
        const size = weight(value);
        if (!Number.isFinite(size) || size < 0) throw Error('Invalid cache weight');
        if (size > maxWeight) {
          oversized++;
          return value;
        }
        entries.set(key, {
          value,
          weight: size
        });
        totalWeight += size;
        while (entries.size > limit || totalWeight > maxWeight) {
          remove(entries.keys().next().value);
          evictions++;
        }
        peak = Math.max(peak, entries.size);
        peakWeight = Math.max(peakWeight, totalWeight);
        return value;
      },
      stats() {
        return {
          entries: entries.size,
          limit,
          peak,
          hits,
          misses,
          evictions,
          weight: totalWeight,
          maxWeight: Number.isFinite(maxWeight) ? maxWeight : null,
          peakWeight,
          oversized
        };
      },
      clear() {
        entries.clear();
        totalWeight = 0;
      }
    };
  }
  const api = {
    create
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RailBoundedCache = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
