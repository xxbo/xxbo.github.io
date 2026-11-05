/* Shared request lifecycle for stateless worker RPC. No game state is owned here. */
(function(root) {
  'use strict';

  function create(options) {
    const schedule = options.setTimer || setTimeout;
    const cancel = options.clearTimer || clearTimeout;
    const jobs = new Map();
    let worker = null;
    let nextId = 0;
    let disposed = false;

    function remove(id) {
      const job = jobs.get(id);
      if (job) {
        cancel(job.timer);
        jobs.delete(id);
      }
      return job;
    }

    function stop(error, source = worker) {
      // A late callback from a terminated worker must not cancel its replacement.
      if (source !== worker) return;
      if (worker) {
        worker.onmessage = worker.onerror = worker.onmessageerror = null;
        worker.terminate();
      }
      worker = null;
      for (const id of [...jobs.keys()]) remove(id).reject(error);
      if (options.onFault) options.onFault(error);
    }

    function start() {
      if (disposed) throw Error('后台任务客户端已关闭。');
      if (worker) return worker;
      const current = options.createWorker();
      if (!current) return null;
      worker = current;
      current.onmessage = ({
        data: message
      }) => {
        if (current !== worker) return;
        const job = remove(message?.id);
        if (!job) return;
        if (message.error) job.reject(Error(message.error));
        else job.resolve(message);
      };
      current.onerror = event => stop(Error(event.message || options.errorMessage), current);
      current.onmessageerror = () => stop(Error(options.errorMessage), current);
      return current;
    }

    function request(payload) {
      if (disposed) return Promise.reject(Error('后台任务客户端已关闭。'));
      let current;
      try {
        current = start();
      } catch (error) {
        if (!options.fallbackOnStartFailure || !options.fallback) return Promise.reject(error);
      }
      if (!current) {
        if (!options.fallback) return Promise.reject(Error(options.errorMessage));
        // Yield before a synchronous fallback so loading/status UI can paint.
        return new Promise((resolve, reject) => {
          const id = ++nextId;
          const timer = schedule(() => {
            const job = remove(id);
            if (!job) return;
            try {
              job.resolve(options.fallback(payload));
            } catch (error) {
              job.reject(error);
            }
          }, 0);
          jobs.set(id, {
            resolve,
            reject,
            timer
          });
        });
      }
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = schedule(() => stop(Error(options.timeoutMessage), current), options.timeout);
        jobs.set(id, {
          resolve,
          reject,
          timer
        });
        try {
          current.postMessage({
            ...payload,
            id
          });
        } catch (error) {
          // DataCloneError affects this request only; always release its timeout.
          remove(id).reject(error);
        }
      });
    }

    return {
      request,
      start,
      get active() {
        return !!worker;
      },
      get pending() {
        return jobs.size;
      },
      dispose() {
        disposed = true;
        stop(Error('后台任务客户端已关闭。'));
      }
    };
  }

  const api = {
    create
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RailWorkerClient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
