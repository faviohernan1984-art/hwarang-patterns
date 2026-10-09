import test from 'node:test';
import assert from 'node:assert/strict';
import { assignLocalDemoSession } from './assignLocalDemo.js';

const localEnv = {
  PATTERNS_DEV_PRESIDENT: 'true', GCLOUD_PROJECT: 'demo-patterns-gups',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
};
const metaPath = 'rooms/A/meta/current';
const ledgerPath = 'rooms/A/demoSessions/local-room-A-demo';

// In-memory transaction double: never activates Room A or connects to Firebase.
function fixture() {
  const documents = new Map([
    ['rooms/A/control/current', { evaluationId: 17, status: 'paused', hong: { name: 'Existing athlete' } }],
    [metaPath, { presidentSwapSides: true, patternResult: { completed: true, winner: 'hong' } }],
    ['rooms/A/publicState/current', { result: { winner: 'hong' } }],
    ['rooms/B/meta/current', { marker: 'untouched' }],
  ]);
  let writes = 0;
  const db = {
    doc: path => path,
    async runTransaction(callback) {
      const pending = [];
      const result = await callback({
        getAll: async (...paths) => paths.map(path => ({ exists: documents.has(path), data: () => structuredClone(documents.get(path)) })),
        create(path, value) { assert.equal(documents.has(path), false); pending.push([path, structuredClone(value)]); },
        update(path, value) { assert.equal(documents.has(path), true); pending.push([path, { ...documents.get(path), ...structuredClone(value) }]); },
      });
      for (const [path, value] of pending) { documents.set(path, value); writes += 1; }
      return result;
    },
  };
  return { db, documents, get writes() { return writes; } };
}

test('local assignment preserves room data and consumed credits on repeated invocation', async () => {
  const f = fixture();
  const before = structuredClone(f.documents);
  const first = await assignLocalDemoSession(f.db, localEnv);
  assert.deepEqual(first, { roomId: 'A', sessionId: 'local-room-A-demo', created: true });
  for (const [path, value] of before) {
    assert.deepEqual(f.documents.get(path), path === metaPath ? { ...value, demoSessionId: first.sessionId } : value);
  }
  assert.deepEqual(f.documents.get(ledgerPath), { sessionId: first.sessionId, consumedEvaluationIds: [], confirmedCount: 0 });
  f.documents.set(ledgerPath, { sessionId: first.sessionId, consumedEvaluationIds: [1, 7, 17], confirmedCount: 3 });
  const consumed = structuredClone(f.documents);
  assert.deepEqual(await assignLocalDemoSession(f.db, localEnv), { ...first, created: false });
  assert.deepEqual(f.documents, consumed);
  assert.equal(f.writes, 2);
});

test('an existing different session is preserved without creating another ledger', async () => {
  const f = fixture();
  f.documents.get(metaPath).demoSessionId = 'existing-demo';
  f.documents.set('rooms/A/demoSessions/existing-demo', { sessionId: 'existing-demo', consumedEvaluationIds: [2], confirmedCount: 1 });
  const before = structuredClone(f.documents);
  assert.deepEqual(await assignLocalDemoSession(f.db, localEnv), { roomId: 'A', sessionId: 'existing-demo', created: false });
  assert.deepEqual(f.documents, before);
  assert.equal(f.writes, 0);
});

test('partial provisioning, invalid assignments and orphan ledgers fail without writes', async () => {
  for (const customize of [
    f => f.documents.delete('rooms/A/control/current'),
    f => f.documents.delete(metaPath),
    f => f.documents.delete('rooms/A/publicState/current'),
    ...[null, '', 'invalid/session'].map(value => f => { f.documents.get(metaPath).demoSessionId = value; }),
    f => f.documents.set(ledgerPath, { consumedEvaluationIds: [3], confirmedCount: 1 }),
  ]) {
    const f = fixture(); customize(f);
    const before = structuredClone(f.documents);
    await assert.rejects(assignLocalDemoSession(f.db, localEnv));
    assert.deepEqual(f.documents, before);
    assert.equal(f.writes, 0);
  }
});

test('unsafe environment is rejected before any database access', async () => {
  const forbiddenDb = { doc() { assert.fail('Database accessed before environment validation'); } };
  for (const override of [
    ...Object.keys(localEnv).map(key => ({ [key]: undefined })),
    { GCLOUD_PROJECT: 'production' }, { GOOGLE_CLOUD_PROJECT: 'production' },
    { FIREBASE_PROJECT_ID: 'production' }, { GOOGLE_APPLICATION_CREDENTIALS: 'key.json' },
    { FIREBASE_CONFIG: '{}' }, { FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' },
    { FIREBASE_AUTH_EMULATOR_HOST: '192.168.0.1:9099' }, { FIRESTORE_EMULATOR_HOST: 'localhost:9099' },
  ]) await assert.rejects(assignLocalDemoSession(forbiddenDb, { ...localEnv, ...override }));
});
