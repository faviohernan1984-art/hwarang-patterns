import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createLocalDemoAuthorization, authorizeLocalDemo } from './localDemoAuthorization.js';
import { issueLocalDemoToken, demoIdentities } from './localDemoIdentities.js';
import { createLocalDemo } from './createLocalDemo.js';
import { devPresidentPlugin } from './devPresidentPlugin.js';

const env = { PATTERNS_DEV_PRESIDENT: 'true', GCLOUD_PROJECT: 'demo-patterns-gups', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' };
const room = 'demo-patterns-' + 'a'.repeat(24);
const other = 'demo-patterns-' + 'b'.repeat(24);
const keys = ['president', 'public', 'judge/1', 'judge/2', 'judge/3'];
function database() {
  const documents = new Map(); let writes = 0;
  const snapshot = path => ({ exists: documents.has(path), data: () => structuredClone(documents.get(path)) });
  const db = {
    projectId: env.GCLOUD_PROJECT,
    doc: path => ({ path, get: async () => snapshot(path) }),
    runTransaction: async callback => callback({
      get: async ref => snapshot(ref.path),
      create(ref, data) { assert.equal(documents.has(ref.path), false); documents.set(ref.path, structuredClone(data)); writes++; },
    }),
  };
  return { db, documents, get writes() { return writes; } };
}
test('independent random credentials, hash-only storage, fail-closed cross-role and cross-room checks', async () => {
  const f = database();
  const credentials = await createLocalDemoAuthorization(f.db, room, keys, { env });
  assert.equal(new Set(Object.values(credentials)).size, keys.length);
  for (const [key, secret] of Object.entries(credentials)) {
    assert.match(secret, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify([...f.documents]).includes(secret), false);
    await authorizeLocalDemo(f.db, room, key, secret, { env });
    for (const target of keys.filter(value => value !== key)) await assert.rejects(authorizeLocalDemo(f.db, room, target, secret, { env }), /AUTHORIZATION_DENIED/);
    await assert.rejects(authorizeLocalDemo(f.db, other, key, secret, { env }), /AUTHORIZATION_DENIED/);
  }
  for (const secret of [undefined, '', 'invalid']) await assert.rejects(authorizeLocalDemo(f.db, room, 'president', secret, { env }), /AUTHORIZATION_DENIED/);
  await assert.rejects(createLocalDemoAuthorization(f.db, room, keys, { env }), /AUTHORIZATION_DENIED/);
  f.documents.get('localDemoAuthorization/' + room).roles.president.active = false;
  await assert.rejects(authorizeLocalDemo(f.db, room, 'president', credentials.president, { env }), /AUTHORIZATION_DENIED/);
  assert.equal(f.writes, 1);
});
test('token issuer refuses unauthorized requests before reading identities or issuing Firebase tokens', async () => {
  const f = database(); const credentials = await createLocalDemoAuthorization(f.db, room, keys, { env });
  let tokens = 0;
  const admin = { db: f.db, auth: { createCustomToken() { tokens++; throw new Error('must not issue'); } } };
  for (const credential of [undefined, credentials.public, credentials['judge/1']]) await assert.rejects(issueLocalDemoToken(admin, room, 'president', { env, credential }), /AUTHORIZATION_DENIED/);
  assert.equal(tokens, 0);
});
test('creation delivers secrets once; recovery requires President and preserves existing data', async () => {
  const f = database(); let allocations = 0; let provisions = 0;
  f.documents.set('existing-evaluations', { credits: 17, evaluationId: 9 });
  const options = { env, dispose: false, adminFactory: () => ({ db: f.db, app: { options: { projectId: env.GCLOUD_PROJECT } } }),
    allocate: async (_, requested) => { allocations++; return { roomId: room, demoSessionId: 'same-session', created: requested == null }; },
    provision: async () => { provisions++; return { identities: demoIdentities(room, 3) }; },
  };
  const first = await createLocalDemo(null, options);
  const before = structuredClone([...f.documents]);
  for (const credential of [undefined, first.credentials.public, first.credentials['judge/1']]) await assert.rejects(createLocalDemo(room, { ...options, credential }), /AUTHORIZATION_DENIED/);
  assert.equal(allocations, 1); assert.equal(provisions, 1);
  const recovered = await createLocalDemo(room, { ...options, credential: first.credentials.president });
  assert.equal(recovered.credentials, undefined); assert.equal(recovered.demoSessionId, first.demoSessionId);
  assert.deepEqual([...f.documents], before);
});
test('both HTTP issuers and recovery enforce Bearer credentials and never put secrets in paths', async () => {
  const f = database(); const credentials = await createLocalDemoAuthorization(f.db, room, keys, { env });
  let handler; let tokens = 0; let recoveries = 0;
  devPresidentPlugin(env, {
    demoTokenFn: async (id, key, credential) => { await authorizeLocalDemo(f.db, id, key, credential, { env }); tokens++; return 'test-token'; },
    createDemoFn: async (id, { credential }) => { await authorizeLocalDemo(f.db, id, 'president', credential, { env }); recoveries++; return { roomId: id, created: false, identities: demoIdentities(id, 3) }; },
  }).configureServer({ middlewares: { use(fn) { handler = fn; } } });
  async function request(url, credential, body = '{}') {
    const req = Readable.from([body]);
    Object.assign(req, { url, method: 'POST', socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost:5173', origin: 'http://localhost:5173', 'content-type': 'application/json', ...(credential ? { authorization: 'Bearer ' + credential } : {}) } });
    const result = { status: 200, body: '', headers: {} };
    await handler(req, { set statusCode(value) { result.status = value; }, setHeader(key, value) { result.headers[key] = value; }, end(value) { result.body = value; } }, () => assert.fail('unexpected passthrough'));
    return result;
  }
  for (const key of keys) {
    for (const path of ['/api/demo-access/' + room + '/' + key, '/__dev/demo/' + room + '/' + key + '/token']) {
      for (const credential of [undefined, ...keys.filter(value => value !== key).map(value => credentials[value])]) assert.equal((await request(path, credential)).status, 403);
      const allowed = await request(path, credentials[key]);
      assert.equal(allowed.status, 200); assert.equal(allowed.headers['Cache-Control'], 'no-store');
      assert.equal(allowed.body.includes(credentials[key]), false);
    }
  }
  for (const credential of [undefined, credentials.public, credentials['judge/1']]) assert.equal((await request('/api/create-demo', credential, JSON.stringify({ roomId: room }))).status, 403);
  assert.equal((await request('/api/create-demo', credentials.president, JSON.stringify({ roomId: room }))).status, 200);
  assert.equal(tokens, keys.length * 2); assert.equal(recoveries, 1);
  assert.equal((await request('/api/demo-access/' + room + '/president?credential=' + credentials.president)).status, 403);
});
