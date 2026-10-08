import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validatePresidentAuthEnvironment, presidentPathFromClaims } from './presidentSession.js';
const dev = Object.fromEntries(readFileSync(new URL('../.env.example', import.meta.url), 'utf8').split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => line.split('=')));
const production = {
  VITE_APP_ENV: 'production', VITE_FIREBASE_USE_EMULATOR: 'false', VITE_FIREBASE_ALLOW_PRODUCTION: 'true',
  VITE_FIREBASE_PROJECT_ID: 'hwarang-patterns-production', VITE_FIREBASE_APP_ID: '1:649211397143:web:bc8237e2002fa099380852',
  VITE_FIREBASE_API_KEY: 'test-only-key', VITE_FIREBASE_AUTH_DOMAIN: 'test.invalid',
};
const auth = (env, emulatorConfig = null) => ({ app: { options: { projectId: env.VITE_FIREBASE_PROJECT_ID, appId: env.VITE_FIREBASE_APP_ID } }, emulatorConfig });
test('DEV requires the demo project and Auth Emulator', () => {
  assert.doesNotThrow(() => validatePresidentAuthEnvironment(auth(dev, { host: '127.0.0.1', port: 9099 }), dev));
  assert.throws(() => validatePresidentAuthEnvironment(auth(dev), dev), /EMULATOR_REQUIRED/);
  assert.throws(() => validatePresidentAuthEnvironment(auth(production), dev), /AUTH_PROJECT_MISMATCH/);
});
test('approved production Auth passes the guard without SDK initialization or network calls', () => {
  assert.doesNotThrow(() => validatePresidentAuthEnvironment(auth(production), production));
  assert.throws(() => validatePresidentAuthEnvironment(auth(production, { host: '127.0.0.1', port: 9099 }), production), /EMULATOR_FORBIDDEN/);
});
test('production rejects wrong Auth identity and unapproved configuration pairs', () => {
  for (const field of ['projectId', 'appId']) {
    const candidate = auth(production); candidate.app.options[field] = 'wrong-value';
    assert.throws(() => validatePresidentAuthEnvironment(candidate, production), /AUTH_.*MISMATCH/);
  }
  for (const override of [{ VITE_FIREBASE_PROJECT_ID: 'other-project' }, { VITE_FIREBASE_APP_ID: '1:123:web:abcdef' }]) {
    const env = { ...production, ...override };
    assert.throws(() => validatePresidentAuthEnvironment(auth(env), env), /not approved/);
  }
});
test('session guard reuses fail-closed contract for missing, mixed and unknown settings', () => {
  for (const override of [{ VITE_APP_ENV: undefined }, { VITE_APP_ENV: 'unknown' }, { VITE_FIREBASE_API_KEY: '' }, { VITE_FIREBASE_USE_EMULATOR: 'true' }, { VITE_FIREBASE_EMULATOR_HOST: '' }]) {
    assert.throws(() => validatePresidentAuthEnvironment(auth(production), { ...production, ...override }), /Firebase config/);
  }
  assert.throws(() => validatePresidentAuthEnvironment({}, production), /AUTH_PROJECT_MISMATCH/);
});
test('President claims still determine the Room destination', () => {
  assert.equal(presidentPathFromClaims({ roomId: 'A', role: 'president' }), '/rooms/A/president');
  for (const claims of [{}, { roomId: 'A', role: 'judge' }, { roomId: '../A', role: 'president' }, { roomId: 'A', role: 'president', judgeId: 1 }]) assert.throws(() => presidentPathFromClaims(claims));
});
