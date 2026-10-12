import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PASSWORD_RESET_CONFIRMATION, requestProductionPasswordReset } from './productionPasswordReset.js';

const production = {
  VITE_APP_ENV: 'production', VITE_FIREBASE_USE_EMULATOR: 'false', VITE_FIREBASE_ALLOW_PRODUCTION: 'true',
  VITE_FIREBASE_PROJECT_ID: 'hwarang-patterns-production', VITE_FIREBASE_APP_ID: '1:649211397143:web:bc8237e2002fa099380852',
  VITE_FIREBASE_API_KEY: 'offline-test-key', VITE_FIREBASE_AUTH_DOMAIN: 'test.invalid',
};
function fixture(error) {
  const currentUser = { uid: 'synthetic-current-user' };
  const auth = { app: { options: { projectId: production.VITE_FIREBASE_PROJECT_ID, appId: production.VITE_FIREBASE_APP_ID } }, emulatorConfig: null, currentUser };
  const calls = [];
  const options = { source: production, sdk: {
    async sendPasswordResetEmail(...args) { calls.push(args); if (error) throw error; },
  } };
  return { auth, currentUser, calls, options };
}

test('existing accounts use the Firebase reset API with only auth and normalized email', async () => {
  const f = fixture();
  assert.equal(await requestProductionPasswordReset(f.auth, '  individual@patterns.test  ', f.options), PASSWORD_RESET_CONFIRMATION);
  assert.deepEqual(f.calls, [[f.auth, 'individual@patterns.test']]);
  assert.equal(f.auth.currentUser, f.currentUser);
});

test('missing accounts and every SDK failure return the same confirmation without error details', async () => {
  for (const code of ['auth/user-not-found', 'auth/user-disabled', 'auth/too-many-requests', 'auth/network-request-failed', 'auth/invalid-email', 'unknown']) {
    const f = fixture(Object.assign(new Error('PRIVATE_EMAIL_OR_TOKEN_DETAILS'), { code }));
    const result = await requestProductionPasswordReset(f.auth, 'individual@patterns.test', f.options);
    assert.equal(result, PASSWORD_RESET_CONFIRMATION);
    assert.equal(result.includes('PRIVATE_EMAIL_OR_TOKEN_DETAILS'), false);
    assert.equal(f.calls.length, 1);
    assert.equal(f.auth.currentUser, f.currentUser);
  }
});

test('empty or malformed emails never invoke the SDK', async () => {
  for (const email of [null, undefined, 1, '', ' ', 'invalid', 'a@@b.test', 'a b@patterns.test', 'a'.repeat(255) + '@patterns.test']) {
    const f = fixture();
    await assert.rejects(requestProductionPasswordReset(f.auth, email, f.options), /INVALID_RESET_EMAIL/);
    assert.equal(f.calls.length, 0);
    assert.equal(f.auth.currentUser, f.currentUser);
  }
});

test('unapproved, mixed and development environments cannot send reset emails', async () => {
  const development = Object.fromEntries(readFileSync(new URL('../.env.example', import.meta.url), 'utf8').split(/\r?\n/)
    .filter(line => line && !line.startsWith('#')).map(line => line.split('=')));
  for (const mutate of [
    f => { f.auth.app.options.projectId = 'hwarang-scoring'; },
    f => { f.auth.app.options.appId = 'other'; },
    f => { f.auth.emulatorConfig = { host: '127.0.0.1', port: 9099 }; },
    f => { f.options.source = { ...production, VITE_FIREBASE_USE_EMULATOR: 'true' }; },
    f => { f.options.source = { ...production, FIRESTORE_EMULATOR_HOST: '' }; },
    f => { f.options.source = development; f.auth.app.options.projectId = 'demo-patterns-gups'; f.auth.emulatorConfig = { host: '127.0.0.1', port: 9099 }; },
  ]) {
    const f = fixture(); mutate(f);
    await assert.rejects(requestProductionPasswordReset(f.auth, 'individual@patterns.test', f.options));
    assert.equal(f.calls.length, 0);
    assert.equal(f.auth.currentUser, f.currentUser);
  }
});
