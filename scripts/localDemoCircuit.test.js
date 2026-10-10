import test from 'node:test';
import { randomBytes } from 'node:crypto';
const credential = randomBytes(32).toString('hex');
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { parseAppRoute, roomAccessLinks, roomBasePath } from '../src/roomRoutes.js';
import { authenticateLocalDemoRoute, requestLocalDemo, demoCredentialStorageKey } from '../src/localDemoAccess.js';
import { demoIdentities } from './localDemoIdentities.js';
import { devPresidentPlugin } from './devPresidentPlugin.js';

const id = 'demo-patterns-' + 'a'.repeat(24);
const other = 'demo-patterns-' + 'b'.repeat(24);
const sessionId = 'patterns-session-' + 'a'.repeat(24);
const source = Object.fromEntries(readFileSync(new URL('../.env.example', import.meta.url), 'utf8').split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => line.split('=')));
const env = { PATTERNS_DEV_PRESIDENT: 'true', GCLOUD_PROJECT: 'demo-patterns-gups', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' };
const memoryStorage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; };

function authFixture(claims) {
  const calls = []; let signOuts = 0;
  const auth = { app: { options: { projectId: 'demo-patterns-gups' } }, emulatorConfig: { host: '127.0.0.1', port: 9099 }, currentUser: null };
  const sdk = {
    browserSessionPersistence: 'session', setPersistence: async (_, value) => assert.equal(value, 'session'),
    signInWithCustomToken: async (_, value) => { assert.equal(value, 'verified-token'); auth.currentUser = { uid: 'demo-user' }; return { user: auth.currentUser }; },
    getIdTokenResult: async () => ({ claims }), signOut: async () => { signOuts += 1; auth.currentUser = null; },
  };
  const storage = memoryStorage();
  for (const { key } of roomAccessLinks(id, 5)) storage.setItem(demoCredentialStorageKey(id, key), credential);
  const options = { source, hostname: '127.0.0.1', sdk, storage, fetchImpl: async (url, init) => { calls.push([url, init]); return { ok: true, json: async () => ({ token: 'verified-token' }) }; } };
  return { auth, options, calls, get signOuts() { return signOuts; } };
}

test('clean role routes and room home preserve legacy aliases and expose exactly three or five judge links', () => {
  for (const count of [3, 5]) {
    const links = roomAccessLinks(id, count);
    assert.equal(links.length, count + 2);
    for (const link of links) {
      assert.equal(link.path.includes('__dev'), false);
      const route = parseAppRoute(link.path);
      assert.deepEqual(route, { valid: true, roomId: id, role: link.role, judgeId: link.judgeId });
      assert.deepEqual(parseAppRoute('/rooms/' + id + '/' + link.key), route);
    }
  }
  assert.deepEqual(parseAppRoute(roomBasePath(id)), { valid: true, roomId: id, role: 'home', judgeId: null });
  assert.equal(roomBasePath('A'), '/rooms/A');
  for (const path of ['/judge/' + id + '/6', '/judge/' + id + '/01', '/president/invalid.room', '/public/' + id + '/extra']) assert.equal(parseAppRoute(path).valid, false);
});

test('clean entries authenticate President, Public and configured judges with numeric claims', async () => {
  for (const link of roomAccessLinks(id, 5)) {
    const claims = { roomId: id, role: link.role, ...(link.role === 'judge' ? { judgeId: link.judgeId } : {}) };
    const f = authFixture(claims);
    await authenticateLocalDemoRoute(f.auth, parseAppRoute(link.path), f.options);
    assert.equal(f.calls[0][0], '/api/demo-access/' + id + '/' + link.key);
    assert.equal(f.calls[0][1].method, 'POST');
    assert.equal(f.calls[0][1].headers.Authorization, 'Bearer ' + credential);
    assert.equal(f.signOuts, 0);
  }
});

test('claims for another room, role or judge and string judge IDs are rejected and signed out', async () => {
  for (const claims of [{ roomId: other, role: 'judge', judgeId: 2 }, { roomId: id, role: 'president' }, { roomId: id, role: 'judge', judgeId: 3 }, { roomId: id, role: 'judge', judgeId: '2' }]) {
    const f = authFixture(claims);
    await assert.rejects(authenticateLocalDemoRoute(f.auth, parseAppRoute('/judge/' + id + '/2'), f.options), /CLAIMS_MISMATCH/);
    assert.equal(f.signOuts, 1); assert.equal(f.auth.currentUser, null);
  }
});

test('an already authorized identity is preserved without requesting another token or changing role at room home', async () => {
  const f = authFixture({ roomId: id, role: 'judge', judgeId: 2 });
  f.auth.currentUser = { uid: 'existing-judge' };
  await authenticateLocalDemoRoute(f.auth, parseAppRoute('/judge/' + id + '/2'), f.options);
  await authenticateLocalDemoRoute(f.auth, parseAppRoute('/' + id), f.options);
  assert.equal(f.calls.length, 0); assert.equal(f.auth.currentUser.uid, 'existing-judge');
});

