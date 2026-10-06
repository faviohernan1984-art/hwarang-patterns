/* global process */
import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp as deleteClientApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithCustomToken, getIdTokenResult, signOut } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, updateDoc, setDoc, terminate } from 'firebase/firestore';
import { deleteApp } from 'firebase-admin/app';
import { localAdmin, presidentToken, validateAdminEnvironment } from './localAdmin.js';
import { provisionLocalRoom } from './provisionLocal.js';
import { allowedDevRequest } from './devPresidentPlugin.js';
import { authorizeRoomRoute, identityFromClaims } from '../src/roomAccess.js';

const valid = { PATTERNS_DEV_PRESIDENT: 'true', GCLOUD_PROJECT: 'demo-patterns-gups', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' };
test('Admin rejects missing endpoints, cloud projects and credentials before connecting', () => {
  assert.equal(validateAdminEnvironment(valid), 'demo-patterns-gups');
  for (const key of Object.keys(valid)) assert.throws(() => validateAdminEnvironment({ ...valid, [key]: undefined }));
  for (const override of [
    { GCLOUD_PROJECT: 'hwarang-scoring' }, { FIREBASE_AUTH_EMULATOR_HOST: '192.168.0.146:9099' },
    { FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' }, { FIREBASE_AUTH_EMULATOR_HOST: 'localhost:65536' },
    { GOOGLE_APPLICATION_CREDENTIALS: 'key.json' }, { FIREBASE_CONFIG: '{}' }, { GOOGLE_CLOUD_PROJECT: 'production' },
  ]) assert.throws(() => validateAdminEnvironment({ ...valid, ...override }));
});
test('DEV token endpoint rejects LAN, foreign origin and DNS rebinding hosts', () => {
  const req = { socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost:5173', origin: 'http://localhost:5173' } };
  assert.equal(allowedDevRequest(req, true), true);
  assert.equal(allowedDevRequest({ ...req, socket: { remoteAddress: '192.168.0.2' } }, true), false);
  assert.equal(allowedDevRequest({ ...req, headers: { ...req.headers, origin: 'http://evil.example' } }, true), false);
  assert.equal(allowedDevRequest({ ...req, headers: { host: 'evil.example', origin: 'http://evil.example' } }, true), false);
});

test('Admin provisioning and real Auth President session respect Rooms rules', {
  skip: process.env.PATTERNS_TEST_PRESIDENT !== 'true' || process.env.PATTERNS_DEV_PRESIDENT !== 'true' || !process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST,
}, async () => {
  const first = await provisionLocalRoom();
  assert.equal(first.roomId, 'A');
  const second = await provisionLocalRoom();
  assert.equal(second.created, false);
  const token = await presidentToken();
  const app = initializeApp({ projectId: 'demo-patterns-gups', apiKey: 'demo-patterns-gups-key' }, 'president-integration');
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST);
  const db = getFirestore(app);
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(db, host, Number(port));
  const ref = name => doc(db, 'rooms/A/' + name + '/current');
  let previous;
  try {
    const { user } = await signInWithCustomToken(auth, token);
    const { claims } = await getIdTokenResult(user, true);
    assert.equal(claims.roomId, 'A');
    assert.equal(claims.role, 'president');
    const identity = identityFromClaims(user, claims);
    assert.equal(authorizeRoomRoute(identity, { valid: true, roomId: 'A', role: 'president' }).allowed, true);
    assert.equal(authorizeRoomRoute(identity, { valid: true, roomId: 'B', role: 'president' }).reason, 'ROOM_FORBIDDEN');
    assert.equal(authorizeRoomRoute(identity, { valid: true, roomId: 'A', role: 'judge', judgeId: 1 }).reason, 'ROLE_FORBIDDEN');
    for (const name of ['control', 'meta', 'publicState']) assert.equal((await getDoc(ref(name))).exists(), true);
    previous = (await getDoc(ref('control'))).data();
    await updateDoc(ref('control'), { status: 'running', phaseStartedAt: Date.now() });
    assert.equal((await provisionLocalRoom()).created, false);
    assert.equal((await getDoc(ref('control'))).data().status, 'running');
    await updateDoc(ref('control'), { status: 'paused', phaseStartedAt: null });
    assert.equal((await getDoc(ref('control'))).data().status, 'paused');
    await assert.rejects(getDoc(doc(db, 'rooms/B/control/current')), error => error.code === 'permission-denied');
    await assert.rejects(setDoc(doc(db, 'rooms/B/control/current'), previous), error => error.code === 'permission-denied');
    await signOut(auth);
    assert.equal(authorizeRoomRoute(null, { valid: true, roomId: 'A', role: 'president' }).reason, 'AUTH_REQUIRED');
    await assert.rejects(getDoc(ref('control')), error => error.code === 'permission-denied');
  } finally {
    const cleanup = localAdmin();
    if (previous) await cleanup.db.doc('rooms/A/control/current').set(previous);
    await cleanup.db.terminate();
    await deleteApp(cleanup.app);
    await terminate(db);
    await deleteClientApp(app);
  }
});
