
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getApps } from 'firebase-admin/app';
import { PRODUCTION_PROJECT_ID, validateProductionEnvironment, readProductionServiceAccount } from './productionAdmin.js';
import { parseProductionProvisionArgs, provisionProductionPresident } from './provisionProductionPresident.js';
import { provisionPresidentWithAdmin } from './presidentProvisioning.js';
import { initialRoomDocuments } from './roomDefaults.js';
import { validateAdminEnvironment } from './localAdmin.js';

const valid = { PATTERNS_ADMIN_ENV: 'production', GOOGLE_APPLICATION_CREDENTIALS: join(tmpdir(), 'patterns-account-test.json') };
const input = { projectId: PRODUCTION_PROJECT_ID, apply: true, roomId: 'B', email: 'president@patterns.test' };

test('production accepts only the exact project with explicit intent and external credentials', () => {
  assert.equal(validateProductionEnvironment(PRODUCTION_PROJECT_ID, true, valid).projectId, PRODUCTION_PROJECT_ID);
  for (const project of [undefined, '', 'demo-patterns-gups', 'hwarang-scoring', 'other-project']) assert.throws(() => validateProductionEnvironment(project, true, valid), /NOT_APPROVED/);
  for (const apply of [undefined, false, 'true']) assert.throws(() => validateProductionEnvironment(PRODUCTION_PROJECT_ID, apply, valid), /INTENT/);
  for (const mode of [undefined, '', 'development']) assert.throws(() => validateProductionEnvironment(PRODUCTION_PROJECT_ID, true, { ...valid, PATTERNS_ADMIN_ENV: mode }), /INTENT/);
});
test('every Emulator variable is rejected even if empty and project conflicts fail closed', () => {
  for (const key of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST', 'PATTERNS_DEV_PRESIDENT', 'FIREBASE_CONFIG']) {
    for (const value of ['', 'false', '127.0.0.1:9099']) assert.throws(() => validateProductionEnvironment(PRODUCTION_PROJECT_ID, true, { ...valid, [key]: value }), /MIXED/);
  }
  for (const key of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FIREBASE_PROJECT_ID']) assert.throws(() => validateProductionEnvironment(PRODUCTION_PROJECT_ID, true, { ...valid, [key]: 'demo-patterns-gups' }), /CONFLICTING/);
  for (const path of [undefined, '', 'account.json', resolve('account.json')]) assert.throws(() => validateProductionEnvironment(PRODUCTION_PROJECT_ID, true, { ...valid, GOOGLE_APPLICATION_CREDENTIALS: path }));
});
test('CLI requires apply, project, room and email and rejects extra inputs', () => {
  const args = ['--apply', '--project', PRODUCTION_PROJECT_ID, '--room', 'B', '--email', 'president@patterns.test'];
  assert.deepEqual(parseProductionProvisionArgs(args), input);
  for (const bad of [[], args.slice(1), [...args, '--force'], [...args.slice(0, 4), '../B', ...args.slice(5)]]) assert.throws(() => parseProductionProvisionArgs(bad));
});
test('unsafe production calls reject before any Admin app initializes', async () => {
  const before = getApps().length;
  await assert.rejects(provisionProductionPresident({ ...input, projectId: 'other-project' }, valid), /NOT_APPROVED/);
  await assert.rejects(provisionProductionPresident(input, { ...valid, FIRESTORE_EMULATOR_HOST: '' }), /MIXED/);
  await assert.rejects(provisionProductionPresident({ ...input, roomId: '../B' }, valid), /ROOM_ID/);
  await assert.rejects(provisionProductionPresident({ ...input, role: 'admin' }, valid), /ARGUMENTS/);
  assert.equal(getApps().length, before);
});
test('external credential content must belong to Patterns; parser errors never expose content', () => {
  const directory = mkdtempSync(join(tmpdir(), 'patterns-credential-test-'));
  const path = join(directory, 'account.json');
  try {
    const account = { type: 'service_account', project_id: PRODUCTION_PROJECT_ID, client_email: 'test@' + PRODUCTION_PROJECT_ID + '.iam.gserviceaccount.com', private_key: 'TEST_ONLY_NOT_A_KEY', token_uri: 'https://untrusted.invalid' };
    writeFileSync(path, JSON.stringify(account));
    assert.deepEqual(readProductionServiceAccount(path), { projectId: account.project_id, clientEmail: account.client_email, privateKey: account.private_key });
    for (const override of [{ project_id: 'other-project' }, { client_email: 'test@other-project.iam.gserviceaccount.com' }, { type: 'authorized_user' }, { private_key: '' }]) {
      writeFileSync(path, JSON.stringify({ ...account, ...override }));
      assert.throws(() => readProductionServiceAccount(path), /MISMATCH/);
    }
    writeFileSync(path, '{ PRIVATE_TEST_CONTENT');
    assert.throws(() => readProductionServiceAccount(path), error => error.message === 'INVALID_EXTERNAL_SERVICE_ACCOUNT');
  } finally { rmSync(directory, { recursive: true }); }
});
test('local Admin continues rejecting cloud and requiring explicit Emulator endpoints', () => {
  const env = { PATTERNS_DEV_PRESIDENT: 'true', GCLOUD_PROJECT: 'demo-patterns-gups', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' };
  assert.equal(validateAdminEnvironment(env), 'demo-patterns-gups');
  assert.throws(() => validateAdminEnvironment({ ...env, GCLOUD_PROJECT: PRODUCTION_PROJECT_ID }));
  assert.throws(() => validateAdminEnvironment({ ...env, GOOGLE_APPLICATION_CREDENTIALS: valid.GOOGLE_APPLICATION_CREDENTIALS }));
});

function stubAdmin(existing) {
  const documents = new Map();
  let user = existing && structuredClone(existing);
  let failClaims = false;
  let creations = 0;
  const snapshot = path => ({ exists: documents.has(path), data: () => structuredClone(documents.get(path)) });
  const db = {
    doc(path) { return { path, async update(data) { documents.set(path, { ...documents.get(path), ...data }); } }; },
    async runTransaction(action) {
      const pending = [];
      const result = await action({
        async getAll(...refs) { return refs.map(ref => snapshot(ref.path)); },
        create(ref, data) { if (documents.has(ref.path)) throw Error('DUPLICATE'); pending.push([ref.path, structuredClone(data)]); },
      });
      for (const [path, data] of pending) documents.set(path, data);
      return result;
    },
  };
  const auth = {
    async getUserByEmail() { if (!user) throw Object.assign(Error(), { code: 'auth/user-not-found' }); return structuredClone(user); },
    async createUser({ email }) { creations++; user = { uid: 'stub-uid', email }; return structuredClone(user); },
    async getUser() { return structuredClone(user); },
    async setCustomUserClaims(_uid, claims) { if (failClaims) { failClaims = false; throw Error('SIMULATED_INTERRUPTION'); } user.customClaims = structuredClone(claims); },
  };
  return { auth, db, projectId: PRODUCTION_PROJECT_ID, assignmentCollection: '_presidentAssignments', journalCollection: '_roomProvisioning', documents,
    interruptClaims() { failClaims = true; }, get user() { return user; }, get creations() { return creations; } };
}
const provisionInput = { roomId: 'B', email: 'president@patterns.test' };
test('stub provisioning creates only minimum Room documents, journals and exact claims; repeat preserves data', async () => {
  const admin = stubAdmin();
  const first = await provisionPresidentWithAdmin(provisionInput, admin);
  assert.equal(first.created, true);
  assert.equal(admin.documents.size, 5);
  assert.deepEqual(admin.user.customClaims, { roomId: 'B', role: 'president' });
  assert.deepEqual(['control','meta','publicState'].map(name => admin.documents.get('rooms/B/' + name + '/current')), initialRoomDocuments());
  admin.documents.get('rooms/B/control/current').evaluationId = 9;
  const second = await provisionPresidentWithAdmin(provisionInput, admin);
  assert.equal(second.created, false);
  assert.equal(admin.creations, 1);
  assert.equal(admin.documents.get('rooms/B/control/current').evaluationId, 9);
});
test('stub provisioning refuses incompatible claims and disabled users without Room writes', async () => {
  for (const user of [{ uid: 'existing', customClaims: { roomId: 'A', role: 'president' } }, { uid: 'existing', customClaims: { roomId: 'B', role: 'judge' } }, { uid: 'existing', disabled: true }]) {
    const admin = stubAdmin(user);
    await assert.rejects(provisionPresidentWithAdmin(provisionInput, admin), /CONFLICT|DISABLED/);
    assert.equal(admin.documents.size, 0);
    assert.deepEqual(admin.user, user);
  }
});
test('stub provisioning resumes interrupted claims without resetting Room or reassigning user', async () => {
  const admin = stubAdmin();
  admin.interruptClaims();
  await assert.rejects(provisionPresidentWithAdmin(provisionInput, admin), /SIMULATED/);
  assert.equal(admin.documents.get('_roomProvisioning/B').status, 'pending');
  assert.equal(admin.user.customClaims, undefined);
  const retry = await provisionPresidentWithAdmin(provisionInput, admin);
  assert.equal(retry.created, false);
  assert.equal(admin.creations, 1);
  assert.equal(admin.documents.get('_roomProvisioning/B').status, 'complete');
});
test('stub provisioning refuses unverified or unsafe existing Rooms', async () => {
  for (const partial of [true, false]) {
    const admin = stubAdmin();
    const initial = initialRoomDocuments();
    for (const [i,name] of ['control','meta','publicState'].entries()) if (!partial || i === 0) admin.documents.set('rooms/B/' + name + '/current', initial[i]);
    await assert.rejects(provisionPresidentWithAdmin(provisionInput, admin), /UNSAFE_PARTIAL|OWNER_UNVERIFIED/);
    assert.equal(admin.documents.has('_roomProvisioning/B'), false);
  }
});
