import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { getApps } from 'firebase-admin/app';
import { PRODUCTION_PROJECT_ID } from './productionAdmin.js';
import { parseProductionRoleArgs, provisionProductionRoles } from './provisionProductionRoles.js';
import { validateProductionRoleInput, provisionProductionRolesWithAdmin } from './productionRoleProvisioning.js';
import { initialRoomDocuments } from './roomDefaults.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const keys = ['public', 'judge/1', 'judge/2', 'judge/3'];
const input = { projectId: PRODUCTION_PROJECT_ID, roomId: 'A', roles: Object.fromEntries(keys.map(key => [key, key.replace('/', '-') + '@patterns.test'])) };
const claimsFor = key => key === 'public' ? { roomId: 'A', role: 'public' } : { roomId: 'A', role: 'judge', judgeId: Number(key.slice(6)) };
const env = { PATTERNS_ADMIN_ENV: 'production', GOOGLE_APPLICATION_CREDENTIALS: join(tmpdir(), 'synthetic-unused-role-key.json') };

function fixture() {
  const users = new Map([['president', { uid: 'president', email: 'owner@patterns.test', disabled: false, customClaims: { roomId: 'A', role: 'president' }, passwordHash: 'SYNTHETIC_UNCHANGED' }]]);
  const documents = new Map([
    ['_roomProvisioning/A', { uid: 'president', version: 1, status: 'complete' }],
    ['_presidentAssignments/' + hash('president'), { roomId: 'A', role: 'president' }],
    ...['control', 'meta', 'publicState'].map((name, i) => ['rooms/A/' + name + '/current', initialRoomDocuments()[i]]),
    ['rooms/A/submissions/1', { evaluationId: 9, vote: 'hong', sent: true }],
    ['rooms/A/demoSessions/retained', { consumedEvaluationIds: [1, 2], confirmedCount: 2 }],
    ['rooms/B/control/current', { evaluationId: 7 }],
  ]);
  documents.get('rooms/A/control/current').evaluationId = 9;
  let writes = 0; let creations = 0; let assignments = 0;
  const failures = {};
  const snapshot = path => ({ exists: documents.has(path), data: () => structuredClone(documents.get(path)) });
  const db = {
    projectId: PRODUCTION_PROJECT_ID,
    doc: path => ({ path, get: async () => snapshot(path) }),
    getAll: async (...refs) => refs.map(ref => snapshot(ref.path)),
    async runTransaction(action) {
      const pending = []; let wrote = false;
      const result = await action({
        getAll: async (...refs) => { assert.equal(wrote, false, 'Firestore reads must precede writes'); return refs.map(ref => snapshot(ref.path)); },
        create(ref, data) { assert.equal(documents.has(ref.path), false); wrote = true; pending.push([ref.path, structuredClone(data)]); },
        update(ref, data) { assert.equal(documents.has(ref.path), true); wrote = true; pending.push([ref.path, { ...documents.get(ref.path), ...structuredClone(data) }]); },
      });
      for (const [path, data] of pending) { documents.set(path, data); writes++; }
      return result;
    },
  };
  const notFound = () => { throw Object.assign(new Error('private SDK details'), { code: 'auth/user-not-found' }); };
  const auth = {
    app: { options: { projectId: PRODUCTION_PROJECT_ID } },
    async getUser(uid) { return users.has(uid) ? structuredClone(users.get(uid)) : notFound(); },
    async getUserByEmail(email) { const user = [...users.values()].find(user => user.email.toLowerCase() === email); return user ? structuredClone(user) : notFound(); },
    async listUsers(_, pageToken) {
      const start = Number(pageToken ?? 0); const all = [...users.values()];
      // Force pagination, including duplicates appearing on later pages.
      return { users: structuredClone(all.slice(start, start + 1)), ...(start + 1 < all.length ? { pageToken: String(start + 1) } : {}) };
    },
    async createUser(data) {
      if (users.has(data.uid)) throw Object.assign(new Error('private details'), { code: 'auth/uid-already-exists' });
      creations++; users.set(data.uid, { ...structuredClone(data), disabled: false, providerData: [] });
      if (failures.createAfter) { failures.createAfter = false; throw new Error('CREATE_RESPONSE_LOST'); }
      return structuredClone(users.get(data.uid));
    },
    async setCustomUserClaims(uid, claims) {
      assert.notEqual(uid, 'president'); assignments++;
      if (failures.claimsBefore) { failures.claimsBefore = false; throw new Error('CLAIMS_FAILED'); }
      users.get(uid).customClaims = structuredClone(claims);
      if (failures.claimsAfter) { failures.claimsAfter = false; throw new Error('CLAIMS_RESPONSE_LOST'); }
      if (failures.secondClaim && assignments === 2) { failures.secondClaim = false; throw new Error('PARTIAL_BATCH'); }
    },
  };
  return { users, documents, db, auth, failures, projectId: PRODUCTION_PROJECT_ID,
    get writes() { return writes; }, get creations() { return creations; }, get assignments() { return assignments; },
    run: value => provisionProductionRolesWithAdmin(value ?? input, { auth, db, projectId: PRODUCTION_PROJECT_ID }) };
}

