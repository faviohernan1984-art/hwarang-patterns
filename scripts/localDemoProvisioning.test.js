import test from 'node:test';
import assert from 'node:assert/strict';
import { initialRoomDocuments } from './roomDefaults.js';
import { validDemoSessionId, DEMO_MATCH_LIMIT } from '../src/demoMatchCredits.js';
import { allocateLocalDemo, ensureLocalDemoRoom, makeLocalDemoRoomId } from './localDemoProvisioning.js';

const env = {
  PATTERNS_DEV_PRESIDENT: 'true', GCLOUD_PROJECT: 'demo-patterns-gups',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
};
const room = digit => 'demo-patterns-' + digit.repeat(24);
const base = roomId => 'rooms/' + roomId;
const metaPath = roomId => base(roomId) + '/meta/current';
const ledgerPath = result => base(result.roomId) + '/demoSessions/' + result.demoSessionId;

// Adapted from Combat's provisioning tests. All data stays in memory.
// Buffer creates and validate the whole commit to model atomic rollback.
function fakeFirestore(entries = []) {
  const documents = new Map(structuredClone(entries));
  let queue = Promise.resolve();
  let reads = 0;
  let writes = 0;
  let failCommit = false;
  return {
    documents,
    get reads() { return reads; },
    get writes() { return writes; },
    failNextCommit() { failCommit = true; },
    projectId: 'demo-patterns-gups',
    doc: path => ({ path }),
    collection: path => ({ limit: count => ({ path, count }) }),
    runTransaction(callback) {
      const operation = queue.then(async () => {
        const pending = [];
        const assertReading = () => assert.equal(pending.length, 0, 'All transaction reads must precede writes');
        const tx = {
          async getAll(...refs) {
            assertReading(); reads += refs.length;
            return refs.map(ref => ({ exists: documents.has(ref.path), data: () => structuredClone(documents.get(ref.path)) }));
          },
          async get(query) {
            assertReading(); reads += 1;
            const prefix = query.path + '/';
            const docs = [...documents.keys()].filter(path => path.startsWith(prefix) && !path.slice(prefix.length).includes('/')).slice(0, query.count);
            return { empty: docs.length === 0 };
          },
          create(ref, value) { pending.push([ref.path, structuredClone(value)]); },
        };
        const result = await callback(tx);
        const paths = new Set();
        for (const [path] of pending) {
          if (documents.has(path) || paths.has(path)) throw new Error('ALREADY_EXISTS');
          paths.add(path);
        }
        if (failCommit) { failCommit = false; throw new Error('SIMULATED_COMMIT_FAILURE'); }
        for (const [path, value] of pending) { documents.set(path, value); writes += 1; }
        return result;
      });
      queue = operation.catch(() => {});
      return operation;
    },
  };
}
const create = (db, roomId) => ensureLocalDemoRoom(db, roomId, { allowCreate: true, env });

test('server IDs are valid, independent and accepted by the provisioning contract', async () => {
  const db = fakeFirestore();
  const ids = new Set(Array.from({ length: 32 }, makeLocalDemoRoomId));
  assert.equal(ids.size, 32);
  for (const id of ids) {
    assert.match(id, /^demo-patterns-[a-f0-9]{24}$/);
    const result = await create(db, id);
    assert.equal(result.created, true);
    assert.equal(validDemoSessionId(result.demoSessionId), result.demoSessionId);
  }
});

test('creation uses Patterns defaults and atomically creates a zero-consumption ledger without time expiry', async () => {
  const db = fakeFirestore();
  const result = await allocateLocalDemo(db, null, { env, generateRoomId: () => room('a') });
  assert.deepEqual(result, { ok: true, roomId: room('a'), demoSessionId: 'patterns-session-' + 'a'.repeat(24), created: true });
  const [control, meta, publicState] = initialRoomDocuments();
  assert.deepEqual(db.documents, new Map([
    [base(result.roomId) + '/control/current', control],
    [metaPath(result.roomId), { ...meta, demoSessionId: result.demoSessionId, demoProvisioningVersion: 1 }],
    [base(result.roomId) + '/publicState/current', publicState],
    [ledgerPath(result), { sessionId: result.demoSessionId, consumedEvaluationIds: [], confirmedCount: 0 }],
  ]));
  assert.equal(db.writes, 4);
});

