import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const defaults = Object.fromEntries(readFileSync(new URL('../.env.example', import.meta.url), 'utf8').split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => line.split('=')));
function run(overrides, valid) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('VITE_')) delete env[key];
  Object.assign(env, defaults, overrides);
  const script = valid ? `
    const { auth, db } = await import('./src/firebase.js');
    const { getApps, deleteApp } = await import('firebase/app');
    const { terminate } = await import('firebase/firestore');
    if (auth.app.options.projectId !== 'demo-patterns-gups' || auth.emulatorConfig.host !== '127.0.0.1' || auth.emulatorConfig.port !== 9099) throw Error('Wrong DEV target');
    if (getApps().length !== 1) throw Error('Unexpected app');
    await terminate(db); await deleteApp(auth.app);
  ` : `
    const { getApps } = await import('firebase/app');
    let rejected = false;
    try { await import('./src/firebase.js'); } catch (error) {
      if (!error.message.startsWith('[Firebase config]')) throw error;
      rejected = true;
    }
    if (!rejected || getApps().length !== 0) throw Error('Invalid config initialized Firebase');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env, cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr || String(result.error));
}
test('valid DEV initializes both emulator clients without network requests', () => run({}, true));
test('invalid or cloud config aborts before initialization without fallback', () => {
  run({ VITE_FIREBASE_USE_EMULATOR: 'false' }, false);
  run({ VITE_APP_ENV: 'production', VITE_FIREBASE_USE_EMULATOR: 'false', VITE_FIREBASE_ALLOW_PRODUCTION: 'true' }, false);
  run({ VITE_APP_ENV: 'unknown' }, false);
});
