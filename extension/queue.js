// Durable outbox. Transactions acknowledge a tab only after disk storage succeeds.
export const MAX_BYTES = 100 * 1024 * 1024;
export function createQueue(indexedDB, IDBKeyRange) {
  let opened;
  function open() {
    if (!opened)
      opened = new Promise((resolve, reject) => {
        const request = indexedDB.open('tns-collect', 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          db.createObjectStore('runs', { keyPath: 'id' });
          db.createObjectStore('comments', { keyPath: ['runId', 'seq'] });
          db.createObjectStore('seen', { keyPath: ['runId', 'id'] });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          opened = null;
          reject(request.error);
        };
      });
    return opened;
  }
  const result = (request) =>
    new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  async function transaction(mode, fn) {
    const db = await open(),
      tx = db.transaction(['runs', 'comments', 'seen'], mode);
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('Không lưu được hàng chờ.'));
    });
    try {
      const value = await fn(
        tx.objectStore('runs'),
        tx.objectStore('comments'),
        tx.objectStore('seen'),
      );
      await done;
      return value;
    } catch (e) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      throw e;
    }
  }
  const range = (id, through = Number.MAX_SAFE_INTEGER) =>
    IDBKeyRange.bound([id, 0], [id, through]);
  return {
    list: () => transaction('readonly', (runs) => result(runs.getAll())),
    create: (run) =>
      transaction('readwrite', (runs) =>
        result(runs.add({ ...run, nextSeq: 1, ackSeq: 0, bytes: 0, saved: 0, enabled: false })),
      ),
    update: (id, patch) =>
      transaction('readwrite', async (runs) => {
        const run = await result(runs.get(id));
        if (run) await result(runs.put({ ...run, ...patch }));
      }),
    append: (id, comments) =>
      transaction('readwrite', async (runs, items, seen) => {
        const run = await result(runs.get(id));
        if (!run) throw new Error('Không tìm thấy lượt Collect.');
        const fresh = [];
        for (const c of comments) {
          if (!(await result(seen.get([id, c.id])))) {
            await result(seen.put({ runId: id, id: c.id }));
            fresh.push(c);
          }
        }
        comments = fresh;
        const all = await result(runs.getAll());
        const bytes = comments.map((c) => new TextEncoder().encode(JSON.stringify(c)).length);
        const addedBytes = bytes.reduce((a, b) => a + b, 0);
        if (all.reduce((n, r) => n + r.bytes, 0) + addedBytes > MAX_BYTES)
          throw new Error(
            'Hàng chờ đã đầy (100 MB). Xuất dữ liệu hoặc kết nối Studio rồi thử lại.',
          );
        for (let i = 0; i < comments.length; i++)
          await result(
            items.put({ runId: id, seq: run.nextSeq++, comment: comments[i], bytes: bytes[i] }),
          );
        run.bytes += addedBytes;
        run.lastPulse = Date.now();
        await result(runs.put(run));
        return run;
      }),
    batch: (id) => transaction('readonly', (_runs, items) => result(items.getAll(range(id), 20))),
    acknowledge: (id, ackSeq) =>
      transaction('readwrite', async (runs, items) => {
        const run = await result(runs.get(id));
        if (!run) return;
        if (!Number.isSafeInteger(ackSeq) || ackSeq < run.ackSeq || ackSeq >= run.nextSeq)
          throw new Error('Server trả xác nhận hàng chờ không hợp lệ.');
        const acknowledged = await result(items.getAll(range(id, ackSeq)));
        await result(items.delete(range(id, ackSeq)));
        run.bytes = Math.max(0, run.bytes - acknowledged.reduce((n, c) => n + c.bytes, 0));
        run.saved += ackSeq - run.ackSeq;
        run.ackSeq = ackSeq;
        await result(runs.put(run));
      }),
    export: () =>
      transaction('readonly', async (runs, items) => ({
        runs: await result(runs.getAll()),
        comments: await result(items.getAll()),
      })),
  };
}
