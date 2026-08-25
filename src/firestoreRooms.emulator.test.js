import test from "node:test";
import assert from "node:assert/strict";
import { connectFirestoreEmulator, deleteDoc, getDoc, setDoc, terminate } from "firebase/firestore";
import { db, roomControlRef, roomJudgeRef, roomMetaRef, roomPublicStateRef, roomSubmissionRef } from "./firebase.js";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

const competitor = (label) => ({ label, name: label, club: "" });
const control = ({ evaluationId = 1, scoringMode = "binary", patternJudges = 3, ...overrides } = {}) => ({
  evaluationId,
  status: "paused",
  phase: "fight",
  phaseStartedAt: null,
  pausedRemaining: 120,
  config: { roundSeconds: 120, patternJudges, scoringMode },
  hong: competitor("HONG"),
  chong: competitor("CHONG"),
  publicSwapSides: false,
  ...overrides,
});
const binary = ({ evaluationId = 1, judgeId = 1, ...overrides } = {}) => ({
  evaluationId, judgeId, mode: "binary", vote: "hong", sent: true, submittedAt: 1, ...overrides,
});
const side = () => ({ tech: 1, power: 1, rhythm: 1, zero: false });
const points = ({ evaluationId = 1, judgeId = 1, ...overrides } = {}) => ({
  evaluationId, judgeId, mode: "points", scores: { hong: side(), chong: side() }, sent: true, submittedAt: 1, ...overrides,
});
const publicState = ({ evaluationId = 1, scoringMode = "binary", judgeCount = 3, ...overrides } = {}) => ({
  evaluationId,
  scoringMode,
  judges: Array.from({ length: judgeCount }, (_, index) => ({ id: index + 1, sent: false, decision: null })),
  aggregate: { hong: 0, chong: 0 },
  result: { completed: false, winner: "en_curso" },
  ...overrides,
});
const denied = (promise) => assert.rejects(promise, (error) => error?.code === "permission-denied");

test("Rooms enforce generation, mode, shape, active Judges and room isolation", { skip: !emulatorHost }, async () => {
  const [host, port] = emulatorHost.split(":");
  connectFirestoreEmulator(db, host, Number(port));

  try {
    await setDoc(roomControlRef("A"), control());
    await setDoc(roomControlRef("B"), control({ evaluationId: 7, scoringMode: "points", patternJudges: 5 }));

    await setDoc(roomSubmissionRef("A", 1), binary());
    await setDoc(roomControlRef("A"), control({ scoringMode: "points" }));
    await setDoc(roomSubmissionRef("A", 1), points());
    await setDoc(roomSubmissionRef("A", 2), points({ judgeId: 2 }));

    await denied(setDoc(roomSubmissionRef("A", 1), points({ evaluationId: 0 })));
    await denied(setDoc(roomSubmissionRef("A", 1), binary()));
    await denied(setDoc(roomSubmissionRef("A", 6), points({ judgeId: 6 })));
    await denied(setDoc(roomSubmissionRef("A", 1), points({ judgeId: 2 })));
    await denied(setDoc(roomSubmissionRef("A", 4), points({ judgeId: 4 })));
    await denied(setDoc(roomSubmissionRef("A", 1), { ...points(), extra: true }));
    const { submittedAt, ...incomplete } = points();
    assert.equal(submittedAt, 1);
    await denied(setDoc(roomSubmissionRef("A", 1), incomplete));

    await setDoc(roomPublicStateRef("A"), publicState({ scoringMode: "points" }));
    await denied(setDoc(roomPublicStateRef("A"), publicState({ evaluationId: 2, scoringMode: "points" })));
    await denied(setDoc(roomPublicStateRef("A"), publicState({ scoringMode: "binary" })));
    await denied(setDoc(roomPublicStateRef("A"), publicState({ scoringMode: "points", aggregate: { hong: -1, chong: 0 } })));

    await setDoc(roomControlRef("A"), control({ evaluationId: 2, scoringMode: "points" }));
    await denied(setDoc(roomSubmissionRef("A", 3), points({ judgeId: 3 })));
    await setDoc(roomSubmissionRef("A", 3), points({ evaluationId: 2, judgeId: 3 }));
    await denied(setDoc(roomControlRef("A"), control({ evaluationId: 1, scoringMode: "points" })));
    await denied(setDoc(roomControlRef("A"), control({ evaluationId: 4, scoringMode: "points" })));
    await denied(setDoc(roomControlRef("A"), control({ evaluationId: 2, scoringMode: "points", status: "invalid" })));
    await denied(setDoc(roomControlRef("A"), control({ evaluationId: 2, scoringMode: "other" })));

    assert.equal((await getDoc(roomControlRef("A"))).data().evaluationId, 2);
    assert.equal((await getDoc(roomControlRef("B"))).data().evaluationId, 7);
    await setDoc(roomSubmissionRef("B", 5), points({ evaluationId: 7, judgeId: 5 }));
    await setDoc(roomPublicStateRef("B"), publicState({
      evaluationId: 7, scoringMode: "points", judgeCount: 5,
    }));

    await denied(deleteDoc(roomSubmissionRef("A", 1)));
    await denied(deleteDoc(roomPublicStateRef("A")));
    await denied(deleteDoc(roomControlRef("A")));
    await denied(deleteDoc(roomMetaRef("A")));
    await denied(deleteDoc(roomJudgeRef("A", 1)));
  } finally {
    await terminate(db);
  }
});
