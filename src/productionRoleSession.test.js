import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { productionRolePathFromClaims, loginProductionRole } from './productionRoleSession.js';
import { presidentPathFromClaims } from './presidentSession.js';
import { parseAppRoute } from './roomRoutes.js';
import { identityFromClaims, authorizeRoomRoute } from './roomAccess.js';

const production = {
  VITE_APP_ENV: 'production', VITE_FIREBASE_USE_EMULATOR: 'false', VITE_FIREBASE_ALLOW_PRODUCTION: 'true',
  VITE_FIREBASE_PROJECT_ID: 'hwarang-patterns-production', VITE_FIREBASE_APP_ID: '1:649211397143:web:bc8237e2002fa099380852',
  VITE_FIREBASE_API_KEY: 'offline-test-key', VITE_FIREBASE_AUTH_DOMAIN: 'test.invalid',
};
const development = Object.fromEntries(readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
  .split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => line.split('=')));
const cases = [
  [{ roomId: 'A', role: 'president' }, '/rooms/A/president'],
  [{ roomId: 'A', role: 'public' }, '/rooms/A/public'],
  ...[1, 2, 3].map(judgeId => [{ roomId: 'A', role: 'judge', judgeId }, '/rooms/A/judge/' + judgeId]),
];
function fixture(claims, failAt) {
  const events = [];
  const auth = { app: { options: { projectId: production.VITE_FIREBASE_PROJECT_ID, appId: production.VITE_FIREBASE_APP_ID } },
    emulatorConfig: null, currentUser: { uid: 'previous-session' } };
  const options = { source: production, persistence: 'offline-session', sdk: {
    async setPersistence(candidate, persistence) {
      assert.equal(candidate, auth); assert.equal(persistence, 'offline-session'); events.push('persistence');
      if (failAt === 'persistence') throw new Error('SYNTHETIC_PRIVATE_ERROR');
    },
    async signOut(candidate) { assert.equal(candidate, auth); events.push('signOut'); auth.currentUser = null; },
    async signInWithEmailAndPassword(candidate, email, password) {
      assert.equal(candidate, auth); assert.equal(email, 'individual@patterns.test'); assert.equal(password, 'synthetic-password');
      assert.equal(auth.currentUser, null); events.push('signIn');
      if (failAt === 'signIn') throw new Error('SYNTHETIC_PRIVATE_ERROR');
      auth.currentUser = { uid: 'verified-user' }; return { user: auth.currentUser };
    },
    async getIdTokenResult(user, forceRefresh) {
      assert.equal(user, auth.currentUser); assert.equal(forceRefresh, true); events.push('verifiedClaims');
      if (failAt === 'token') throw new Error('SYNTHETIC_PRIVATE_ERROR');
      return { claims };
    },
  } };
  return { auth, options, events, login: () => loginProductionRole(auth, 'individual@patterns.test', 'synthetic-password', options) };
}

test('all production destinations come from strictly typed claims and retain President paths', () => {
  for (const [claims, path] of cases) {
    assert.equal(productionRolePathFromClaims(claims), path);
    const route = parseAppRoute(path);
    assert.equal(authorizeRoomRoute(identityFromClaims({ uid: 'verified-user' }, claims), route).allowed, true);
  }
  assert.equal(productionRolePathFromClaims({ roomId: 'B', role: 'president' }), presidentPathFromClaims({ roomId: 'B', role: 'president' }));
  assert.equal(productionRolePathFromClaims({ roomId: 'HTI_internal', role: 'public' }), '/rooms/HTI_internal/public');
});

