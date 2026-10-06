/* global process */
import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp as deleteClientApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithCustomToken, getIdTokenResult } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, terminate } from 'firebase/firestore';
import { deleteApp } from 'firebase-admin/app';
import { DEV_IDENTITIES, devIdentity, devToken, localAdmin } from './localAdmin.js';
import { provisionLocalRoom } from './provisionLocal.js';
import { devPresidentPlugin } from './devPresidentPlugin.js';
import { authorizeRoomRoute, identityFromClaims } from '../src/roomAccess.js';

test('DEV identities are a closed list with integer Judges 1-3 for Room A', () => {
  assert.deepEqual(Object.keys(DEV_IDENTITIES), ['president', 'public', 'judge/1', 'judge/2', 'judge/3']);
  for (const key of ['judge/0', 'judge/4', 'judge/01', '__proto__', 'constructor', 'B/public', '', undefined]) assert.throws(() => devIdentity(key));
  for (const id of [1, 2, 3]) assert.deepEqual(devIdentity('judge/' + id).claims, { roomId: 'A', role: 'judge', judgeId: id });
});

test('DEV middleware serves Public/Judge pages, blocks foreign Origin and unknown identities', async () => {
  let middleware;
  devPresidentPlugin({ PATTERNS_DEV_PRESIDENT: 'true', GCLOUD_PROJECT: 'demo-patterns-gups', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }).configureServer({ middlewares: { use(fn) { middleware = fn; } } });
  for (const key of Object.keys(DEV_IDENTITIES)) {
    const res = { statusCode: 200, setHeader() {}, end(body) { this.body = body; } };
    await middleware({ url: '/__dev/' + key, method: 'GET', headers: { host: 'localhost:5173' }, socket: { remoteAddress: '127.0.0.1' } }, res, () => assert.fail('Unexpected fallback'));
    assert.equal(res.statusCode, 200);
    assert.match(res.body, new RegExp('data-key="' + key + '"'));
  }
  for (const [url, origin, expected] of [['/__dev/judge/4/token', 'http://localhost:5173', 404], ['/__dev/public/token', 'http://evil.example', 403]]) {
    const res = { statusCode: 200, setHeader() {}, end() {} };
    await middleware({ url, method: 'POST', headers: { host: 'localhost:5173', origin }, socket: { remoteAddress: '127.0.0.1' } }, res, () => assert.fail('Unexpected fallback'));
    assert.equal(res.statusCode, expected);
  }
});

test('Public and Judges 1-3 authenticate and preserve room, role and Judge isolation', {
  skip: process.env.PATTERNS_TEST_ROLES !== 'true',
}, async () => {
  await provisionLocalRoom();
  const admin = localAdmin();
  const clients = [];
  try {
    for (const key of ['public', 'judge/1', 'judge/2', 'judge/3']) {
      const expected = devIdentity(key);
      const app = initializeApp({ projectId: 'demo-patterns-gups', apiKey: 'demo-patterns-gups-key' }, 'roles-' + key.replace('/', '-'));
      const auth = getAuth(app);
      connectAuthEmulator(auth, 'http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST);
      const db = getFirestore(app);
      const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
      connectFirestoreEmulator(db, host, Number(port));
      clients.push({ app, db });
      const { user } = await signInWithCustomToken(auth, await devToken(key));
      const { claims } = await getIdTokenResult(user, true);
      for (const [name, value] of Object.entries(expected.claims)) assert.equal(claims[name], value);
      const identity = identityFromClaims(user, claims);
      const route = { valid: true, ...expected.claims };
      assert.equal(authorizeRoomRoute(identity, route).allowed, true);
      assert.equal(authorizeRoomRoute(identity, { ...route, roomId: 'B' }).reason, 'ROOM_FORBIDDEN');
      assert.equal(authorizeRoomRoute(identity, { ...route, role: 'president' }).reason, 'ROLE_FORBIDDEN');
      const controlRef = doc(db, 'rooms/A/control/current');
      const control = (await getDoc(controlRef)).data();
      await assert.rejects(getDoc(doc(db, 'rooms/B/control/current')), error => error.code === 'permission-denied');
      await assert.rejects(updateDoc(controlRef, { status: 'running' }), error => error.code === 'permission-denied');
      if (key === 'public') {
        assert.equal((await getDoc(doc(db, 'rooms/A/publicState/current'))).exists(), true);
        await assert.rejects(getDoc(doc(db, 'rooms/A/meta/current')), error => error.code === 'permission-denied');
        await assert.rejects(setDoc(doc(db, 'rooms/A/submissions/1'), {}), error => error.code === 'permission-denied');
      } else {
        const id = expected.claims.judgeId;
        const other = id === 3 ? 1 : id + 1;
        assert.equal(authorizeRoomRoute(identity, { ...route, judgeId: other }).reason, 'JUDGE_FORBIDDEN');
        assert.equal((await getDoc(doc(db, 'rooms/A/meta/current'))).exists(), true);
        const payload = { evaluationId: control.evaluationId, judgeId: id, mode: 'binary', vote: 'hong', sent: true, submittedAt: Date.now() };
        await setDoc(doc(db, 'rooms/A/submissions/' + id), payload);
        assert.equal((await getDoc(doc(db, 'rooms/A/submissions/' + id))).data().judgeId, id);
        await assert.rejects(getDoc(doc(db, 'rooms/A/submissions/' + other)), error => error.code === 'permission-denied');
        await assert.rejects(setDoc(doc(db, 'rooms/A/submissions/' + other), { ...payload, judgeId: other }), error => error.code === 'permission-denied');
        await assert.rejects(getDoc(doc(db, 'rooms/A/publicState/current')), error => error.code === 'permission-denied');
      }
    }
  } finally {
    for (const { app, db } of clients) { await terminate(db); await deleteClientApp(app); }
    await admin.db.terminate();
    await deleteApp(admin.app);
  }
});
