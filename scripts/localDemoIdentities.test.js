import test from 'node:test';
import { randomBytes, createHash } from 'node:crypto';
const credential = randomBytes(32).toString('hex');
const credentialHash = createHash('sha256').update(credential).digest('hex');
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { initialRoomDocuments } from './roomDefaults.js';
import { demoIdentities, provisionLocalDemoIdentities, readLocalDemoAccess, issueLocalDemoToken } from './localDemoIdentities.js';
import { devPresidentPlugin } from './devPresidentPlugin.js';
import { identityFromClaims, authorizeRoomRoute } from '../src/roomAccess.js';
import { parseAppRoute } from '../src/roomRoutes.js';

const env = { PATTERNS_DEV_PRESIDENT: 'true', GCLOUD_PROJECT: 'demo-patterns-gups', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' };
const room = digit => 'demo-patterns-' + digit.repeat(24);
const journalPath = id => 'localDemoIdentityProvisioning/' + id;
const controlPath = id => 'rooms/' + id + '/control/current';

function fixture() {
  const documents = new Map([['rooms/A/meta/current', { demoSessionId: 'keep-room-A' }]]);
  const users = new Map([['dev-president-room-A', { uid: 'dev-president-room-A', customClaims: { roomId: 'A', role: 'president' } }]]);
  let queue = Promise.resolve();
  let dbWrites = 0;
  let authWrites = 0;
  let reads = 0;
  let tokens = 0;
  let failCreateUid, failClaimUid, failClaimAfter = false, failComplete = false;
  const db = {
    projectId: env.GCLOUD_PROJECT,
    doc: path => ({ path, get: async () => ({ exists: documents.has(path), data: () => structuredClone(documents.get(path)) }) }),
    runTransaction(callback) {
      const operation = queue.then(async () => {
        const pending = [];
        const result = await callback({
          async getAll(...refs) {
            assert.equal(pending.length, 0); reads += refs.length;
            return refs.map(ref => ({ exists: documents.has(ref.path), data: () => structuredClone(documents.get(ref.path)) }));
          },
          set(ref, data) { pending.push([ref.path, structuredClone(data)]); },
        });
        if (failComplete && pending.some(([, data]) => data.status === 'complete')) { failComplete = false; throw new Error('COMPLETE_WRITE_FAILED'); }
        for (const [path, data] of pending) { documents.set(path, data); dbWrites += 1; }
        return result;
      });
      queue = operation.catch(() => {});
      return operation;
    },
  };
  const auth = {
    app: { options: { projectId: env.GCLOUD_PROJECT } },
    async getUser(uid) {
      reads += 1;
      if (!users.has(uid)) throw Object.assign(new Error('missing'), { code: 'auth/user-not-found' });
      return structuredClone(users.get(uid));
    },
    async createUser(input) {
      if (users.has(input.uid)) throw Object.assign(new Error('exists'), { code: 'auth/uid-already-exists' });
      const user = { ...input, disabled: false, providerData: [] };
      users.set(input.uid, user); authWrites += 1;
      if (failCreateUid === input.uid) { failCreateUid = null; throw new Error('CREATE_RESPONSE_LOST'); }
      return structuredClone(user);
    },
    async setCustomUserClaims(uid, claims) {
      if (failClaimUid === uid && !failClaimAfter) { failClaimUid = null; throw new Error('CLAIM_WRITE_FAILED'); }
      users.get(uid).customClaims = structuredClone(claims); authWrites += 1;
      if (failClaimUid === uid) { failClaimUid = null; throw new Error('CLAIM_RESPONSE_LOST'); }
    },
    async createCustomToken(uid) { tokens += 1; return JSON.stringify({ uid, claims: users.get(uid).customClaims }); },
  };
  return {
    admin: { db, auth }, documents, users,
    get dbWrites() { return dbWrites; }, get authWrites() { return authWrites; }, get reads() { return reads; }, get tokens() { return tokens; },
    failCreate(uid) { failCreateUid = uid; }, failClaim(uid, after = false) { failClaimUid = uid; failClaimAfter = after; },
    failComplete() { failComplete = true; },
    seed(roomId, judges = 3) {
      documents.set('localDemoAuthorization/' + roomId, { version: 1, roles: Object.fromEntries(Object.keys(demoIdentities(roomId, 5)).map(key => [key, { hash: credentialHash, active: true }])) });
      const [control, meta, publicState] = initialRoomDocuments();
      control.config.patternJudges = judges;
      const demoSessionId = 'patterns-session-' + roomId.slice('demo-patterns-'.length);
      documents.set(controlPath(roomId), control);
      documents.set('rooms/' + roomId + '/meta/current', { ...meta, demoSessionId, demoProvisioningVersion: 1 });
      documents.set('rooms/' + roomId + '/publicState/current', publicState);
      documents.set('rooms/' + roomId + '/demoSessions/' + demoSessionId, { sessionId: demoSessionId, consumedEvaluationIds: [1, 7], confirmedCount: 2 });
    },
  };
}
const provision = (f, id) => provisionLocalDemoIdentities(f.admin, id, { env });
const access = (f, id, key) => readLocalDemoAccess(f.admin, id, key, { env });
const token = (f, id, key) => issueLocalDemoToken(f.admin, id, key, { env, credential });

function roomData(f) { return new Map([...f.documents].filter(([path]) => path.startsWith('rooms/'))); }

test('three or five configured judges, President and Public receive exact claims without credentials; Room A is preserved', async () => {
  for (const count of [3, 5]) {
    const f = fixture(); f.seed(room('a'), count);
    const before = structuredClone(roomData(f));
    const roomA = structuredClone(f.users.get('dev-president-room-A'));
    const result = await provision(f, room('a'));
    assert.equal(Object.keys(result.identities).length, count + 2);
    for (const [key, identity] of Object.entries(result.identities)) {
      const user = f.users.get(identity.uid);
      assert.deepEqual(user.customClaims, identity.claims);
      assert.equal(user.email, undefined); assert.equal(user.password, undefined);
      assert.notEqual(identity.uid, 'dev-president-room-A');
      if (key.startsWith('judge/')) assert.equal(typeof user.customClaims.judgeId, 'number');
      const appIdentity = identityFromClaims(user, user.customClaims);
      assert.equal(authorizeRoomRoute(appIdentity, parseAppRoute(identity.path)).allowed, true);
      assert.equal(authorizeRoomRoute(appIdentity, parseAppRoute('/rooms/A/' + key)).allowed, false);
    }
    assert.deepEqual(roomData(f), before);
    assert.deepEqual(f.users.get('dev-president-room-A'), roomA);
    assert.equal(f.documents.get(journalPath(room('a'))).status, 'complete');
  }
});

test('rooms and roles have separate UIDs; a token for one role cannot authorize another room or judge', async () => {
  const f = fixture(); f.seed(room('a')); f.seed(room('b'));
  const a = await provision(f, room('a')); const b = await provision(f, room('b'));
  const ids = [...Object.values(a.identities), ...Object.values(b.identities)].map(identity => identity.uid);
  assert.equal(new Set(ids).size, 10);
  const issued = JSON.parse(await token(f, room('a'), 'judge/1'));
  const identity = identityFromClaims({ uid: issued.uid }, issued.claims);
  assert.equal(authorizeRoomRoute(identity, parseAppRoute(b.identities['judge/1'].path)).reason, 'ROOM_FORBIDDEN');
  assert.equal(authorizeRoomRoute(identity, parseAppRoute(a.identities['judge/2'].path)).reason, 'JUDGE_FORBIDDEN');
  assert.equal(authorizeRoomRoute(identity, parseAppRoute(a.identities.president.path)).reason, 'ROLE_FORBIDDEN');
});

test('completed provisioning is idempotent and does not rewrite claims, room data, journal or credits', async () => {
  const f = fixture(); f.seed(room('a'));
  const first = await provision(f, room('a'));
  const before = structuredClone([f.documents, f.users]);
  const writes = [f.dbWrites, f.authWrites];
  assert.deepEqual(await provision(f, room('a')), first);
  assert.deepEqual([f.documents, f.users], before);
  assert.deepEqual([f.dbWrites, f.authWrites], writes);
});

test('concurrent provisioning converges on the same users without reassignments', async () => {
  const f = fixture(); f.seed(room('a'));
  const [a, b] = await Promise.all([provision(f, room('a')), provision(f, room('a'))]);
  assert.deepEqual(a, b);
  assert.equal(f.users.size, 6);
  assert.equal(f.documents.get(journalPath(room('a'))).status, 'complete');
});

test('lost Auth create response resumes the journal and recovers the unclaimed user', async () => {
  const f = fixture(); f.seed(room('a'));
  const identity = demoIdentities(room('a'), 3)['judge/2'];
  f.failCreate(identity.uid);
  await assert.rejects(provision(f, room('a')), /CREATE_RESPONSE_LOST/);
  assert.equal(f.documents.get(journalPath(room('a'))).status, 'pending');
  await assert.rejects(token(f, room('a'), 'president'), /NOT_READY/);
  const before = structuredClone(roomData(f));
  await provision(f, room('a'));
  assert.deepEqual(f.users.get(identity.uid).customClaims, identity.claims);
  assert.deepEqual(roomData(f), before);
  assert.equal(f.documents.get(journalPath(room('a'))).status, 'complete');
});

test('claim failures before or after persistence recover without replacing granted identities', async () => {
  for (const after of [false, true]) {
    const f = fixture(); f.seed(room('a'));
    const identities = demoIdentities(room('a'), 3);
    f.failClaim(identities['judge/1'].uid, after);
    await assert.rejects(provision(f, room('a')), /CLAIM_/);
    const presidentBefore = structuredClone(f.users.get(identities.president.uid));
    await assert.rejects(token(f, room('a'), 'president'), /NOT_READY/);
    await provision(f, room('a'));
    assert.deepEqual(f.users.get(identities.president.uid), presidentBefore);
    assert.equal(f.documents.get(journalPath(room('a'))).status, 'complete');
  }
});

test('failure to complete the Firestore journal blocks access until a successful retry', async () => {
  const f = fixture(); f.seed(room('a')); f.failComplete();
  await assert.rejects(provision(f, room('a')), /COMPLETE_WRITE_FAILED/);
  const before = structuredClone(f.users); const writes = f.authWrites;
  await assert.rejects(token(f, room('a'), 'public'), /NOT_READY/);
  await provision(f, room('a'));
  assert.deepEqual(f.users, before); assert.equal(f.authWrites, writes);
  assert.equal(JSON.parse(await token(f, room('a'), 'public')).claims.role, 'public');
});

test('incompatible, disabled or unrelated unclaimed existing identities fail preflight without grants', async () => {
  for (const override of [
    { customClaims: { roomId: 'A', role: 'judge', judgeId: 3 } },
    { customClaims: { roomId: room('a'), role: 'president' } },
    { customClaims: { roomId: room('a'), role: 'judge', judgeId: '3' } },
    { customClaims: { roomId: room('a'), role: 'judge', judgeId: 3, admin: true } },
    { disabled: true }, { customClaims: {}, displayName: 'Unrelated user' },
  ]) {
    const f = fixture(); f.seed(room('a'));
    const identity = demoIdentities(room('a'), 3)['judge/3'];
    f.users.set(identity.uid, { uid: identity.uid, displayName: identity.displayName, customClaims: identity.claims, ...override });
    const before = structuredClone([f.documents, f.users]);
    await assert.rejects(provision(f, room('a')), /IDENTITY_/);
    assert.deepEqual([f.documents, f.users], before);
    assert.equal(f.authWrites, 0); assert.equal(f.dbWrites, 0);
  }
});

test('pending journals do not authorize adopting a foreign unclaimed user; changed assignments deny tokens', async () => {
  const f = fixture(); f.seed(room('a'));
  const identities = demoIdentities(room('a'), 3);
  f.failCreate(identities.president.uid);
  await assert.rejects(provision(f, room('a')));
  f.users.get(identities.president.uid).displayName = 'Foreign user';
  await assert.rejects(provision(f, room('a')), /ASSIGNMENT_CONFLICT/);
  f.users.get(identities.president.uid).displayName = identities.president.displayName;
  await provision(f, room('a'));
  for (const override of [{ disabled: true }, { customClaims: { roomId: room('b'), role: 'president' } }]) {
    const previous = structuredClone(f.users.get(identities.president.uid));
    Object.assign(f.users.get(identities.president.uid), override);
    await assert.rejects(token(f, room('a'), 'president'), /IDENTITY_/);
    f.users.set(identities.president.uid, previous);
  }
  assert.equal(f.tokens, 0);
});

test('judge configuration changes require reprovisioning; inactive judge access is refused without deleting users', async () => {
  const f = fixture(); f.seed(room('a')); await provision(f, room('a'));
  f.documents.get(controlPath(room('a'))).config.patternJudges = 5;
  await assert.rejects(token(f, room('a'), 'president'), /NOT_READY/);
  await provision(f, room('a'));
  assert.equal(JSON.parse(await token(f, room('a'), 'judge/5')).claims.judgeId, 5);
  const users = structuredClone(f.users);
  f.documents.get(controlPath(room('a'))).config.patternJudges = 3;
  await provision(f, room('a'));
  await assert.rejects(token(f, room('a'), 'judge/4'), /UNSUPPORTED/);
  assert.deepEqual(f.users, users);
});

test('foreign journals, unknown rooms, Room A and unsupported keys cannot grant DEMO access', async () => {
  const f = fixture(); f.seed(room('a'));
  f.documents.set(journalPath(room('a')), { version: 1, demoSessionId: 'wrong', judgeCount: 3, status: 'complete' });
  await assert.rejects(provision(f, room('a')), /JOURNAL_CONFLICT/);
  for (const id of ['A', '../other', room('b')]) await assert.rejects(provision(f, id));
  f.documents.delete(journalPath(room('a')));
  await provision(f, room('a'));
  for (const key of ['judge/4', 'judge/0', 'judge/6', 'admin', '__proto__', 'president/token']) await assert.rejects(token(f, room('a'), key), /UNSUPPORTED|AUTHORIZATION_DENIED/);
  assert.equal(f.tokens, 0);
});

test('unsafe environments and wrong Admin projects are rejected before database or Auth access', async () => {
  const f = fixture();
  for (const override of [
    ...Object.keys(env).map(key => ({ [key]: undefined })),
    { GCLOUD_PROJECT: 'production' }, { GOOGLE_APPLICATION_CREDENTIALS: 'key.json' },
    { FIREBASE_CONFIG: '{}' }, { FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' },
    { FIREBASE_AUTH_EMULATOR_HOST: '192.168.1.1:9099' },
  ]) {
    const options = { env: { ...env, ...override } };
    await assert.rejects(provisionLocalDemoIdentities(f.admin, room('a'), options));
    await assert.rejects(issueLocalDemoToken(f.admin, room('a'), 'president', options));
  }
  f.admin.auth.app.options.projectId = 'production';
  await assert.rejects(provision(f, room('a')), /UNVERIFIED/);
  f.admin.auth.app.options.projectId = env.GCLOUD_PROJECT; f.admin.db.projectId = 'production';
  await assert.rejects(token(f, room('a'), 'public'), /UNVERIFIED/);
  assert.equal(f.reads, 0); assert.equal(f.authWrites, 0); assert.equal(f.dbWrites, 0);
});

function middleware(envValue, dependencies) {
  let handler;
  devPresidentPlugin(envValue, dependencies).configureServer({ middlewares: { use(value) { handler = value; } } });
  return async (url, method = 'GET', override = {}) => {
    const req = { url, method, socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost:5173', origin: 'http://localhost:5173', authorization: 'Bearer ' + credential }, ...override };
    const result = { statusCode: 200, headers: {}, body: null, next: false };
    const res = { set statusCode(value) { result.statusCode = value; }, setHeader(key, value) { result.headers[key] = value; }, end(value) { result.body = value; } };
    await handler(req, res, () => { result.next = true; });
    return result;
  };
}

test('DEV middleware serves authenticated DEMO entries and tokens; existing Room A pages remain available', async () => {
  const f = fixture(); f.seed(room('a')); await provision(f, room('a'));
  const request = middleware(env, { demoAccessFn: (id, key) => access(f, id, key), demoTokenFn: (id, key) => token(f, id, key) });
  for (const key of ['president', 'public', 'judge/1']) {
    const path = '/__dev/demo/' + room('a') + '/' + key;
    const page = await request(path);
    assert.equal(page.statusCode, 200);
    assert.ok(page.body.includes('data-room-id="' + room('a') + '"'));
    assert.ok(page.body.includes('data-token-path="' + path + '/token"'));
    assert.equal(page.headers['Cache-Control'], 'no-store');
    const response = await request(path + '/token', 'POST');
    assert.equal(response.statusCode, 200);
    const issued = JSON.parse(JSON.parse(response.body).token);
    assert.equal(issued.claims.roomId, room('a'));
  }
  for (const key of ['president', 'public', 'judge/1', 'judge/2', 'judge/3']) {
    const page = await request('/__dev/' + key);
    assert.equal(page.statusCode, 200);
    assert.ok(page.body.includes('data-room-id="A"'));
    assert.ok(page.body.includes('data-token-path="/__dev/' + key + '/token"'));
  }
  assert.equal((await request('/__dev/demo/' + room('a') + '/judge/4')).statusCode, 503);
});

test('DEV middleware rejects LAN, foreign origins, unsupported methods and malformed paths before token issuance', async () => {
  let calls = 0;
  const request = middleware(env, { demoAccessFn: () => { calls += 1; throw new Error('not ready'); }, demoTokenFn: () => { calls += 1; throw new Error('not ready'); } });
  const path = '/__dev/demo/' + room('a') + '/president';
  assert.equal((await request(path, 'GET', { socket: { remoteAddress: '192.168.1.2' } })).statusCode, 403);
  assert.equal((await request(path + '/token', 'POST', { headers: { host: 'localhost:5173', origin: 'http://foreign.example' } })).statusCode, 403);
  assert.equal((await request(path + '/token', 'POST', { headers: { host: 'foreign.example', origin: 'http://foreign.example' } })).statusCode, 403);
  assert.equal((await request(path + '/token', 'GET')).statusCode, 405);
  assert.equal((await request(path, 'POST')).statusCode, 405);
  for (const suffix of ['/__dev/demo/A/president', path + '/extra', '/__dev/demo/' + room('a') + '/judge/01']) assert.equal((await request(suffix)).statusCode, 404);
  assert.equal(calls, 0);
  assert.equal((await request(path + '/token', 'POST')).statusCode, 503);
  assert.equal(calls, 1);
});

async function runDevLogin(dataset, claims) {
  const source = await readFile(new URL('../src/devPresident.js', import.meta.url), 'utf8');
  let click; let signOuts = 0;
  const assigned = []; const requests = [];
  const button = { dataset, addEventListener(type, callback) { assert.equal(type, 'click'); click = callback; } };
  const status = {};
  const authModule = {
    browserSessionPersistence: {}, setPersistence: async () => {},
    signInWithCustomToken: async () => ({ user: { uid: 'local-user' } }),
    getIdTokenResult: async () => ({ claims }), signOut: async () => { signOuts += 1; },
  };
  // Replace only module-loading boundaries; execute the actual browser login logic.
  const executable = source.replaceAll('import.meta.env.DEV', 'true').replaceAll("import('firebase/auth')", "fakeImport('firebase/auth')").replaceAll("import('./firebase.js')", "fakeImport('./firebase.js')");
  vm.runInNewContext(executable, {
    document: { getElementById: id => id === 'login' ? button : status },
    window: { location: { assign: path => assigned.push(path) } },
    fakeImport: async name => name === 'firebase/auth' ? authModule : { auth: {} },
    fetch: async path => { requests.push(path); return { ok: true, json: async () => ({ token: 'local-token' }) }; },
  });
  await click();
  return { assigned, requests, signOuts, status };
}

test('DEV browser login uses the selected room while preserving Room A fallback and rejects mismatched claims', async () => {
  const dataset = { roomId: room('a'), key: 'judge/2', role: 'judge', judgeId: '2', tokenPath: '/__dev/demo/' + room('a') + '/judge/2/token' };
  const correct = await runDevLogin(dataset, { roomId: room('a'), role: 'judge', judgeId: 2 });
  assert.deepEqual(correct.assigned, ['/rooms/' + room('a') + '/judge/2']);
  assert.deepEqual(correct.requests, [dataset.tokenPath]);
  for (const claims of [
    { roomId: room('b'), role: 'judge', judgeId: 2 },
    { roomId: room('a'), role: 'president' },
    { roomId: room('a'), role: 'judge', judgeId: '2' },
  ]) {
    const rejected = await runDevLogin(dataset, claims);
    assert.deepEqual(rejected.assigned, []); assert.equal(rejected.signOuts, 1);
  }
  const existing = await runDevLogin({ key: 'president', role: 'president' }, { roomId: 'A', role: 'president' });
  assert.deepEqual(existing.assigned, ['/rooms/A/president']);
  assert.deepEqual(existing.requests, ['/__dev/president/token']);
});
