export const DEMO_MATCH_LIMIT = 25;

// A provisioned session ID is required: room names and Firebase environment
// never turn a professional room into a demo.
export function validDemoSessionId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null;
}

export function mergeEvaluationIds(...lists) {
  return [...new Set(lists.flat().filter(id => Number.isSafeInteger(id) && id > 0))]
    .sort((a, b) => a - b);
}

export function createDemoMatchCredits({ storage, projectId, roomId, sessionId, remote }) {
  const active = !!validDemoSessionId(sessionId);
  const prefix = `patterns:demo-credits:v1:${encodeURIComponent(projectId)}:${encodeURIComponent(roomId)}:${encodeURIComponent(sessionId)}:`;
  const listeners = new Set();
  let confirmed = [];
  let syncing = false;
  let stopped = false;

  // One persistent entry per evaluation avoids two tabs overwriting a counter.
  function localIds() {
    if (!active) return [];
    const ids = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) {
        const id = Number(key.slice(prefix.length));
        if (Number.isSafeInteger(id) && id > 0) ids.push(id);
      }
    }
    return mergeEvaluationIds(ids);
  }

  function notify() { listeners.forEach(listener => listener()); }
  function remember(ids) {
    ids.forEach(id => {
      const key = prefix + id;
      if (storage.getItem(key) === null) storage.setItem(key, String(Date.now()));
    });
    notify();
  }

  function reconcile(ids) {
    confirmed = mergeEvaluationIds(confirmed, ids);
    remember(confirmed);
  }

  async function sync() {
    if (!active || syncing || stopped) return;
    const pending = localIds().filter(id => !confirmed.includes(id));
    if (!pending.length) return;
    syncing = true;
    let succeeded = false;
    try {
      // This work never blocks CLOSE. Failure leaves every local entry intact.
      reconcile(await remote.merge(pending));
      succeeded = true;
    } catch {
      // Retry on a server snapshot, reconnect or the periodic retry.
    } finally {
      syncing = false;
      if (succeeded && !stopped && localIds().some(id => !confirmed.includes(id))) void sync();
    }
  }

  return {
    active,
    prefix,
    getCount: () => mergeEvaluationIds(localIds(), confirmed).length,
    isConsumed: id => active && mergeEvaluationIds(localIds(), confirmed).includes(id),
    isComplete: () => active && mergeEvaluationIds(localIds(), confirmed).length >= DEMO_MATCH_LIMIT,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    consume(id) {
      if (!active) return false;
      if (!Number.isSafeInteger(id) || id < 1) throw new Error("Invalid evaluationId");
      const alreadyConsumed = localIds().includes(id) || confirmed.includes(id);
      // Synchronous durable write happens before the caller hides the banner.
      remember([id]);
      void sync();
      return !alreadyConsumed;
    },
    refresh() { notify(); void sync(); },
    sync,
    connect() {
      if (!active) return () => {};
      stopped = false;
      const unsubscribe = remote.subscribe(ids => {
        if (stopped) return;
        reconcile(ids);
        void sync();
      });
      void sync();
      return () => { stopped = true; unsubscribe(); };
    },
  };
}

