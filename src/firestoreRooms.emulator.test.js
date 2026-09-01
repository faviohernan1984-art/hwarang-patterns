/* global process */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

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

test("Rooms Rules enforce verified room and role ownership", { skip: !emulatorHost }, async () => {
  const [host, port] = emulatorHost.split(":");
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  const environment = await initializeTestEnvironment({
    projectId: "patterns-rooms-security-test",
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
  } finally {
    await environment.cleanup();
  }
});
