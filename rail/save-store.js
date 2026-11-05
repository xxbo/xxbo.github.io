/* IndexedDB game checkpoints. No network operations; localStorage is read only for legacy migration. */
(function(root) {
  'use strict';

  function indexedAdapter(idb) {
    let opened = null;

    function open() {
      if (opened) return opened;
      opened = new Promise((resolve, reject) => {
        if (!idb) {
          reject(Error('此浏览器未开放本地数据库。'));
          return;
        }
        const req = idb.open('guanchao-rail-checkpoints', 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains('saves')) req.result.createObjectStore('saves');
        };
        req.onerror = () => reject(req.error || Error('无法打开本地数据库。'));
        req.onblocked = () => reject(Error('本地数据库被其他页面占用，请关闭旧游戏标签页后重试。'));
        req.onsuccess = () => {
          const db = req.result;
          db.onversionchange = () => {
            db.close();
            opened = null;
          };
          resolve(db);
        };
      }).catch(error => {
        opened = null;
        throw error;
      });
      return opened;
    }
    return {
      async get(key) {
        const db = await open();
        return new Promise((resolve, reject) => {
          const tx = db.transaction('saves', 'readonly'),
            r = tx.objectStore('saves').get(key);
          let value;
          r.onsuccess = () => value = r.result;
          tx.oncomplete = () => resolve(value);
          tx.onerror = () => reject(tx.error || r.error || Error('存档读取失败。'));
          tx.onabort = () => reject(tx.error || Error('存档读取中断。'));
        });
      },
      async put(key, value) {
        const db = await open();
        return new Promise((resolve, reject) => {
          const tx = db.transaction('saves', 'readwrite');
          tx.objectStore('saves').put(value, key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || Error('存档写入失败。'));
          tx.onabort = () => reject(tx.error || Error('存档写入已中止，旧存档保留。'));
        });
      }
    };
  }

  function create(adapter, legacy, serialize = value => JSON.stringify(value)) {
    let tail = Promise.resolve();
    async function read(key) {
      await tail.catch(() => {});
      let old = null;
      try {
        old = legacy?.getItem(key);
      } catch {}
      try {
        const record = await adapter.get(key);
        if (record) {
          if (typeof record.text !== 'string') throw Error('本地数据库存档格式无效。');
          return {
            text: record.text,
            source: 'indexeddb',
            bytes: record.bytes,
            savedAt: record.savedAt
          };
        }
        return old ? {
          text: old,
          source: 'legacy'
        } : null;
      } catch (error) {
        if (old) return {
          text: old,
          source: 'legacy',
          error
        };
        throw error;
      }
    }

    function write(key, value, legacyText = null) {
      let prepared;
      try {
        prepared = typeof value === 'string' ? value : serialize(value);
      } catch (error) {
        return Promise.reject(error);
      }
      const ready = Promise.resolve(prepared).then(text => {
        if (typeof text !== 'string') throw Error('存档内容无效。');
        return {
          text,
          bytes: new Blob([text]).size,
          savedAt: Date.now()
        };
      });
      // Attach a rejection handler immediately, even if an earlier database write is pending.
      ready.catch(() => {});
      const task = tail.catch(() => {}).then(async () => {
        const record = await ready;
        await adapter.put(key, record);
        if (legacyText !== null) try {
          if (legacy?.getItem(key) === legacyText) legacy.removeItem(key);
        } catch {}
        return {
          source: 'indexeddb',
          bytes: record.bytes,
          savedAt: record.savedAt
        };
      });
      tail = task;
      return task;
    }

    return {
      read,
      write,
      flush: () => tail
    };
  }

  function workerSerializer() {
    const Client = typeof module !== 'undefined' && module.exports ? require('./worker-client') : root
      .RailWorkerClient;
    const client = Client.create({
      createWorker: () => typeof root.Worker === 'function' ? new root.Worker('save-worker.js?v=38') :
        null,
      timeout: 30000,
      timeoutMessage: '后台存档超时，旧存档保留。',
      errorMessage: '后台存档编码失败，旧存档保留。',
      fallback: ({
        value
      }) => ({
        text: JSON.stringify(value)
      })
    });
    // Preserve synchronous capture when Workers are unavailable: state may mutate
    // before the database queue reaches this checkpoint.
    return value => typeof root.Worker !== 'function' ? JSON.stringify(value) :
      client.request({
        value
      }).then(message => message.text);
  }
  const node = typeof module !== 'undefined' && module.exports;
  let legacy = null;
  try {
    legacy = root.localStorage;
  } catch {}
  const api = create(indexedAdapter(root.indexedDB), legacy, node ? undefined : workerSerializer());
  api.create = create;
  api.indexedAdapter = indexedAdapter;
  api.workerSerializer = workerSerializer;
  if (node) module.exports = api;
  else root.RailSaveStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
