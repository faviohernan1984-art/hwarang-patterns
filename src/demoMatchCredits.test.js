import test from "node:test";
import assert from "node:assert/strict";
import { createDemoMatchCredits, mergeEvaluationIds } from "./demoMatchCredits.js";

function memoryStorage() {
  const entries = new Map();
  return {
    get length() { return entries.size; },
    key: index => [...entries.keys()][index] ?? null,
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture(overrides = {}) {
  let online = true;
  let remoteIds = [];
  let onRemote = () => {};
  let writes = 0;
  const storage = overrides.storage || memoryStorage();
  const remote = {
    subscribe(callback) { onRemote = callback; return () => {}; },
    async merge(ids) {
      writes += 1;
      if (!online) throw new Error("Offline");
      remoteIds = mergeEvaluationIds(remoteIds, ids);
      return remoteIds;
    },
  };
  const options = { storage, projectId: "local", roomId: "A", sessionId: "demo-1", remote, ...overrides };
  return {
    options, storage, credits: createDemoMatchCredits(options),
    setOnline(value) { online = value; },
    setRemote(ids) { remoteIds = ids; onRemote(ids); },
    getRemote: () => remoteIds,
    getWrites: () => writes,
  };
}

test("CLOSE writes durably before Firebase resolves; duplicate CLOSE and reload consume once", async () => {
  let resolve;
  const f = fixture({ remote: {
    subscribe: () => () => {},
    merge: () => new Promise(done => { resolve = done; }),
  } });
  assert.equal(f.credits.consume(7), true);
  assert.equal(f.storage.length, 1);
  assert.equal(f.credits.getCount(), 1);
  assert.equal(f.credits.consume(7), false);
  const reloaded = createDemoMatchCredits(f.options);
  assert.equal(reloaded.isConsumed(7), true);
  assert.equal(reloaded.consume(7), false);
  assert.equal(reloaded.getCount(), 1);
  resolve([7]);
  await settle();
});

test("the 25th CLOSE succeeds; NEXT/RESET gate becomes complete without consuming another credit", async () => {
  const f = fixture();
  f.setOnline(false);
  for (let id = 1; id <= 24; id += 1) f.credits.consume(id);
  assert.equal(f.credits.isComplete(), false);
  assert.equal(f.credits.consume(25), true);
  assert.equal(f.credits.getCount(), 25);
  assert.equal(f.credits.isComplete(), true);
  assert.equal(f.credits.consume(25), false);
  assert.equal(f.credits.getCount(), 25);
  await settle();
});

test("offline CLOSE is nonblocking and reconciliation keeps old remote consumption", async () => {
  const f = fixture();
  f.setOnline(false);
  f.credits.consume(4);
  f.credits.consume(5);
  await settle();
  assert.equal(f.credits.getCount(), 2);
  assert.deepEqual(f.getRemote(), []);
  const reloaded = createDemoMatchCredits(f.options);
  assert.equal(reloaded.getCount(), 2);
  f.setRemote([1, 2, 4]);
  f.setOnline(true);
  await reloaded.sync();
  assert.deepEqual(f.getRemote(), [1, 2, 4, 5]);
  await reloaded.sync();
  assert.equal(reloaded.getCount(), 4);
  assert.deepEqual(f.getRemote(), [1, 2, 4, 5]);
});

test("server subscription reconciles overlapping IDs and remote-only quota into local storage", () => {
  const f = fixture();
  f.credits.connect();
  f.setRemote(Array.from({ length: 25 }, (_, i) => i + 1));
  assert.equal(f.credits.getCount(), 25);
  assert.equal(f.credits.isComplete(), true);
  assert.equal(createDemoMatchCredits(f.options).getCount(), 25);
  f.setRemote([1]); // An old snapshot cannot roll back confirmed consumption.
  assert.equal(f.credits.getCount(), 25);
});

test("two tabs persist different evaluations without overwriting each other", async () => {
  const f = fixture();
  f.setOnline(false);
  const second = createDemoMatchCredits(f.options);
  f.credits.consume(1);
  second.consume(2);
  f.credits.consume(3);
  assert.equal(second.getCount(), 3);
  assert.equal(second.consume(1), false);
  assert.equal(f.credits.getCount(), 3);
  await settle();
});

test("new consumption while a sync is running is sent in a follow-up transaction", async () => {
  const calls = [];
  const resolvers = [];
  const f = fixture({ remote: {
    subscribe: () => () => {},
    merge(ids) { calls.push(ids); return new Promise(resolve => resolvers.push(resolve)); },
  } });
  f.credits.consume(1);
  f.credits.consume(2);
  resolvers[0]([1]);
  await settle();
  assert.deepEqual(calls, [[1], [2]]);
  resolvers[1]([1, 2]);
  await settle();
  assert.equal(f.credits.getCount(), 2);
});

test("professional rooms never write, sync or apply a limit", async () => {
  for (const sessionId of [null, undefined, "", "invalid/session"]) {
    const f = fixture({ sessionId });
    f.credits.connect();
    for (let id = 1; id <= 30; id += 1) f.credits.consume(id);
    await f.credits.sync();
    assert.equal(f.storage.length, 0);
    assert.equal(f.getWrites(), 0);
    assert.equal(f.credits.isComplete(), false);
  }
});

test("room, session and project have separate persistent ledgers", async () => {
  const f = fixture();
  f.setOnline(false);
  f.credits.consume(1);
  for (const change of [{ roomId: "B" }, { sessionId: "demo-2" }, { projectId: "other" }]) {
    assert.equal(createDemoMatchCredits({ ...f.options, ...change }).getCount(), 0);
  }
  await settle();
});

test("storage failure is surfaced rather than pretending that CLOSE was durably recorded", () => {
  const f = fixture({ storage: { length: 0, key: () => null, getItem: () => null, setItem() { throw Error("Quota"); } } });
  assert.throws(() => f.credits.consume(1), /Quota/);
  assert.equal(f.credits.getCount(), 0);
});

