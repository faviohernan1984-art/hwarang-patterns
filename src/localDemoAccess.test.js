import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { authenticateLocalDemoRoute, requestLocalDemo, demoCredentialStorageKey, storedDemoCredential } from './localDemoAccess.js';
import { parseAppRoute, roomAccessLinks } from './roomRoutes.js';

const room = 'demo-patterns-' + 'a'.repeat(24);
const other = 'demo-patterns-' + 'b'.repeat(24);
const source = Object.fromEntries(readFileSync(new URL('../.env.example', import.meta.url), 'utf8').split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => line.split('=')));
function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
function fixture(role = 'president', judgeId) {
  const store = storage(); const calls = []; let signIns = 0; let signOuts = 0;
  const auth = { currentUser: null, app: { options: { projectId: 'demo-patterns-gups' } }, emulatorConfig: { host: '127.0.0.1', port: 9099 } };
  const sdk = { browserSessionPersistence: 'session', setPersistence: async (_, value) => assert.equal(value, 'session'),
    signInWithCustomToken: async () => { signIns++; auth.currentUser = { uid: 'test' }; return { user: auth.currentUser }; },
    getIdTokenResult: async () => ({ claims: { roomId: room, role, ...(judgeId ? { judgeId } : {}) } }),
    signOut: async () => { signOuts++; auth.currentUser = null; },
  };
  const options = { source, hostname: 'localhost', storage: store, sdk,
    fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ token: 'test-token' }) }; },
  };
  return { auth, options, store, calls, get signIns() { return signIns; }, get signOuts() { return signOuts; } };
}
test('knowing a route alone never requests credentials or signs in, including room home', async () => {
  for (const path of ['/' + room, ...roomAccessLinks(room, 5).map(link => link.path)]) {
    const f = fixture();
    await assert.rejects(authenticateLocalDemoRoute(f.auth, parseAppRoute(path), f.options), /CREDENTIAL_REQUIRED/);
    assert.equal(f.calls.length, 0); assert.equal(f.signIns, 0);
  }
});
test('each role sends its explicit credential only in Bearer and restores it from session storage', async () => {
  for (const link of roomAccessLinks(room, 5)) {
    const f = fixture(link.role, link.judgeId); const credential = randomBytes(32).toString('hex');
    await authenticateLocalDemoRoute(f.auth, parseAppRoute(link.path), { ...f.options, credential });
    assert.equal(storedDemoCredential(f.store, room, link.key), credential);
    assert.equal(storedDemoCredential(f.store, other, link.key), null);
    assert.equal(f.calls[0].init.headers.Authorization, 'Bearer ' + credential);
    assert.equal(JSON.stringify({ url: f.calls[0].url, body: f.calls[0].init.body }).includes(credential), false);
    f.auth.currentUser = null;
    await authenticateLocalDemoRoute(f.auth, parseAppRoute(link.path), f.options);
    assert.equal(f.signIns, 2);
  }
});
test('Public and Judge stored credentials cannot automatically switch to President or another Judge', async () => {
  for (const role of ['public', 'judge']) {
    const f = fixture(role, role === 'judge' ? 1 : undefined);
    f.auth.currentUser = { uid: 'existing' };
    f.store.setItem(demoCredentialStorageKey(room, role === 'judge' ? 'judge/1' : role), randomBytes(32).toString('hex'));
    for (const path of ['/president/' + room, '/judge/' + room + '/2']) await assert.rejects(authenticateLocalDemoRoute(f.auth, parseAppRoute(path), f.options), /CREDENTIAL_REQUIRED/);
    assert.equal(f.calls.length, 0); assert.equal(f.signIns, 0);
  }
});
test('server denial removes only the attempted role credential and never signs in', async () => {
  const f = fixture(); const credential = randomBytes(32).toString('hex'); const publicSecret = randomBytes(32).toString('hex');
  f.store.setItem(demoCredentialStorageKey(room, 'president'), credential);
  f.store.setItem(demoCredentialStorageKey(room, 'public'), publicSecret);
  f.options.fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({ code: 'DEMO_AUTHORIZATION_DENIED' }) });
  await assert.rejects(authenticateLocalDemoRoute(f.auth, parseAppRoute('/president/' + room), f.options), /AUTHORIZATION_DENIED/);
  assert.equal(storedDemoCredential(f.store, room, 'president'), null);
  assert.equal(storedDemoCredential(f.store, room, 'public'), publicSecret); assert.equal(f.signIns, 0);
});
test('manually submitting Public or Judge credentials for President is denied without replacing the identity', async () => {
  for (const key of ['public', 'judge/1']) {
    const f = fixture(key === 'public' ? 'public' : 'judge', key === 'public' ? undefined : 1);
    const secret = randomBytes(32).toString('hex');
    f.auth.currentUser = { uid: 'existing-low-privilege' };
    f.store.setItem(demoCredentialStorageKey(room, key), secret);
    f.options.fetchImpl = async (_, init) => {
      assert.equal(init.headers.Authorization, 'Bearer ' + secret);
      return { ok: false, status: 403, json: async () => ({ code: 'DEMO_AUTHORIZATION_DENIED' }) };
    };
    await assert.rejects(authenticateLocalDemoRoute(f.auth, parseAppRoute('/president/' + room), { ...f.options, credential: secret }), /AUTHORIZATION_DENIED/);
    assert.equal(f.signIns, 0); assert.equal(f.auth.currentUser.uid, 'existing-low-privilege');
    assert.equal(storedDemoCredential(f.store, room, key), secret);
    assert.equal(storedDemoCredential(f.store, room, 'president'), null);
  }
});
test('wrong returned claims sign out and do not persist the submitted credential', async () => {
  const f = fixture('public');
  await assert.rejects(authenticateLocalDemoRoute(f.auth, parseAppRoute('/president/' + room), { ...f.options, credential: randomBytes(32).toString('hex') }), /CLAIMS_MISMATCH/);
  assert.equal(f.signOuts, 1); assert.equal(storedDemoCredential(f.store, room, 'president'), null);
});
test('creation captures independent role credentials; recovery sends only President and preserves them', async () => {
  const store = storage(); const credentials = Object.fromEntries(roomAccessLinks(room, 3).map(({ key }) => [key, randomBytes(32).toString('hex')]));
  const calls = [];
  const options = { source, hostname: 'localhost', storage: store, fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({ ok: true, roomId: room, demoSessionId: 'same-session', created: calls.length === 1, ...(calls.length === 1 ? { credentials } : {}) }) };
  } };
  assert.equal(await requestLocalDemo(options), '/' + room);
  assert.equal(await requestLocalDemo(options), '/' + room);
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(calls[1].init.headers.Authorization, 'Bearer ' + credentials.president);
  assert.deepEqual(JSON.parse(calls[1].init.body), { roomId: room });
  for (const [key, secret] of Object.entries(credentials)) assert.equal(storedDemoCredential(store, room, key), secret);
  store.removeItem(demoCredentialStorageKey(room, 'president'));
  await assert.rejects(requestLocalDemo(options), /CREDENTIAL_REQUIRED/);
  assert.equal(calls.length, 2);
});
test('invalid initial credentials are rejected before any credential is persisted', async () => {
  const store = storage();
  await assert.rejects(requestLocalDemo({ source, hostname: 'localhost', storage: store, fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, roomId: room, demoSessionId: 'same-session', created: true, credentials: { president: randomBytes(32).toString('hex'), public: 'bad' } }) }) }), /INVALID_DEMO_RESPONSE/);
  assert.equal(storedDemoCredential(store, room, 'president'), null);
});