test('CLI and manifest require explicit project, apply, room A and exactly four distinct roles', () => {
  const args = ['--apply', '--project', PRODUCTION_PROJECT_ID, '--room', 'A'];
  assert.deepEqual(parseProductionRoleArgs(args), { projectId: PRODUCTION_PROJECT_ID, apply: true, roomId: 'A' });
  for (const bad of [[], args.slice(1), [...args, '--force']]) assert.throws(() => parseProductionRoleArgs(bad));
  for (const bad of [null, { ...input, projectId: 'hwarang-scoring' }, { ...input, roomId: 'B' },
    { ...input, roomId: '../A' }, { ...input, role: 'president' }, { ...input, roles: [] },
    { ...input, roles: { ...input.roles, 'judge/4': 'extra@patterns.test' } },
    { ...input, roles: { ...input.roles, public: input.roles['judge/1'].toUpperCase() } },
    { ...input, roles: { ...input.roles, public: 'invalid' } }]) assert.throws(() => validateProductionRoleInput(bad));
});

test('wrapper rejects unsafe environment and input before initializing any Admin app', async () => {
  const count = getApps().length;
  for (const [value, environment] of [
    [{ ...input, apply: false }, env], [{ ...input, apply: true, projectId: 'other' }, env],
    [{ ...input, apply: true }, { ...env, FIRESTORE_EMULATOR_HOST: '' }],
    [{ ...input, apply: true, roomId: 'B' }, env],
    [{ ...input, apply: true, roles: {} }, env],
  ]) await assert.rejects(provisionProductionRoles(value, environment));
  assert.equal(getApps().length, count);
});

test('provisions exact individual claims; repeat writes nothing and preserves President, sport and credits', async () => {
  const f = fixture(); const before = structuredClone([...f.documents]); const president = structuredClone(f.users.get('president'));
  assert.deepEqual(await f.run(), { ok: true, roomId: 'A', roleCount: 4, created: 4, assigned: 4 });
  assert.equal(f.documents.size, before.length + 5);
  const plan = f.documents.get('_roomRoleProvisioning/A'); assert.equal(plan.status, 'complete');
  for (const key of keys) assert.deepEqual(f.users.get(plan.roles[key].uid).customClaims, claimsFor(key));
  assert.equal(new Set(keys.map(key => plan.roles[key].uid)).size, 4);
  for (const [path, data] of before) assert.deepEqual(f.documents.get(path), data);
  assert.deepEqual(f.users.get('president'), president);
  assert.equal(JSON.stringify(plan).includes('@patterns.test'), false);
  const writes = f.writes;
  assert.deepEqual(await f.run(), { ok: true, roomId: 'A', roleCount: 4, created: 0, assigned: 0 });
  assert.equal(f.writes, writes); assert.equal(f.creations, 4); assert.equal(f.assignments, 4);
});

test('recovers lost creation and claim responses without replacing users or sports documents', async () => {
  for (const failure of ['createAfter', 'claimsBefore', 'claimsAfter', 'secondClaim']) {
    const f = fixture(); const before = structuredClone([...f.documents]); f.failures[failure] = true;
    await assert.rejects(f.run()); assert.equal(f.documents.get('_roomRoleProvisioning/A').status, 'pending');
    await f.run(); assert.equal(f.creations, 4); assert.equal(f.documents.get('_roomRoleProvisioning/A').status, 'complete');
    for (const [path, data] of before) assert.deepEqual(f.documents.get(path), data);
  }
});