test('two allocated rooms have exclusive sessions and preserve Room A and each other', async () => {
  const db = fakeFirestore([['rooms/A/meta/current', { demoSessionId: 'original-room-A', marker: 'untouched' }]]);
  const first = await allocateLocalDemo(db, null, { env, generateRoomId: () => room('a') });
  const consumed = { sessionId: first.demoSessionId, consumedEvaluationIds: [1, 7], confirmedCount: 2 };
  db.documents.set(ledgerPath(first), consumed);
  const before = structuredClone(db.documents);
  const second = await allocateLocalDemo(db, null, { env, generateRoomId: () => room('b') });
  assert.notEqual(first.roomId, second.roomId);
  assert.notEqual(first.demoSessionId, second.demoSessionId);
  for (const [path, value] of before) assert.deepEqual(db.documents.get(path), value);
  assert.equal(db.documents.get(ledgerPath(second)).confirmedCount, 0);
});

test('compatible reuse preserves sports state and all credits, including exhausted sessions', async () => {
  for (const count of [3, DEMO_MATCH_LIMIT]) {
    const db = fakeFirestore();
    const created = await create(db, room('a'));
    db.documents.get(base(created.roomId) + '/control/current').evaluationId = 41;
    db.documents.get(base(created.roomId) + '/control/current').hong.name = 'Existing athlete';
    db.documents.get(metaPath(created.roomId)).patternResult = { completed: true, winner: 'hong' };
    db.documents.set(base(created.roomId) + '/submissions/1', { evaluationId: 41, sent: true });
    db.documents.set(ledgerPath(created), {
      sessionId: created.demoSessionId, consumedEvaluationIds: Array.from({ length: count }, (_, i) => i + 1), confirmedCount: count,
    });
    const before = structuredClone(db.documents);
    const result = await allocateLocalDemo(db, created.roomId, { env, generateRoomId: () => assert.fail('Reuse must not generate a new room') });
    assert.equal(result.created, false);
    assert.equal(result.demoSessionId, created.demoSessionId);
    assert.deepEqual(db.documents, before);
    assert.equal(db.writes, 4);
  }
});

test('concurrent provisioning of the same candidate is idempotent', async () => {
  const db = fakeFirestore();
  const results = await Promise.all([create(db, room('a')), create(db, room('a'))]);
  assert.deepEqual(results.map(result => result.created), [true, false]);
  assert.equal(results[0].demoSessionId, results[1].demoSessionId);
  assert.equal(db.documents.size, 4);
  assert.equal(db.writes, 4);
});

test('fresh allocation retries collisions without returning or modifying an existing room', async () => {
  const db = fakeFirestore();
  const existing = await create(db, room('a'));
  db.documents.set(ledgerPath(existing), { sessionId: existing.demoSessionId, consumedEvaluationIds: [2], confirmedCount: 1 });
  db.documents.set(metaPath(room('b')), { marker: 'incompatible candidate' });
  const before = structuredClone(db.documents);
  const candidates = [room('a'), room('b'), room('c')];
  const result = await allocateLocalDemo(db, null, { env, generateRoomId: () => candidates.shift() });
  assert.equal(result.roomId, room('c'));
  assert.equal(result.created, true);
  for (const [path, value] of before) assert.deepEqual(db.documents.get(path), value);
});

test('three collisions fail without writes or credit resets', async () => {
  const db = fakeFirestore();
  await create(db, room('a'));
  const before = structuredClone(db.documents);
  let attempts = 0;
  await assert.rejects(allocateLocalDemo(db, null, { env, generateRoomId: () => { attempts += 1; return room('a'); } }), /DEMO_PROVISIONING_FAILED/);
  assert.equal(attempts, 3);
  assert.deepEqual(db.documents, before);
  assert.equal(db.writes, 4);
});

test('partial rooms and orphan ledgers, judges or submissions are never overwritten', async () => {
  for (const suffix of ['', '/control/current', '/meta/current', '/publicState/current', '/demoSessions/old-session', '/judges/1', '/submissions/1']) {
    const db = fakeFirestore([[base(room('a')) + suffix, { marker: 'existing data' }]]);
    const before = structuredClone(db.documents);
    assert.deepEqual(await create(db, room('a')), { created: false, compatible: false });
    await assert.rejects(allocateLocalDemo(db, room('a'), { env }), /NOT_FOUND_OR_INCOMPATIBLE/);
    assert.deepEqual(db.documents, before);
    assert.equal(db.writes, 0);
  }
});

