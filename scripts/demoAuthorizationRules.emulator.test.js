/* global process */
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDocFromServer, setDoc, deleteDoc } from 'firebase/firestore';
import { initialRoomDocuments } from './roomDefaults.js';

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (host && host !== '127.0.0.1:8184') throw new Error('Isolated Rules emulator requires 127.0.0.1:8184');
const room = 'demo-patterns-' + 'a'.repeat(24);
const other = 'demo-patterns-' + 'b'.repeat(24);
const keys = ['president', 'public', 'judge/1', 'judge/2', 'judge/3', 'judge/4', 'judge/5'];
const record = () => ({ version: 1, roomAccessVersion: 3, roles: Object.fromEntries(keys.map((key, i) => [key, { active: true, accessVersion: i + 4 }])) });
const claims = (id, key) => ({ roomId: id, role: key.startsWith('judge/') ? 'judge' : key,
  ...(key.startsWith('judge/') ? { judgeId: Number(key.slice(6)) } : {}), roomAccessVersion: 3, accessVersion: keys.indexOf(key) + 4 });
const submission = judgeId => ({ evaluationId: 1, judgeId, mode: 'binary', vote: 'hong', sent: true, submittedAt: 1 });

test('isolated DEMO authorization Rules: legitimate access, revocation, isolation and regressions', { skip: !host, timeout: 120000 }, async t => {
  const environment = await initializeTestEnvironment({ projectId: 'demo-patterns-rules-c3',
    firestore: { host: '127.0.0.1', port: 8184, rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') } });
  let uid = 0;
  const client = value => environment.authenticatedContext('rules-' + ++uid, value).firestore();
  const path = (db, id, collection, key = 'current') => doc(db, `rooms/${id}/${collection}/${key}`);
  const read = (db, id = room) => getDocFromServer(path(db, id, 'control'));
  const authorization = (id, data) => environment.withSecurityRulesDisabled(async context => {
    const ref = doc(context.firestore(), 'localDemoAuthorization/' + id);
    if (data === null) await deleteDoc(ref); else await setDoc(ref, data);
  });
  const [control, meta, publicState] = initialRoomDocuments();
  control.config.patternJudges = 5;
  publicState.judges = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, sent: false, decision: null }));
  try {
    await environment.withSecurityRulesDisabled(async context => {
      for (const id of [room, other, 'A', 'B', 'demo-patterns-short']) {
        const db = context.firestore();
        await setDoc(path(db, id, 'control'), control);
        await setDoc(path(db, id, 'meta'), { ...meta, demoSessionId: 'session' });
        await setDoc(path(db, id, 'publicState'), publicState);
      }
    });
    await authorization(room, record()); await authorization(other, record());
    await t.test('all legitimate DEMO roles retain their read and write permissions', async () => {
      for (const key of keys) {
        const db = client(claims(room, key));
        await assertSucceeds(read(db));
        if (key === 'president') {
          await assertSucceeds(setDoc(path(db, room, 'control'), control));
          await assertSucceeds(setDoc(path(db, room, 'meta'), { ...meta, demoSessionId: 'session' }));
          await assertSucceeds(setDoc(path(db, room, 'publicState'), publicState));
          await assertSucceeds(setDoc(path(db, room, 'judges', '1'), { id: 1, pattern: { evaluationId: 1, binary: { evaluationId: 1, sent: true } } }));
          await assertSucceeds(setDoc(path(db, room, 'demoSessions', 'session'), { sessionId: 'session', consumedEvaluationIds: [1], confirmedCount: 1 }));
          await assertFails(setDoc(path(db, room, 'submissions', '1'), submission(1)));
        } else if (key === 'public') {
          await assertSucceeds(getDocFromServer(path(db, room, 'publicState')));
          await assertFails(getDocFromServer(path(db, room, 'meta')));
          await assertFails(setDoc(path(db, room, 'control'), control));
        } else {
          const id = key.slice(6);
          await assertSucceeds(getDocFromServer(path(db, room, 'meta')));
          await assertSucceeds(setDoc(path(db, room, 'submissions', id), submission(Number(id))));
          await assertSucceeds(getDocFromServer(path(db, room, 'submissions', id)));
          await assertFails(getDocFromServer(path(db, room, 'publicState')));
          await assertFails(setDoc(path(db, room, 'control'), control));
          await assertFails(setDoc(path(db, room, 'submissions', id === '1' ? '2' : '1'), submission(id === '1' ? 2 : 1)));
        }
      }
    });
    await t.test('claims and stored versions must be present, positive safe integers and match exactly', async () => {
      for (const field of ['roomAccessVersion', 'accessVersion']) {
        for (const value of [undefined, null, 0, -1, 1.5, '3', true, 9007199254740992, 99]) {
          const token = claims(room, 'president');
          if (value === undefined) delete token[field]; else token[field] = value;
          const db = client(token);
          await assertFails(read(db)); await assertFails(setDoc(path(db, room, 'control'), control));
          const data = record(); const target = field === 'roomAccessVersion' ? data : data.roles.president;
          if (value === undefined) delete target[field]; else target[field] = value;
          await authorization(room, data);
          await assertFails(read(client(claims(room, 'president'))));
          await authorization(room, record());
        }
      }
      for (const value of [undefined, null, '1', true, 1.5, 0, -1, 6]) {
        const token = claims(room, 'judge/1');
        if (value === undefined) delete token.judgeId; else token.judgeId = value;
        await assertFails(read(client(token)));
      }
      for (const token of [{}, { roomId: room }, { ...claims(room, 'public'), role: 'admin' }]) await assertFails(read(client(token)));
      await assertFails(read(environment.unauthenticatedContext().firestore()));
    });
    await t.test('missing authorization, missing grants and inactive roles fail closed', async () => {
      await authorization(room, null);
      for (const key of keys) await assertFails(read(client(claims(room, key))));
      for (const key of keys) {
        for (const active of [false, 'true', 1, null, undefined]) {
          const data = record(); data.roles[key].active = active ?? null;
          await authorization(room, data); await assertFails(read(client(claims(room, key))));
        }
        const data = record(); delete data.roles[key];
        await authorization(room, data); await assertFails(read(client(claims(room, key))));
      }
      await authorization(room, record());
      await assertFails(read(client(claims('demo-patterns-short', 'president')), 'demo-patterns-short'));
    });
    await t.test('role and room revocation reject existing identities on every protected path', async () => {
      const clients = Object.fromEntries(keys.map(key => [key, client(claims(room, key))]));
      for (const key of keys) {
        const data = record(); data.roles[key].accessVersion++;
        await authorization(room, data);
        await assertFails(read(clients[key]));
        for (const unaffected of keys.filter(value => value !== key)) await assertSucceeds(read(clients[unaffected]));
        await authorization(room, record());
      }
      const data = record(); data.roomAccessVersion++;
      await authorization(room, data);
      for (const db of Object.values(clients)) {
        for (const [collection, id] of [['control', 'current'], ['meta', 'current'], ['publicState', 'current'], ['judges', '1'], ['submissions', '1'], ['demoSessions', 'session']]) {
          await assertFails(getDocFromServer(path(db, room, collection, id)));
          await assertFails(setDoc(path(db, room, collection, id), collection === 'control' ? control : submission(1)));
        }
      }
      await assertSucceeds(read(client(claims(other, 'president')), other));
      await assertSucceeds(read(client({ ...claims(room, 'president'), roomAccessVersion: 4 })));
      await authorization(room, record());
    });
    await t.test('roles, rooms and authorization documents remain isolated', async () => {
      for (const [own, foreign] of [[room, other], [other, room]]) {
        for (const key of keys) {
          const db = client(claims(own, key));
          await assertFails(read(db, foreign));
          await assertFails(setDoc(path(db, foreign, 'control'), control));
          const ref = doc(db, 'localDemoAuthorization/' + own);
          await assertFails(getDocFromServer(ref)); await assertFails(setDoc(ref, record())); await assertFails(deleteDoc(ref));
        }
      }
      // A revoked Judge cannot borrow another role's active grant or version.
      const data = record(); data.roles['judge/1'].active = false;
      await authorization(room, data);
      await assertFails(read(client({ ...claims(room, 'judge/1'), accessVersion: data.roles['judge/2'].accessVersion })));
      await assertSucceeds(read(client(claims(room, 'judge/2'))));
    });
    await t.test('non-DEMO rooms preserve access without version claims and legacy matches remain denied', async () => {
      for (const id of ['A', 'B']) {
        const president = client({ roomId: id, role: 'president' });
        await assertSucceeds(read(president, id)); await assertSucceeds(setDoc(path(president, id, 'control'), control));
        await assertSucceeds(setDoc(path(president, id, 'publicState'), publicState));
        const judge = client({ roomId: id, role: 'judge', judgeId: 2 });
        await assertSucceeds(read(judge, id)); await assertSucceeds(setDoc(path(judge, id, 'submissions', '2'), submission(2)));
        await assertFails(setDoc(path(judge, id, 'submissions', '1'), submission(1)));
        const publicDb = client({ roomId: id, role: 'public' });
        await assertSucceeds(getDocFromServer(path(publicDb, id, 'publicState')));
        await assertFails(setDoc(path(publicDb, id, 'control'), control));
        await assertFails(read(president, id === 'A' ? 'B' : 'A'));
        await assertFails(getDocFromServer(doc(president, 'matches/legacy')));
      }
    });
  } finally { await environment.cleanup(); }
});
