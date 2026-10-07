/* global process */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc } from "firebase/firestore";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (emulatorHost && emulatorHost !== '127.0.0.1:8080') throw new Error('Rules tests require 127.0.0.1:8080');
if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== 'demo-patterns-gups') throw new Error('Rules tests require demo-patterns-gups');

const competitor = (label) => ({ label, name: label, club: "" });
const control = ({ evaluationId = 1, ...overrides } = {}) => ({
  evaluationId, status: "paused", phase: "fight", phaseStartedAt: null, pausedRemaining: 120,
  config: { roundSeconds: 120, patternJudges: 3, scoringMode: "binary" },
  hong: competitor("HONG"), chong: competitor("CHONG"), publicSwapSides: false, ...overrides,
});
const binary = ({ judgeId = 1, ...overrides } = {}) => ({
  evaluationId: 1, judgeId, mode: "binary", vote: "hong", sent: true, submittedAt: 1, ...overrides,
});
const publicState = () => ({
  evaluationId: 1, scoringMode: "binary",
  judges: Array.from({ length: 3 }, (_, index) => ({ id: index + 1, sent: false, decision: null })),
  aggregate: { hong: 0, chong: 0 }, result: { completed: false, winner: "en_curso" },
});
const legacyMeta = () => ({
  presidentSwapSides: false,
  patternResult: { hong: 0, chong: 0, sent: 0, completed: false, winner: "en_curso" },
});

