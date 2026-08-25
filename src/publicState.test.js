import test from "node:test";
import assert from "node:assert/strict";
import { currentPublicState, derivePublicState, emptyPublicState, serializePublicState } from "./publicState.js";

const side = (tech, power, rhythm, zero = false) => ({ tech, power, rhythm, zero });
const pointsJudge = (id, evaluationId, hong, chong, sent = true) => ({
  id,
  pattern: {
    evaluationId,
    hong,
    chong,
    sent,
    binary: { evaluationId, vote: null, sent: false },
  },
});
const binaryJudge = (id, evaluationId, vote, sent = true) => ({
  id,
  pattern: {
    evaluationId,
    hong: side(0, 0, 0),
    chong: side(0, 0, 0),
    sent: false,
    binary: { evaluationId, vote, sent },
  },
});
const meta = ({ evaluationId = 1, scoringMode = "binary", patternJudges = 3, patternResult } = {}) => ({
  evaluationId,
  config: { scoringMode, patternJudges },
  patternResult: patternResult || { hong: 0, chong: 0, sent: 0, completed: false, winner: "en_curso" },
});

test("POINTS public payload publishes decisions but keeps aggregate at the public result", () => {
  const control = meta({ evaluationId: 4, scoringMode: "points" });
  const judges = [
    pointsJudge(1, 4, side(5, 3, 3), side(1, 1, 1)),
    pointsJudge(2, 4, side(1, 1, 1), side(5, 3, 3)),
    pointsJudge(3, 4, side(3, 2, 2), side(3, 2, 2)),
  ];

  assert.deepEqual(derivePublicState(control, judges), {
    evaluationId: 4,
    scoringMode: "points",
    judges: [
      { id: 1, sent: true, decision: "hong" },
      { id: 2, sent: true, decision: "chong" },
      { id: 3, sent: true, decision: "draw" },
    ],
    aggregate: { hong: 0, chong: 0 },
    result: { completed: false, winner: "en_curso" },
  });
});

test("BINARY public payload contains current votes and live aggregate", () => {
  const control = meta({ evaluationId: 7, scoringMode: "binary" });
  const payload = derivePublicState(control, [
    binaryJudge(1, 7, "hong"),
    binaryJudge(2, 7, "chong"),
    binaryJudge(3, 7, "hong"),
  ]);

  assert.deepEqual(payload.judges, [
    { id: 1, sent: true, decision: "hong" },
    { id: 2, sent: true, decision: "chong" },
    { id: 3, sent: true, decision: "hong" },
  ]);
  assert.deepEqual(payload.aggregate, { hong: 2, chong: 1 });
});

test("public payload follows the configured 3 or 5 Judge count", () => {
  const judges = Array.from({ length: 5 }, (_, index) => binaryJudge(index + 1, 2, "hong"));
  assert.equal(derivePublicState(meta({ evaluationId: 2, patternJudges: 3 }), judges).judges.length, 3);
  assert.equal(derivePublicState(meta({ evaluationId: 2, patternJudges: 5 }), judges).judges.length, 5);
});

test("Public rejects a payload from another evaluationId or scoringMode", () => {
  const control = meta({ evaluationId: 8, scoringMode: "points" });
  const valid = derivePublicState(control, []);
  assert.equal(currentPublicState(control, valid), valid);
  assert.deepEqual(currentPublicState(control, { ...valid, evaluationId: 7 }), emptyPublicState(control));
  assert.deepEqual(currentPublicState(control, { ...valid, scoringMode: "binary" }), emptyPublicState(control));
});

test("NEXT and RESET project a new empty generation without deleting old submissions", () => {
  const oldJudges = [
    pointsJudge(1, 3, side(5, 3, 3), side(1, 1, 1)),
    pointsJudge(2, 3, side(5, 3, 3), side(1, 1, 1)),
    pointsJudge(3, 3, side(5, 3, 3), side(1, 1, 1)),
  ];
  const nextPayload = derivePublicState(meta({ evaluationId: 4, scoringMode: "points" }), oldJudges);
  const resetPayload = derivePublicState(meta({ evaluationId: 4, scoringMode: "binary" }), oldJudges);

  assert.ok(nextPayload.judges.every((judge) => !judge.sent && judge.decision === null));
  assert.ok(resetPayload.judges.every((judge) => !judge.sent && judge.decision === null));
  assert.deepEqual(nextPayload.aggregate, { hong: 0, chong: 0 });
  assert.deepEqual(resetPayload.aggregate, { hong: 0, chong: 0 });
});

test("CLOSE and Force or Draw publish the public result", () => {
  const close = derivePublicState(meta({
    evaluationId: 5,
    scoringMode: "points",
    patternResult: { hong: 24, chong: 20, sent: 3, completed: true, winner: "hong" },
  }), []);
  const forced = derivePublicState(meta({
    evaluationId: 5,
    scoringMode: "binary",
    patternResult: { completed: true, winner: "chong" },
  }), []);
  const draw = derivePublicState(meta({
    evaluationId: 5,
    scoringMode: "points",
    patternResult: { completed: true, winner: "draw" },
  }), []);

  assert.deepEqual(close.aggregate, { hong: 24, chong: 20 });
  assert.deepEqual(close.result, { completed: true, winner: "hong" });
  assert.deepEqual(forced.result, { completed: true, winner: "chong" });
  assert.deepEqual(draw.result, { completed: true, winner: "draw" });
});

test("identical public payloads serialize to the same deduplication token", () => {
  const payload = derivePublicState(meta(), []);
  assert.equal(serializePublicState(payload), serializePublicState(structuredClone(payload)));
});