const badClaims = [null, undefined, [], {}, { role: 'president' }, { roomId: 'A' },
  { roomId: 1, role: 'public' }, { roomId: '../A', role: 'public' }, { roomId: 'A?role=president', role: 'public' },
  { roomId: 'A%2Fpresident', role: 'public' }, { roomId: '', role: 'public' }, { roomId: 'a'.repeat(65), role: 'public' },
  { roomId: 'A', role: 'admin' }, { roomId: 'A', role: 'President' }, { roomId: 'A', role: 'judge' },
  ...[0, 4, 5, -1, 1.5, '1', true, null].map(judgeId => ({ roomId: 'A', role: 'judge', judgeId })),
  ...['president', 'public'].flatMap(role => [1, null, undefined].map(judgeId => ({ roomId: 'A', role, judgeId }))),
  { roomId: 'A', role: 'public', matchId: 'legacy' }, { roomId: 'A', role: 'public', admin: true },
  { roomId: 'A', role: 'judge', judgeId: 1, roomAccessVersion: 1 },
  { roomId: 'demo-patterns-' + 'a'.repeat(24), role: 'president' },
  { roomId: 'demo-patterns-short', role: 'public' },
  Object.create({ roomId: 'A', role: 'president' }),
];
test('malformed, conflicting, legacy and DEMO claims cannot select a production destination', () => {
  for (const claims of badClaims) assert.throws(() => productionRolePathFromClaims(claims), /PRODUCTION_ROLE_CLAIMS_REQUIRED/);
});

test('Firebase login obtains fresh verified claims before navigation for each role', async () => {
  for (const [claims, path] of cases) {
    const f = fixture({ ...claims, iss: 'https://securetoken.google.com/hwarang-patterns-production',
      aud: 'hwarang-patterns-production', sub: 'verified-user', iat: 1, exp: 2,
      email_verified: true, firebase: { sign_in_provider: 'password' } });
    assert.equal(await f.login(), path);
    assert.deepEqual(f.events, ['persistence', 'signOut', 'signIn', 'verifiedClaims']);
    assert.equal(f.auth.currentUser.uid, 'verified-user');
  }
});

test('untrusted room, role, judge and return URL inputs cannot override verified claims', async () => {
  const f = fixture({ roomId: 'B', role: 'judge', judgeId: 2 });
  Object.assign(f.options, { roomId: 'A', role: 'president', judgeId: 1, returnTo: '/rooms/A/president',
    claims: { roomId: 'A', role: 'president' } });
  assert.equal(await f.login(), '/rooms/B/judge/2');
});

test('invalid claims close the newly authenticated session without returning a path', async () => {
  for (const claims of badClaims) {
    const f = fixture(claims);
    await assert.rejects(f.login(), /PRODUCTION_ROLE_CLAIMS_REQUIRED/);
    assert.equal(f.auth.currentUser, null);
    assert.deepEqual(f.events, ['persistence', 'signOut', 'signIn', 'verifiedClaims', 'signOut']);
  }
});

test('persistence, credentials and token failures clear sessions', async () => {
  for (const failAt of ['persistence', 'signIn', 'token']) {
    const f = fixture(cases[0][0], failAt);
    await assert.rejects(f.login(), /SYNTHETIC_PRIVATE_ERROR/);
    assert.equal(f.auth.currentUser, null);
    assert.equal(f.events.at(-1), 'signOut');
  }
});

test('environment mismatches close the old session before any authentication attempt', async () => {
  for (const mutate of [
    f => { f.auth.app.options.projectId = 'hwarang-scoring'; },
    f => { f.auth.app.options.appId = 'other-app'; },
    f => { f.auth.emulatorConfig = { host: '127.0.0.1', port: 9099 }; },
    f => { f.options.source = { ...production, VITE_APP_ENV: 'unknown' }; },
    f => { f.options.source = { ...production, FIRESTORE_EMULATOR_HOST: '' }; },
    f => { f.options.source = development; f.auth.app.options.projectId = 'demo-patterns-gups'; f.auth.emulatorConfig = { host: '127.0.0.1', port: 9099 }; },
  ]) {
    const f = fixture(cases[0][0]); mutate(f);
    await assert.rejects(f.login());
    assert.equal(f.auth.currentUser, null);
    assert.deepEqual(f.events, ['signOut']);
  }
});
