/* global process */
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDocFromServer, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { initialRoomDocuments } from './roomDefaults.js';
import { emptyPublicState } from '../src/publicState.js';

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (host && host !== '127.0.0.1:8184') throw new Error('Isolated Rules emulator requires 127.0.0.1:8184');

test('professional Rules enforce 3/5 transitions with existing identities and preserve other roles', { skip: !host, timeout: 120000 }, async () => {
  const environment = await initializeTestEnvironment({ projectId: 'demo-patterns-judge-access',
    firestore: { host: '127.0.0.1', port: 8184, rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') } });
  const client = (role, judgeId) => environment.authenticatedContext(role + (judgeId ?? ''),
    { roomId: 'A', role, ...(judgeId === undefined ? {} : { judgeId }) }).firestore();
  const president = client('president'); const publicDb = client('public');
  // These clients retain their original claims across every configuration change.
  const judges = Array.from({ length: 5 }, (_, i) => client('judge', i + 1));
  const ref = (db, path) => doc(db, 'rooms/A/' + path);
  const [control, meta] = initialRoomDocuments();
  try {
    await environment.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await setDoc(ref(db, 'meta/current'), meta);
      for (let id = 1; id <= 5; id++) {
        await setDoc(ref(db, 'judges/' + id), { id });
        await setDoc(ref(db, 'submissions/' + id), { evaluationId: 1, judgeId: id, mode: 'binary', vote: 'hong', sent: true, submittedAt: 1 });
      }
    });
    for (const count of [3, 5, 3, 5]) {
      control.config.patternJudges = count;
      const state = emptyPublicState(control);
      await environment.withSecurityRulesDisabled(async context => {
        await setDoc(ref(context.firestore(), 'control/current'), control);
        await setDoc(ref(context.firestore(), 'publicState/current'), state);
      });
      await assertSucceeds(getDocFromServer(ref(president, 'control/current')));
      await assertSucceeds(updateDoc(ref(president, 'control/current'), { pausedRemaining: 120 }));
      await assertSucceeds(updateDoc(ref(president, 'meta/current'), { presidentSwapSides: false }));
      await assertSucceeds(setDoc(ref(president, 'publicState/current'), state));
      await assertSucceeds(getDocFromServer(ref(publicDb, 'publicState/current')));
      await assertSucceeds(getDocFromServer(ref(publicDb, 'control/current')));
      await assertFails(updateDoc(ref(publicDb, 'control/current'), { pausedRemaining: 120 }));
      for (let id = 1; id <= 5; id++) {
        const db = judges[id - 1];
        for (const path of ['control/current', 'meta/current', 'judges/' + id, 'submissions/' + id]) {
          const action = getDocFromServer(ref(db, path));
          if (id <= count) await assertSucceeds(action); else await assertFails(action);
        }
        const write = setDoc(ref(db, 'submissions/' + id), { evaluationId: 1, judgeId: id, mode: 'binary', vote: 'hong', sent: true, submittedAt: 1 });
        if (id <= count) await assertSucceeds(write); else await assertFails(write);
        await assertFails(updateDoc(ref(db, 'control/current'), { pausedRemaining: 120 }));
        await assertFails(getDocFromServer(doc(db, 'rooms/B/control/current')));
      }
    }
    await assertFails(getDocFromServer(ref(client('judge', '1'), 'control/current')));
    for (const count of [null, '5', 4]) {
      await environment.withSecurityRulesDisabled(async context => {
        await updateDoc(ref(context.firestore(), 'control/current'), { 'config.patternJudges': count });
      });
      for (const db of judges) await assertFails(getDocFromServer(ref(db, 'control/current')));
    }
    await environment.withSecurityRulesDisabled(async context => { await deleteDoc(ref(context.firestore(), 'control/current')); });
    for (const db of judges) await assertFails(getDocFromServer(ref(db, 'meta/current')));
  } finally { await environment.cleanup(); }
});
