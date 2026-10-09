/* global process */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { initializeApp, deleteApp } from 'firebase/app';
import * as sdk from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, updateDoc, setDoc, terminate } from 'firebase/firestore';
import { deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { localAdmin, DEV_IDENTITIES, validateAdminEnvironment } from './localAdmin.js';
import { authenticateLocalDemoRoute } from '../src/localDemoAccess.js';
import { parseAppRoute } from '../src/roomRoutes.js';
import { demoMatchCreditsRemote } from '../src/demoMatchCreditsFirebase.js';
import { emptyPublicState } from '../src/publicState.js';

const source = Object.fromEntries(readFileSync(new URL('../.env.example', import.meta.url), 'utf8').split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => line.split('=')));
const origin = 'http://127.0.0.1:5173';
const enabled = process.env.PATTERNS_TEST_DEMO_CIRCUIT === 'true';
if (enabled) {
  validateAdminEnvironment(process.env);
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('Exact local Emulator endpoints required');
}

test('real Emulator circuit: assignment, clean routes, all roles, isolation and retained 25 credits', { skip: !enabled, timeout: 45000 }, async t => {
  const admin = localAdmin(); const clients = [];
  const roomARefs = ['control', 'meta', 'publicState'].map(name => admin.db.doc('rooms/A/' + name + '/current'));
  const roomA = async () => (await admin.db.getAll(...roomARefs)).map(snapshot => ({ exists: snapshot.exists, data: snapshot.exists ? snapshot.data() : null }));
  const roomAUsers = async () => Promise.all(Object.values(DEV_IDENTITIES).map(async identity => {
    try { const user = await admin.auth.getUser(identity.uid); return user.toJSON(); }
    catch (error) { if (error.code === 'auth/user-not-found') return null; throw error; }
  }));
  const before = await roomA(); const usersBefore = await roomAUsers();
  const fetchImpl = (url, init = {}) => fetch(origin + url, { ...init, headers: { ...init.headers, Origin: origin }, signal: AbortSignal.timeout(15000) });
  async function create(roomId = null) {
    const response = await fetchImpl('/api/create-demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId }) });
    const result = await response.json(); assert.equal(response.ok, true, JSON.stringify(result)); return result;
  }
  async function enter(path) {
    const app = initializeApp({ projectId: 'demo-patterns-gups', apiKey: 'demo-patterns-gups-key' }, 'circuit-' + randomUUID());
    const auth = sdk.getAuth(app); sdk.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8080); clients.push({ app, db });
    await authenticateLocalDemoRoute(auth, parseAppRoute(path), { fetchImpl, source, hostname: '127.0.0.1', sdk: { ...sdk, browserSessionPersistence: sdk.inMemoryPersistence } });
    return { auth, db };
  }
  try {
    const first = await create(); const second = await create();
    console.log('Isolated Emulator test rooms:', first.roomId, second.roomId);
    assert.notEqual(first.roomId, second.roomId); assert.notEqual(first.demoSessionId, second.demoSessionId);
    assert.equal(first.access.length, 5); assert.equal(JSON.stringify(first).includes('__dev'), false);
    const president = await enter('/president/' + first.roomId);
    await t.test('President claims and room isolation follow the unchanged Firestore Rules', async () => {
      const { claims } = await sdk.getIdTokenResult(president.auth.currentUser);
      assert.equal(claims.roomId, first.roomId); assert.equal(claims.role, 'president');
      assert.equal(president.auth.currentUser.uid, 'dev-' + first.roomId + '-president');
      assert.equal((await getDoc(doc(president.db, 'rooms/' + first.roomId + '/meta/current'))).exists(), true);
      await assert.rejects(getDoc(doc(president.db, 'rooms/' + second.roomId + '/control/current')), error => error.code === 'permission-denied');
    });
    await t.test('all configured Judges authenticate; Public can read its state but not the ledger', async () => {
      for (const link of first.access.filter(item => item.role === 'judge')) {
        const client = await enter(link.path);
        const { claims } = await sdk.getIdTokenResult(client.auth.currentUser);
        assert.equal(claims.judgeId, link.judgeId); assert.equal(typeof claims.judgeId, 'number');
        assert.equal((await getDoc(doc(client.db, 'rooms/' + first.roomId + '/control/current'))).exists(), true);
        await assert.rejects(getDoc(doc(client.db, 'rooms/' + first.roomId + '/demoSessions/' + first.demoSessionId)), error => error.code === 'permission-denied');
      }
      const client = await enter('/public/' + first.roomId);
      assert.equal((await getDoc(doc(client.db, 'rooms/' + first.roomId + '/publicState/current'))).exists(), true);
      await assert.rejects(getDoc(doc(client.db, 'rooms/' + first.roomId + '/meta/current')), error => error.code === 'permission-denied');
      const denied = await fetchImpl('/api/demo-access/' + first.roomId + '/judge/4', { method: 'POST' });
      assert.equal(denied.status, 503);
    });
    await t.test('reusing an exhausted session retains the same ledger and 25 consumed decisions', async () => {
      const ids = Array.from({ length: 25 }, (_, index) => index + 1);
      await demoMatchCreditsRemote(president.db, first.roomId, first.demoSessionId).merge(ids);
      const reused = await create(first.roomId);
      assert.equal(reused.created, false); assert.equal(reused.demoSessionId, first.demoSessionId);
      const credits = (await getDoc(doc(president.db, 'rooms/' + first.roomId + '/demoSessions/' + first.demoSessionId))).data();
      assert.deepEqual(credits.consumedEvaluationIds, ids); assert.equal(credits.confirmedCount, 25);
    });
    await t.test('five-Judge configuration expands identities and clean links without refreshing credits', async () => {
      const controlRef = doc(president.db, 'rooms/' + first.roomId + '/control/current');
      await updateDoc(controlRef, { 'config.patternJudges': 5 });
      const control = (await getDoc(controlRef)).data();
      await setDoc(doc(president.db, 'rooms/' + first.roomId + '/publicState/current'), emptyPublicState(control));
      const reused = await create(first.roomId); assert.equal(reused.access.length, 7);
      const judge = await enter('/judge/' + first.roomId + '/5');
      assert.equal((await sdk.getIdTokenResult(judge.auth.currentUser)).claims.judgeId, 5);
      assert.equal((await getDoc(doc(president.db, 'rooms/' + first.roomId + '/demoSessions/' + first.demoSessionId))).data().confirmedCount, 25);
    });
    assert.deepEqual(await roomA(), before); assert.deepEqual(await roomAUsers(), usersBefore);
  } finally {
    for (const client of clients) { await terminate(client.db); await deleteApp(client.app); }
    await admin.db.terminate(); await deleteAdminApp(admin.app);
  }
});