test('browser access rejects LAN, wrong Auth project or port and cloud selectors before requesting tokens', async () => {
  for (const mutate of [
    f => { f.options.hostname = '192.168.1.2'; },
    f => { f.auth.app.options.projectId = 'production'; },
    f => { f.auth.emulatorConfig.port = 9000; },
    f => { f.auth.emulatorConfig = null; },
    f => { f.options.source = { ...source, VITE_APP_ENV: 'production' }; },
  ]) {
    const f = authFixture({ roomId: id, role: 'president' }); mutate(f);
    await assert.rejects(authenticateLocalDemoRoute(f.auth, parseAppRoute('/president/' + id), f.options));
    assert.equal(f.calls.length, 0);
  }
});

test('client create-demo persists the server ID and explicitly reuses it without replacing its session', async () => {
  const storage = memoryStorage(); const bodies = [];
  const options = { source, hostname: 'localhost', storage, fetchImpl: async (url, init) => {
    assert.equal(url, '/api/create-demo'); bodies.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ ok: true, roomId: id, demoSessionId: sessionId, created: bodies.length === 1,
      ...(bodies.length === 1 ? { credentials: Object.fromEntries(roomAccessLinks(id, 3).map(({ key }) => [key, credential])) } : {}) }) };
  } };
  assert.equal(await requestLocalDemo(options), '/' + id);
  assert.equal(await requestLocalDemo(options), '/' + id);
  assert.deepEqual(bodies, [{ roomId: null }, { roomId: id }]);
  const failed = { ...options, fetchImpl: async () => ({ ok: false, json: async () => ({ ok: false, code: 'DEMO_UNAVAILABLE' }) }) };
  await assert.rejects(requestLocalDemo(failed));
  assert.equal(storage.getItem('patterns_demo_room_id'), id);
});

test('partial server provisioning retains its room ID for recovery, without allocating a replacement on retry', async () => {
  const storage = memoryStorage();
  await assert.rejects(requestLocalDemo({ source, hostname: 'localhost', storage, fetchImpl: async () => ({ ok: false, json: async () => ({ ok: false, roomId: id, code: 'DEMO_UNAVAILABLE' }) }) }));
  assert.equal(storage.getItem('patterns_demo_room_id'), id);
});

function middleware(dependencies) {
  let handler;
  devPresidentPlugin(env, dependencies).configureServer({ middlewares: { use(value) { handler = value; } } });
  return async (url, { method = 'POST', body = '{}', host = 'localhost:5173', origin = 'http://localhost:5173', remote = '127.0.0.1' } = {}) => {
    const req = Readable.from([body]); Object.assign(req, { url, method, socket: { remoteAddress: remote }, headers: { host, origin, 'content-type': 'application/json', authorization: 'Bearer ' + credential } });
    const result = { statusCode: 200, headers: {}, body: null };
    await handler(req, { set statusCode(value) { result.statusCode = value; }, setHeader(key, value) { result.headers[key] = value; }, end(value) { result.body = JSON.parse(value); } }, () => { throw new Error('Unexpected passthrough'); });
    return result;
  };
}

test('local API reuses the existing allocator and returns only clean access paths for three or five judges', async () => {
  for (const count of [3, 5]) {
    const calls = [];
    const request = middleware({ createDemoFn: async (requested, options) => {
      calls.push([requested, options]); return { roomId: id, demoSessionId: sessionId, created: requested === null, identities: demoIdentities(id, count) };
    } });
    const first = await request('/api/create-demo');
    assert.equal(first.statusCode, 201); assert.equal(first.body.access.length, count + 2);
    assert.equal(first.body.path, '/' + id);
    assert.equal(JSON.stringify(first.body).includes('__dev'), false);
    const second = await request('/api/create-demo', { body: JSON.stringify({ roomId: id }) });
    assert.equal(second.statusCode, 200); assert.equal(second.body.demoSessionId, sessionId);
    assert.deepEqual(calls, [[null, { dispose: false, credential }], [id, { dispose: false, credential }]]);
    assert.equal(first.headers['Cache-Control'], 'no-store');
  }
});

test('local API rejects foreign origin, LAN, malformed bodies and unsupported methods before allocation', async () => {
  let calls = 0;
  const request = middleware({ createDemoFn: async () => { calls += 1; throw new Error('must not allocate'); } });
  for (const options of [{ origin: 'http://foreign.invalid' }, { remote: '192.168.1.2' }, { method: 'GET' }, { body: 'invalid' }, { body: '[]' }, { body: JSON.stringify({ roomId: 'A' }) }, { body: JSON.stringify({ roomId: id, role: 'admin' }) }, { body: 'x'.repeat(1025) }]) {
    assert.ok((await request('/api/create-demo', options)).statusCode >= 400);
  }
  assert.equal(calls, 0);
});

test('local API issues only provisioned role tokens and refuses malformed judge paths', async () => {
  const calls = [];
  const request = middleware({ demoTokenFn: async (roomId, key) => { calls.push([roomId, key]); return 'verified-token'; } });
  const result = await request('/api/demo-access/' + id + '/judge/5');
  assert.equal(result.statusCode, 200); assert.equal(result.body.token, 'verified-token');
  assert.equal((await request('/api/demo-access/' + id + '/judge/6')).statusCode, 400);
  assert.equal((await request('/api/demo-access/' + id + '/president', { origin: 'http://foreign.invalid' })).statusCode, 403);
  assert.deepEqual(calls, [[id, 'judge/5']]);
});
