import test from "node:test";
import assert from "node:assert/strict";
import { currentPatternHasZero, currentPatternTotalsForJudge, isCurrentPatternSubmission, isPatternSideComplete, patternSummary } from "./patternSummary.js";

const meta = (evaluationId, patternJudges = 3) => ({ evaluationId, config: { patternJudges }, patternResult: { completed: false } });
const submission = (evaluationId, hong, chong) => ({
  pattern: {
    evaluationId,
    sent: true,
    hong: { tech: hong, power: 0, rhythm: 0, zero: false },
    chong: { tech: chong, power: 0, rhythm: 0, zero: false },
  },
});

const emptySide = () => ({ tech: 0, power: 0, rhythm: 0, zero: false });
const completeSide = () => ({ tech: 5, power: 3, rhythm: 3, zero: false });

test("Points side completion requires every stage or Absolute Zero", () => {
  assert.equal(isPatternSideComplete(emptySide()), false, "empty");
  assert.equal(isPatternSideComplete({ ...emptySide(), tech: 1 }), false, "one stage");
  assert.equal(isPatternSideComplete({ ...emptySide(), tech: 1, power: 1 }), false, "two stages");
  assert.equal(isPatternSideComplete(completeSide()), true, "all stages");
  assert.equal(isPatternSideComplete({ ...emptySide(), zero: true }), true, "Absolute Zero");
  assert.equal(isPatternSideComplete({ ...completeSide(), rhythm: 0 }), false, "deselected stage");
});

test("Points evaluation requires both sides to be complete", () => {
  const patternComplete = (hong, chong) => isPatternSideComplete(hong) && isPatternSideComplete(chong);
  const zeroSide = { ...emptySide(), zero: true };

  assert.equal(patternComplete(emptySide(), emptySide()), false, "empty");
  assert.equal(patternComplete(completeSide(), emptySide()), false, "Hong complete");
  assert.equal(patternComplete(emptySide(), completeSide()), false, "Chong complete");
  assert.equal(patternComplete(completeSide(), completeSide()), true, "both scored");
  assert.equal(patternComplete(zeroSide, completeSide()), true, "Hong Absolute Zero");
  assert.equal(patternComplete(completeSide(), zeroSide), true, "Chong Absolute Zero");
  assert.equal(patternComplete(zeroSide, zeroSide), true, "both Absolute Zero");
});

test("a new evaluation after NEXT or RESET is incomplete", () => {
  const nextPattern = { hong: emptySide(), chong: emptySide() };
  const resetPattern = { hong: emptySide(), chong: emptySide() };

  assert.equal(isPatternSideComplete(nextPattern.hong) && isPatternSideComplete(nextPattern.chong), false);
  assert.equal(isPatternSideComplete(resetPattern.hong) && isPatternSideComplete(resetPattern.chong), false);
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

test("President keeps an old Points submission pending and visually empty after NEXT", () => {
  const historicalSubmission = submission(3, 9, 6);
  historicalSubmission.pattern.hong.zero = true;
  const currentMeta = meta(4);

  assert.equal(isCurrentPatternSubmission(currentMeta, historicalSubmission), false);
  assert.deepEqual(currentPatternTotalsForJudge(currentMeta, historicalSubmission), { hong: 0, chong: 0 });
  assert.equal(currentPatternHasZero(currentMeta, historicalSubmission, "hong"), false);
  assert.deepEqual(patternSummary(currentMeta, [historicalSubmission]), {
    hong: 0,
    chong: 0,
    sent: 0,
    winner: "en_curso",
  });
});

test("Points keeps five-Judge aggregation generational", () => {
  const judges = [
    submission(4, 5, 1), submission(4, 4, 2), submission(4, 3, 2),
    submission(4, 2, 3), submission(3, 100, 0),
  ];
  assert.deepEqual(patternSummary(meta(4, 5), judges), { hong: 14, chong: 8, sent: 4, winner: "en_curso" });
});