test("Rooms Rules enforce verified room and role ownership", { skip: !emulatorHost }, async t => {
  const [host, port] = emulatorHost.split(":");
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  const environment = await initializeTestEnvironment({
    projectId: "demo-patterns-gups",
    firestore: { host, port: Number(port), rules },
  });
  const ref = (database, roomId, collection, id = "current") => doc(database, `rooms/${roomId}/${collection}/${id}`);

  try {
    await environment.withSecurityRulesDisabled(async (context) => {
      const admin = context.firestore();
      for (const roomId of ["A", "B"]) {
        await setDoc(ref(admin, roomId, "control"), control());
        await setDoc(ref(admin, roomId, "meta"), legacyMeta());
        await setDoc(ref(admin, roomId, "publicState"), publicState());
      }
    });

    const presidentA = environment.authenticatedContext("president-a", { roomId: "A", role: "president" }).firestore();
    const publicA = environment.authenticatedContext("public-a", { roomId: "A", role: "public" }).firestore();
    const judgeA2 = environment.authenticatedContext("judge-a-2", { roomId: "A", role: "judge", judgeId: 2 }).firestore();
    const judgeA3 = environment.authenticatedContext("judge-a-3", { roomId: "A", role: "judge", judgeId: 3 }).firestore();
    const anonymous = environment.unauthenticatedContext().firestore();

    await assertSucceeds(getDoc(ref(presidentA, "A", "control")));
    await assertFails(getDoc(ref(presidentA, "B", "control")));
    await assertSucceeds(setDoc(ref(presidentA, "A", "control"), control({ status: "running", phaseStartedAt: 10 })));
    await assertSucceeds(setDoc(ref(presidentA, "A", "meta"), legacyMeta()));
    await assertSucceeds(setDoc(ref(presidentA, "A", "publicState"), publicState()));
    await assertFails(setDoc(ref(presidentA, "A", "control"), control({ status: "invalid" })));
    await assertFails(setDoc(ref(presidentA, "A", "control"), control({ evaluationId: 3 })));
    await assertFails(setDoc(ref(presidentA, "A", "publicState"), { ...publicState(), evaluationId: 2 }));

    await assertSucceeds(getDoc(ref(publicA, "A", "control")));
    await assertSucceeds(getDoc(ref(publicA, "A", "publicState")));
    await assertFails(getDoc(ref(publicA, "A", "meta")));
    await assertFails(setDoc(ref(publicA, "A", "control"), control()));
    await assertFails(setDoc(ref(publicA, "A", "meta"), legacyMeta()));
    await assertFails(setDoc(ref(publicA, "A", "publicState"), publicState()));
    await assertFails(setDoc(ref(publicA, "A", "submissions", "1"), binary()));

    await assertSucceeds(getDoc(ref(judgeA2, "A", "control")));
    await assertSucceeds(getDoc(ref(judgeA2, "A", "meta")));
    await assertSucceeds(setDoc(ref(judgeA2, "A", "submissions", "2"), binary({ judgeId: 2 })));
    await assertFails(setDoc(ref(judgeA2, "A", "submissions", "3"), binary({ judgeId: 3 })));
    await assertFails(setDoc(ref(judgeA2, "B", "submissions", "2"), binary({ judgeId: 2 })));
    await assertFails(setDoc(ref(judgeA2, "A", "submissions", "2"), binary({ judgeId: 2, evaluationId: 2 })));
    await assertFails(setDoc(ref(judgeA2, "A", "submissions", "2"), binary({ judgeId: 2, mode: "points" })));
    await assertFails(getDoc(ref(judgeA2, "A", "submissions", "3")));
    await assertSucceeds(getDoc(ref(judgeA3, "A", "submissions", "3")));

    await assertFails(setDoc(ref(anonymous, "new-room", "control"), control()));
    await assertFails(setDoc(ref(anonymous, "new-room", "meta"), legacyMeta()));
    assert.equal((await getDoc(ref(presidentA, "A", "control"))).exists(), true);
    await t.test('anonymous, missing and invalid claims deny private reads and writes', async () => {
      const invalid = [anonymous, ...[{}, { role: 'president' }, { roomId: 'A' },
        { roomId: 'A', role: 'admin' }, { roomId: 'C', role: 'president' },
        { roomId: 1, role: 'president' }].map((claims, i) => environment.authenticatedContext('invalid-' + i, claims).firestore())];
      for (const db of invalid) {
        for (const collection of ['control', 'meta', 'publicState', 'submissions', 'judges']) {
          const id = ['submissions', 'judges'].includes(collection) ? '2' : 'current';
          await assertFails(getDoc(ref(db, 'A', collection, id)));
          await assertFails(setDoc(ref(db, 'A', collection, id), collection === 'control' ? control() : legacyMeta()));
        }
      }
    });
    await t.test('all roles are isolated in both A to B and B to A directions', async () => {
      for (const [own, other] of [['A', 'B'], ['B', 'A']]) {
        for (const role of ['president', 'public', 'judge']) {
          const db = environment.authenticatedContext('cross-' + own + role, { roomId: own, role, ...(role === 'judge' ? { judgeId: 2 } : {}) }).firestore();
          for (const collection of ['control', 'meta', 'publicState', 'submissions', 'judges']) {
            const id = ['submissions', 'judges'].includes(collection) ? '2' : 'current';
            const target = ref(db, other, collection, id);
            await assertFails(getDoc(target));
            await assertFails(setDoc(target, collection === 'control' ? control() : collection === 'meta' ? legacyMeta() : collection === 'publicState' ? publicState() : binary({ judgeId: 2 })));
            await assertFails(deleteDoc(target));
          }
        }
      }
    });
    await t.test('journals and unknown paths deny every client role', async () => {
      const paths = ['_localRoomProvisioning/A', '_localPresidentAssignments/test-uid',
        '_roomProvisioning/A', '_presidentAssignments/test-uid', 'unknown/doc',
        'rooms/A/unknown/doc', 'rooms/A/control/other', 'rooms/A'];
      await environment.withSecurityRulesDisabled(async context => {
        for (const path of paths) await setDoc(doc(context.firestore(), path), { status: 'pending' });
      });
      for (const db of [anonymous, presidentA, publicA, judgeA2]) {
        for (const path of paths) {
          const target = doc(db, path);
          await assertFails(getDoc(target));
          await assertFails(setDoc(target, { status: 'complete', roomId: 'A', role: 'president' }));
          await assertFails(deleteDoc(target));
        }
      }
    });
    await t.test('President can update own control and meta but cannot create or delete them', async () => {
      await assertSucceeds(setDoc(ref(presidentA, 'A', 'control'), control()));
      await assertSucceeds(setDoc(ref(presidentA, 'A', 'meta'), legacyMeta()));
      const fresh = environment.authenticatedContext('fresh-president', { roomId: 'fresh', role: 'president' }).firestore();
      await assertFails(setDoc(ref(fresh, 'fresh', 'control'), control()));
      await assertFails(setDoc(ref(fresh, 'fresh', 'meta'), legacyMeta()));
      for (const db of [presidentA, publicA, judgeA2, anonymous]) {
        for (const collection of ['control', 'meta', 'publicState', 'submissions', 'judges']) {
          await assertFails(deleteDoc(ref(db, 'A', collection, ['submissions', 'judges'].includes(collection) ? '2' : 'current')));
        }
      }
    });
    await t.test('Judge permissions cannot escalate via document fields or claim types', async () => {
      await assertFails(setDoc(ref(judgeA2, 'A', 'control'), control()));
      await assertFails(setDoc(ref(judgeA2, 'A', 'meta'), legacyMeta()));
      await assertFails(setDoc(ref(judgeA2, 'A', 'publicState'), publicState()));
      await assertFails(setDoc(ref(judgeA2, 'A', 'judges', '2'), { id: 2, pattern: { evaluationId: 1, binary: { evaluationId: 1, sent: true } } }));
      await assertFails(setDoc(ref(judgeA2, 'A', 'submissions', '2'), { ...binary({ judgeId: 2 }), role: 'president', roomId: 'B' }));
      await assertFails(getDoc(ref(judgeA2, 'A', 'publicState')));
      for (const judgeId of [undefined, '2', 0, 6]) {
        const db = environment.authenticatedContext('bad-judge-' + String(judgeId), { roomId: 'A', role: 'judge', ...(judgeId === undefined ? {} : { judgeId }) }).firestore();
        await assertFails(getDoc(ref(db, 'A', 'submissions', '2')));
        await assertFails(setDoc(ref(db, 'A', 'submissions', '2'), binary({ judgeId: 2 })));
      }
    });
    await t.test('President publishes own judge projection but cannot write Judge submissions', async () => {
      const projection = { id: 2, pattern: { evaluationId: 1, binary: { evaluationId: 1, sent: true } } };
      await assertSucceeds(setDoc(ref(presidentA, 'A', 'judges', '2'), projection));
      await assertSucceeds(getDoc(ref(presidentA, 'A', 'judges', '2')));
      await assertSucceeds(getDoc(ref(judgeA2, 'A', 'judges', '2')));
      await assertFails(getDoc(ref(judgeA3, 'A', 'judges', '2')));
      await assertFails(setDoc(ref(presidentA, 'A', 'judges', '2'), { ...projection, id: 3 }));
      await assertFails(setDoc(ref(presidentA, 'A', 'submissions', '2'), binary({ judgeId: 2 })));
      await assertSucceeds(getDoc(ref(presidentA, 'A', 'submissions', '2')));
    });
    await t.test('Public reads only own control and publicState and writes no Room resources', async () => {
      for (const collection of ['control', 'meta', 'publicState', 'submissions', 'judges']) {
        const id = ['submissions', 'judges'].includes(collection) ? '2' : 'current';
        if (['control', 'publicState'].includes(collection)) await assertSucceeds(getDoc(ref(publicA, 'A', collection, id)));
        else await assertFails(getDoc(ref(publicA, 'A', collection, id)));
        await assertFails(setDoc(ref(publicA, 'A', collection, id), collection === 'control' ? control() : collection === 'publicState' ? publicState() : binary({ judgeId: 2 })));
      }
    });
    await t.test('legacy matches denies President, Judge and Public reads and writes', async () => {
      const paths = ['matches/legacy', 'matches/legacy/judges/1',
        'matches/legacy/public/state', 'matches/legacy/clock/state', 'matches/legacy/unknown/doc'];
      await environment.withSecurityRulesDisabled(async context => {
        for (const path of paths) await setDoc(doc(context.firestore(), path), { evaluationId: 1 });
      });
      const legacyRoles = ['president', 'judge', 'public'].map(role =>
        environment.authenticatedContext('legacy-' + role, { matchId: 'legacy', role, judgeId: '1' }).firestore());
      for (const db of [...legacyRoles, presidentA, publicA, judgeA2, anonymous]) {
        for (const path of paths) {
          const target = doc(db, path);
          await assertFails(getDoc(target));
          await assertFails(setDoc(target, { evaluationId: 2 }));
          await assertFails(deleteDoc(target));
        }
        await assertFails(setDoc(doc(db, 'matches/new-match'), { evaluationId: 1 }));
        await assertFails(setDoc(doc(db, 'matches/legacy/judges/2'), { id: 2 }));
      }
    });

  } finally {
    await environment.cleanup();
  }
});