test('all roles preflight before mutations; foreign, disabled, unclaimed and duplicate assignments fail closed', async () => {
  for (const mutate of [
    f => { f.documents.delete('rooms/A/meta/current'); },
    f => { f.documents.get('rooms/A/control/current').config.patternJudges = 5; },
    f => { f.documents.get('_roomProvisioning/A').status = 'pending'; },
    f => { f.users.get('president').disabled = true; },
    f => { f.users.get('president').customClaims.role = 'public'; },
    f => { f.documents.delete('_presidentAssignments/' + hash('president')); },
    f => { f.users.set('foreign', { uid: 'foreign', email: input.roles['judge/3'], customClaims: { roomId: 'B', role: 'judge', judgeId: 3 } }); },
    f => { f.users.set('foreign', { uid: 'foreign', email: input.roles['judge/3'], customClaims: {} }); },
    f => { f.users.set('foreign', { uid: 'foreign', email: input.roles['judge/3'], disabled: true, customClaims: claimsFor('judge/3') }); },
    f => { f.users.set('duplicate', { uid: 'duplicate', email: 'duplicate@patterns.test', customClaims: claimsFor('judge/1') }); },
    f => { f.users.set('malformed', { uid: 'malformed', email: 'bad@patterns.test', customClaims: { roomId: 'A', role: 'judge', judgeId: '1' } }); },
    f => { f.db.projectId = 'other'; },
  ]) {
    const f = fixture(); mutate(f); const before = structuredClone([...f.documents]); const users = structuredClone([...f.users]);
    await assert.rejects(f.run()); assert.equal(f.writes, 0); assert.equal(f.creations, 0); assert.equal(f.assignments, 0);
    assert.deepEqual([...f.documents], before); assert.deepEqual([...f.users], users);
  }
});

test('reuses compatible accounts without touching claims or credentials; reservations prevent replacement', async () => {
  const f = fixture();
  for (const key of keys) f.users.set(key, { uid: key, email: input.roles[key], customClaims: claimsFor(key), passwordHash: 'SYNTHETIC_PASSWORD' });
  const users = structuredClone([...f.users]);
  assert.deepEqual(await f.run(), { ok: true, roomId: 'A', roleCount: 4, created: 0, assigned: 0 });
  assert.deepEqual([...f.users], users);
  const writes = f.writes;
  await assert.rejects(f.run({ ...input, roles: { ...input.roles, public: 'replacement@patterns.test' } }), /PLAN_CONFLICT/);
  assert.equal(f.writes, writes);
  f.users.delete('public');
  await assert.rejects(f.run(), /USER_MISSING/); assert.equal(f.writes, writes);
});

test('conflicting UID reservations and past President assignments cause no Auth mutations', async () => {
  for (const collection of ['_roleAssignments', '_presidentAssignments']) {
    const f = fixture(); const uid = 'patterns-hti-A-public-' + hash(input.roles.public).slice(0, 32);
    f.documents.set(collection + '/' + hash(uid), { roomId: 'B', role: 'president' });
    await assert.rejects(f.run(), /RESERVATION_CONFLICT/);
    assert.equal(f.writes, 0); assert.equal(f.creations, 0); assert.equal(f.assignments, 0);
  }
});

test('changed owner or corrupted pending user stops resumption without promoting it', async () => {
  for (const mutate of [
    f => { f.users.get('president').customClaims.roomId = 'B'; },
    f => { const uid = f.documents.get('_roomRoleProvisioning/A').roles.public.uid; f.users.get(uid).displayName = 'foreign user'; },
    f => { f.documents.get('_roomRoleProvisioning/A').status = 'unknown'; },
    f => { const uid = f.documents.get('_roomRoleProvisioning/A').roles.public.uid; f.documents.delete('_roleAssignments/' + hash(uid)); },
  ]) {
    const f = fixture(); f.failures.claimsBefore = true; await assert.rejects(f.run()); mutate(f);
    const assigned = f.assignments; await assert.rejects(f.run()); assert.equal(f.assignments, assigned);
  }
});

test('CLI failures never print manifest values, parser details or credential paths', () => {
  const result = spawnSync(process.execPath, ['scripts/provisionProductionRoles.js', '--apply', '--project', PRODUCTION_PROJECT_ID, '--room', 'A'],
    { input: '{ PRIVATE_MANIFEST_CONTENT', encoding: 'utf8', env: { ...globalThis.process.env, ...env } });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.trim(), 'PRODUCTION_ROLE_PROVISION_FAILED');
});

test('concurrent manifests cannot reserve the same role for different users', async () => {
  const f = fixture();
  // Model Firestore transaction serialization; the losing run must fail before Auth writes.
  const transaction = f.db.runTransaction.bind(f.db);
  let tail = Promise.resolve();
  f.db.runTransaction = action => {
    const result = tail.then(() => transaction(action));
    tail = result.catch(() => {});
    return result;
  };
  const alternative = { ...input, roles: { ...input.roles, public: 'other-public@patterns.test' } };
  const results = await Promise.allSettled([f.run(), f.run(alternative)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.equal(f.creations, 4);
  assert.equal(f.users.size, 5);
  assert.equal(f.documents.get('_roomRoleProvisioning/A').status, 'complete');
  const publicUsers = [...f.users.values()].filter(user => user.customClaims?.role === 'public');
  assert.equal(publicUsers.length, 1);
});
