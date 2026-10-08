import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PassThrough, Writable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { getApps } from 'firebase-admin/app';
import { PRODUCTION_PROJECT_ID, validateProductionEnvironment } from './productionAdmin.js';
import { parseProductionPasswordArgs, validatePassword, updateProvisionedPresidentPassword, updateProductionPresidentPassword, hiddenPasswordPrompt } from './productionPresidentPassword.js';

const email = 'president@patterns.test';
const password = 'synthetic-test-password';
const env = { PATTERNS_ADMIN_ENV: 'production', GOOGLE_APPLICATION_CREDENTIALS: join(tmpdir(), 'external-test-account.json') };
const args = ['--apply', '--project', PRODUCTION_PROJECT_ID, '--email', email];
function stub({ user = {}, current = {}, missing = -1, journal = {}, assignment = {} } = {}) {
  const original = { uid: 'stub-uid', email, customClaims: { roomId: 'A', role: 'president' }, ...user };
  const updates = [];
  const reads = [];
  return {
    projectId: PRODUCTION_PROJECT_ID, updates, reads,
    auth: {
      async getUserByEmail() { return structuredClone(original); },
      async getUser() { return { ...structuredClone(original), ...current }; },
      async updateUser(uid, data) { updates.push({ uid, data }); },
    },
    db: {
      doc(path) { reads.push(path); return { path }; },
      async getAll(...refs) {
        assert.equal(refs.length, 5);
        return [{ uid: 'stub-uid', version: 1, status: 'complete', ...journal }, { roomId: 'A', role: 'president', ...assignment }, {}, {}, {}]
          .map((data, index) => ({ exists: index !== missing, data: () => data }));
      },
    },
  };
}
test('CLI requires apply, exact project and email; rejects password arguments', () => {
  assert.deepEqual(parseProductionPasswordArgs(args), { apply: true, projectId: PRODUCTION_PROJECT_ID, email });
  for (const value of [[], args.slice(1), [...args, '--password', password], [...args, '--room', 'A'], [...args.slice(0,4), '../bad']]) assert.throws(() => parseProductionPasswordArgs(value));
});
test('production barriers reject wrong project, intent, credentials and Emulator variables', () => {
  assert.equal(validateProductionEnvironment(PRODUCTION_PROJECT_ID, true, env).projectId, PRODUCTION_PROJECT_ID);
  assert.throws(() => validateProductionEnvironment('demo-patterns-gups', true, env));
  assert.throws(() => validateProductionEnvironment(PRODUCTION_PROJECT_ID, false, env));
  assert.throws(() => validateProductionEnvironment(PRODUCTION_PROJECT_ID, true, { ...env, PATTERNS_ADMIN_ENV: 'development' }));
  assert.throws(() => validateProductionEnvironment(PRODUCTION_PROJECT_ID, true, { ...env, GOOGLE_APPLICATION_CREDENTIALS: undefined }));
  for (const key of ['FIREBASE_AUTH_EMULATOR_HOST','FIRESTORE_EMULATOR_HOST']) {
    for (const value of ['', '127.0.0.1:9099']) assert.throws(() => validateProductionEnvironment(PRODUCTION_PROJECT_ID, true, { ...env, [key]: value }));
  }
});
test('unsafe real entry rejects before any Admin initialization', async () => {
  const before = getApps().length;
  await assert.rejects(updateProductionPresidentPassword({ projectId: 'wrong-project', apply: true, email }, password), /NOT_APPROVED/);
  await assert.rejects(updateProductionPresidentPassword({ projectId: PRODUCTION_PROJECT_ID, apply: false, email }, password), /INTENT/);
  assert.equal(getApps().length, before);
});
test('password length and control characters are validated', () => {
  validatePassword(password);
  for (const value of [undefined, '', 'short', 'x'.repeat(129), password + '\n', password + '\0', password + '\t']) assert.throws(() => validatePassword(value));
});
test('only password changes; Room and administrative records are read without writes', async () => {
  const admin = stub();
  const result = await updateProvisionedPresidentPassword(email, password, admin);
  assert.deepEqual(result, { projectId: PRODUCTION_PROJECT_ID, roomId: 'A', passwordUpdated: true });
  assert.deepEqual(admin.updates, [{ uid: 'stub-uid', data: { password } }]);
  assert.ok(!JSON.stringify(result).includes(password));
  assert.ok(admin.reads.includes('_roomProvisioning/A'));
  for (const collection of ['control','meta','publicState']) assert.ok(admin.reads.includes('rooms/A/' + collection + '/current'));
});
test('missing user, disabled account, incompatible claims and wrong project never update password', async () => {
  const missingUser = stub();
  missingUser.auth.getUserByEmail = async () => { throw Object.assign(Error(), { code: 'auth/user-not-found' }); };
  await assert.rejects(updateProvisionedPresidentPassword(email, password, missingUser));
  assert.equal(missingUser.updates.length, 0);
  for (const user of [{ disabled: true }, { email: 'other@patterns.test' }, { customClaims: {} }, { customClaims: { roomId: 'A', role: 'judge' } }, { customClaims: { role: 'president' } }, { customClaims: { roomId: '../A', role: 'president' } }, { customClaims: { roomId: 'A', role: 'president', judgeId: 1 } }]) {
    const admin = stub({ user });
    await assert.rejects(updateProvisionedPresidentPassword(email, password, admin));
    assert.equal(admin.updates.length, 0);
  }
  const admin = stub(); admin.projectId = 'wrong-project';
  await assert.rejects(updateProvisionedPresidentPassword(email, password, admin), /NOT_APPROVED/);
});
test('incomplete Room, pending provisioning and ownership conflicts never update password', async () => {
  for (const options of [ ...[0,1,2,3,4].map(missing => ({ missing })), { journal: { status: 'pending' } }, { journal: { uid: 'other' } }, { journal: { version: 2 } }, { assignment: { roomId: 'B' } }, { assignment: { role: 'judge' } }]) {
    const admin = stub(options);
    await assert.rejects(updateProvisionedPresidentPassword(email, password, admin));
    assert.equal(admin.updates.length, 0);
  }
});
test('assignment changed during checks rejects before update', async () => {
  const admin = stub({ current: { customClaims: { roomId: 'B', role: 'president' } } });
  await assert.rejects(updateProvisionedPresidentPassword(email, password, admin), /CHANGED/);
  assert.equal(admin.updates.length, 0);
});
test('hidden interactive input never echoes the password and rejects non-TTY/EOF', async () => {
  await assert.rejects(hiddenPasswordPrompt('', { isTTY: false }, { isTTY: true }), /TERMINAL/);
  const input = new PassThrough(); input.isTTY = true; input.setRawMode = () => {};
  let displayed = '';
  const output = new Writable({ write(chunk, _encoding, done) { displayed += chunk.toString(); done(); } }); output.isTTY = true;
  const prompt = hiddenPasswordPrompt('Password: ', input, output);
  input.write(password + '\r');
  assert.equal(await prompt, password);
  assert.equal(displayed.includes(password), false);
  assert.equal(displayed, 'Password: \n');
  const closedInput = new PassThrough(); closedInput.isTTY = true; closedInput.setRawMode = () => {};
  const cancelled = hiddenPasswordPrompt('', closedInput, output); closedInput.end();
  await assert.rejects(cancelled, /CANCELLED/);
});
test('local password command remains unchanged and uses only localAdmin', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['president:password'], 'node scripts/initializePresidentPassword.js');
  const local = readFileSync(new URL('./initializePresidentPassword.js', import.meta.url), 'utf8');
  assert.match(local, /localAdmin\(\)/);
  assert.doesNotMatch(local, /productionAdmin/);
});
