import test from "node:test";
import assert from "node:assert/strict";
import { patternSummary } from "./patternSummary.js";

const meta = (evaluationId, patternJudges = 3) => ({ evaluationId, config: { patternJudges }, patternResult: { completed: false } });
const submission = (evaluationId, hong, chong) => ({
  pattern: {
    evaluationId,
    sent: true,
    hong: { tech: hong, power: 0, rhythm: 0, zero: false },
    chong: { tech: chong, power: 0, rhythm: 0, zero: false },
  },
});

test("Points counts submissions from the current evaluation", () => {
  const judges = [submission(2, 5, 3), submission(2, 4, 2), submission(2, 1, 3)];
  assert.deepEqual(patternSummary(meta(2), judges), { hong: 10, chong: 8, sent: 3, winner: "hong" });
});

test("Points ignores a submission from an old evaluation", () => {
  const judges = [submission(1, 50, 0), submission(2, 4, 2), submission(2, 1, 3)];
  assert.deepEqual(patternSummary(meta(2), judges), { hong: 5, chong: 5, sent: 2, winner: "en_curso" });
});

test("a SEND captured before NEXT does not count after evaluationId advances", () => {
  const judges = [submission(7, 10, 0), submission(8, 2, 3), submission(8, 4, 1)];
  assert.equal(patternSummary(meta(8), judges).sent, 2);
});

test("Points keeps five-Judge aggregation generational", () => {
  const judges = [
    submission(4, 5, 1), submission(4, 4, 2), submission(4, 3, 2),
    submission(4, 2, 3), submission(3, 100, 0),
  ];
  assert.deepEqual(patternSummary(meta(4, 5), judges), { hong: 14, chong: 8, sent: 4, winner: "en_curso" });
});