test('incompatible session markers, schema and corrupt credits are rejected without repairs', async () => {
  for (const customize of [
    (db, result) => { delete db.documents.get(metaPath(result.roomId)).demoProvisioningVersion; },
    (db, result) => { db.documents.get(metaPath(result.roomId)).demoProvisioningVersion = 2; },
    (db, result) => { db.documents.get(metaPath(result.roomId)).demoSessionId = 'another-session'; },
    (db, result) => { db.documents.get(base(result.roomId) + '/control/current').config.scoringMode = 'combat'; },
    (db, result) => { db.documents.delete(ledgerPath(result)); },
    (db, result) => { db.documents.get(ledgerPath(result)).sessionId = 'another-session'; },
    (db, result) => { db.documents.get(ledgerPath(result)).confirmedCount = 9; },
    (db, result) => { Object.assign(db.documents.get(ledgerPath(result)), { consumedEvaluationIds: [1, 1], confirmedCount: 2 }); },
    (db, result) => { Object.assign(db.documents.get(ledgerPath(result)), { consumedEvaluationIds: [-1], confirmedCount: 1 }); },
  ]) {
    const db = fakeFirestore(); const result = await create(db, room('a')); customize(db, result);
    const before = structuredClone(db.documents);
    assert.deepEqual(await create(db, room('a')), { created: false, compatible: false });
    await assert.rejects(allocateLocalDemo(db, room('a'), { env }), /NOT_FOUND_OR_INCOMPATIBLE/);
    assert.deepEqual(db.documents, before);
    assert.equal(db.writes, 4);
  }
});

test('missing or invalid reuse requests cannot create arbitrary rooms', async () => {
  const db = fakeFirestore();
  assert.deepEqual(await ensureLocalDemoRoom(db, room('a'), { env }), { created: false, compatible: false });
  await assert.rejects(allocateLocalDemo(db, room('a'), { env }), /NOT_FOUND_OR_INCOMPATIBLE/);
  for (const id of ['', 'A', 'demo-hsu-a2b3c', '../other', room('a') + '/subpath', 42]) {
    await assert.rejects(create(db, id), /INVALID_DEMO_ROOM_ID/);
    await assert.rejects(allocateLocalDemo(db, id, { env }), /INVALID_DEMO_ROOM_ID/);
  }
  assert.equal(db.documents.size, 0);
  assert.equal(db.writes, 0);
});

test('transaction failure leaves no partial room; retry creates exactly once', async () => {
  const db = fakeFirestore(); db.failNextCommit();
  await assert.rejects(create(db, room('a')), /SIMULATED_COMMIT_FAILURE/);
  assert.equal(db.documents.size, 0);
  assert.equal(db.writes, 0);
  assert.equal((await create(db, room('a'))).created, true);
  assert.equal((await create(db, room('a'))).created, false);
  assert.equal(db.documents.size, 4);
});

test('environment and database project guards reject unsafe access before Firestore operations', async () => {
  const db = fakeFirestore();
  for (const override of [
    ...Object.keys(env).map(key => ({ [key]: undefined })),
    { PATTERNS_DEV_PRESIDENT: 'false' }, { GCLOUD_PROJECT: 'production' },
    { GOOGLE_CLOUD_PROJECT: 'production' }, { FIREBASE_PROJECT_ID: 'production' },
    { GOOGLE_APPLICATION_CREDENTIALS: 'key.json' }, { FIREBASE_CONFIG: '{}' },
    { FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' },
    { FIREBASE_AUTH_EMULATOR_HOST: '192.168.0.1:9099' },
    { FIRESTORE_EMULATOR_HOST: 'localhost:9099' }, { FIRESTORE_EMULATOR_HOST: 'localhost:65536' },
  ]) {
    await assert.rejects(createWithEnv({ ...env, ...override }));
    await assert.rejects(allocateLocalDemo(db, null, { env: { ...env, ...override }, generateRoomId: () => assert.fail('Generated before validation') }));
  }
  for (const projectId of ['production', undefined]) {
    db.projectId = projectId;
    await assert.rejects(create(db, room('a')), /UNVERIFIED_LOCAL_DATABASE/);
    await assert.rejects(allocateLocalDemo(db, null, { env }), /UNVERIFIED_LOCAL_DATABASE/);
  }
  assert.equal(db.reads, 0);
  assert.equal(db.writes, 0);
  function createWithEnv(source) { return ensureLocalDemoRoom(db, room('a'), { allowCreate: true, env: source }); }
});
