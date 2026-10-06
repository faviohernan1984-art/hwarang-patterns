import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveFirebaseEnvironment } from './firebaseConfig.js';
const defaults = Object.fromEntries(readFileSync(new URL('../.env.example', import.meta.url), 'utf8').trim().split(/\r?\n/).map(line => line.split('=')));
test('local project is isolated and both endpoints are explicit', () => {
  const settings = resolveFirebaseEnvironment(defaults);
  assert.equal(settings.firebaseConfig.projectId, 'demo-patterns-gups');
  assert.deepEqual(settings.emulator, { host: '127.0.0.1', firestorePort: 8080, authPort: 9099 });
});
test('missing and unsafe settings fail closed', () => {
  for (const key of Object.keys(defaults).filter(key => key !== 'VITE_FIREBASE_ALLOW_PRODUCTION')) {
    assert.throws(() => resolveFirebaseEnvironment({ ...defaults, [key]: undefined }));
  }
  for (const [key, values] of Object.entries({
    VITE_APP_ENV: ['production', 'training', ''],
    VITE_FIREBASE_PROJECT_ID: ['hwarang-scoring', 'another-real-project', 'demo-other'],
    VITE_FIREBASE_USE_EMULATOR: ['false', 'yes'],
    VITE_FIREBASE_ALLOW_PRODUCTION: ['true', 'yes'],
    VITE_FIREBASE_EMULATOR_HOST: ['0.0.0.0', '8.8.8.8', 'https://localhost', '192.168.1.2'],
    VITE_FIRESTORE_EMULATOR_PORT: ['0', '65536', '8080x', '9099'],
    VITE_AUTH_EMULATOR_PORT: ['0', '65536', '8080'],
    VITE_FIREBASE_API_KEY: ['production-key'],
  })) for (const value of values) assert.throws(() => resolveFirebaseEnvironment({ ...defaults, [key]: value }));
});
test('LAN requires explicit opt-in and a private IPv4', () => {
  for (const host of ['192.168.1.2', '10.0.0.2', '172.16.0.2']) assert.doesNotThrow(() => resolveFirebaseEnvironment({ ...defaults, VITE_FIREBASE_ALLOW_LAN: 'true', VITE_FIREBASE_EMULATOR_HOST: host }));
  for (const host of ['localhost', '8.8.8.8', '172.32.0.2', '192.168.999.2', 'host.example']) assert.throws(() => resolveFirebaseEnvironment({ ...defaults, VITE_FIREBASE_ALLOW_LAN: 'true', VITE_FIREBASE_EMULATOR_HOST: host }));
});
