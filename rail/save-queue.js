/* Bound automatic checkpoint work before snapshotting or encoding large game state. */
(function(root) {
  'use strict';

  function create() {
    let active = null,
      pending = null,
      started = 0,
      coalesced = 0,
      completed = 0,
      failed = 0;

    function start(factory, waiting = null) {
      started++;
      const task = Promise.resolve().then(factory);
      active = task;
      if (waiting) task.then(waiting.resolve, waiting.reject);

      function finish(ok) {
        if (ok) completed++;
        else failed++;
        if (active !== task) return;
        active = null;
        const next = pending;
        pending = null;
        if (next) start(next.factory, next);
      }
      task.then(() => finish(true), () => finish(false));
      return task;
    }

    function request(factory) {
      if (typeof factory !== 'function') return Promise.reject(Error('Invalid save factory'));
      if (!active) return start(factory);
      coalesced++;
      if (pending) {
        pending.factory = factory;
        return pending.promise;
      }
      let resolve, reject;
      const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      });
      pending = {
        factory,
        promise,
        resolve,
        reject
      };
      return promise;
    }
    return {
      request,
      async flush() {
        while (active || pending) await (pending?.promise || active).catch(() => {});
      },
      stats() {
        return {
          active: !!active,
          pending: !!pending,
          started,
          coalesced,
          completed,
          failed
        };
      }
    };
  }
  const api = {
    create
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RailSaveQueue = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
