import test from "node:test";
import assert from "node:assert/strict";
import {
  applyFirstBinarySubmission,
  applyFirstPointsSubmission,
  applyJudgeCountChange,
  canPrepareNext,
  canCloseEvaluation,
  isConfigurationLocked,
  isEvaluationOpen,
  isExpectedEvaluation,
  isValidPointsSubmission,
  makeFreshJudge,
  makeNextEvaluationMeta,
  makeResetEvaluationMeta,
  pointsSummary,
} from "./evaluationRules.js";

const side = (tech = 5, power = 3, rhythm = 3) => ({ tech, power, rhythm, zero: false });
const zeroSide = () => ({ tech: 0, power: 0, rhythm: 0, zero: true });
const card = (hong = side(), chong = side(4, 2, 2)) => ({ hong, chong });

test("POINTS rejects an empty card", () => {
  assert.equal(isValidPointsSubmission(card(side(0, 0, 0), side(0, 0, 0))), false);
});

test("POINTS accepts a complete card", () => {
  assert.equal(isValidPointsSubmission(card()), true);
});

test("POINTS accepts absolute zero only with all numeric fields at zero", () => {
  assert.equal(isValidPointsSubmission(card(zeroSide(), side())), true);
  assert.equal(isValidPointsSubmission(card({ ...zeroSide(), tech: 1 }, side())), false);
});

test("POINTS rejects strings, floats, negatives, Infinity and out-of-range values", () => {
  for (const invalidHong of [
    side("5", 3, 3), side(2.5, 3, 3), side(-1, 3, 3), side(Infinity, 3, 3),
    side(6, 3, 3), side(5, 4, 3), side(5, 3, 4),
  ]) {
    assert.equal(isValidPointsSubmission(card(invalidHong, side())), false);
  }
});

test("POINTS first valid submission is immutable", () => {
  const initial = makeFreshJudge(1, 7);
  const first = applyFirstPointsSubmission(initial, 7, card());
  assert.equal(first.status, "accepted");
  const second = applyFirstPointsSubmission(first.judge, 7, card(side(1, 1, 1), side(1, 1, 1)));
  assert.equal(second.status, "already_sent");
  assert.deepEqual(second.judge.pattern.hong, first.judge.pattern.hong);
});

test("POINTS rejects an old generation", () => {
  assert.equal(applyFirstPointsSubmission(makeFreshJudge(1, 8), 7, card()).status, "stale_generation");
});

test("BINARY first vote is accepted and a second vote cannot overwrite it", () => {
  const first = applyFirstBinarySubmission(makeFreshJudge(1, 4), 4, "hong");
  assert.equal(first.status, "accepted");
  const second = applyFirstBinarySubmission(first.judge, 4, "chong");
  assert.equal(second.status, "already_sent");
  assert.equal(second.judge.pattern.binary.vote, "hong");
});

test("BINARY rejects old generations and DRAW", () => {
  assert.equal(applyFirstBinarySubmission(makeFreshJudge(1, 5), 4, "hong").status, "stale_generation");
  assert.equal(applyFirstBinarySubmission(makeFreshJudge(1, 5), 5, "draw").status, "invalid");
});

test("configuration is locked from START through completed until NEXT or RESET", () => {
  assert.equal(isConfigurationLocked({ evaluationStarted: false }), false);
  assert.equal(isConfigurationLocked({ evaluationStarted: true, patternResult: { completed: false } }), true);
  assert.equal(isConfigurationLocked({ evaluationStarted: true, patternResult: { completed: true } }), true);
});

test("submission is blocked before START, allowed after 00:00, and blocked after completed", () => {
  assert.equal(isEvaluationOpen({ evaluationId: 2, evaluationStarted: false, patternResult: { completed: false } }, 2), false);
  assert.equal(isEvaluationOpen({ evaluationId: 2, evaluationStarted: true, phase: "finished", pausedRemaining: 0, patternResult: { completed: false } }, 2), true);
  assert.equal(isEvaluationOpen({ evaluationId: 2, evaluationStarted: true, patternResult: { completed: true } }, 2), false);
});

test("generation checks reject missing or malformed evaluation identifiers", () => {
  assert.equal(isEvaluationOpen({ evaluationId: 1, evaluationStarted: true, patternResult: { completed: false } }), false);
  assert.equal(isExpectedEvaluation({ evaluationId: 1 }, "1"), false);
  assert.equal(applyFirstPointsSubmission({ ...makeFreshJudge(1, 1), pattern: { ...makeFreshJudge(1, 1).pattern, evaluationId: undefined } }, 1, card()).status, "stale_generation");
  assert.equal(applyFirstBinarySubmission(makeFreshJudge(1, 1), undefined, "hong").status, "stale_generation");
});

for (const mode of ["POINTS", "BINARY"]) {
  test(`${mode} CLOSE rejects all sent while time is running`, () => {
    assert.equal(canCloseEvaluation({ time: 1, allSent: true, completed: false }), false);
  });

  test(`${mode} CLOSE rejects missing valid submissions at zero`, () => {
    assert.equal(canCloseEvaluation({ time: 0, allSent: false, completed: false }), false);
  });

  test(`${mode} CLOSE allows all valid submissions at zero`, () => {
    assert.equal(canCloseEvaluation({ time: 0, allSent: true, completed: false }), true);
  });

  test(`${mode} CLOSE rejects an already completed evaluation`, () => {
    assert.equal(canCloseEvaluation({ time: 0, allSent: true, completed: true }), false);
  });
}

test("BINARY mathematical majority before zero cannot close", () => {
  assert.equal(canCloseEvaluation({ time: 30, allSent: false, completed: false }), false);
});

test("judge count cannot change from 5 to 3 during an active evaluation", () => {
  const meta = { evaluationStarted: true, config: { patternJudges: 5 } };
  const result = applyJudgeCountChange(meta, 3);
  assert.equal(result.status, "locked");
  assert.equal(result.meta.config.patternJudges, 5);
});

test("NEXT preserves configuration, increments evaluationId and prepares a clean state", () => {
  const current = {
    evaluationId: 10,
    evaluationStarted: true,
    config: { roundSeconds: 180, patternJudges: 5, scoringMode: "points" },
    hong: { name: "A" },
    chong: { name: "B" },
    publicSwapSides: true,
    presidentSwapSides: true,
    patternResult: { completed: true, winner: "hong" },
  };
  const next = makeNextEvaluationMeta(current);
  assert.equal(next.evaluationId, 11);
  assert.deepEqual(next.config, current.config);
  assert.equal(next.pausedRemaining, 180);
  assert.equal(next.evaluationStarted, false);
  assert.equal(next.patternResult.completed, false);
  assert.equal(next.publicSwapSides, true);
  assert.equal(canPrepareNext(current), true);
  assert.equal(canPrepareNext(next), false);
});

test("a late POINTS vote cannot enter the generation prepared by NEXT", () => {
  const next = makeNextEvaluationMeta({
    evaluationId: 10,
    config: { roundSeconds: 120, patternJudges: 3, scoringMode: "points" },
  });
  const oldJudge = makeFreshJudge(1, 10);
  assert.equal(applyFirstPointsSubmission(oldJudge, next.evaluationId, card()).status, "stale_generation");
});

test("RESET restores defaults, increments evaluationId and clears the evaluation", () => {
  const reset = makeResetEvaluationMeta({ evaluationId: 22 });
  assert.equal(reset.evaluationId, 23);
  assert.deepEqual(reset.config, { roundSeconds: 120, patternJudges: 3, scoringMode: "binary" });
  assert.equal(reset.evaluationStarted, false);
  assert.equal(reset.patternResult.completed, false);
});

test("fresh judges for NEXT/RESET contain no votes and carry the new generation", () => {
  const judge = makeFreshJudge(3, 12);
  assert.equal(judge.pattern.evaluationId, 12);
  assert.equal(judge.pattern.sent, false);
  assert.equal(judge.pattern.binary.evaluationId, 12);
  assert.equal(judge.pattern.binary.sent, false);
});

test("POINTS summary requires every active judge valid and current", () => {
  const meta = { evaluationId: 3 };
  const judges = [1, 2, 3].map((id) => applyFirstPointsSubmission(makeFreshJudge(id, 3), 3, card()).judge);
  const complete = pointsSummary(meta, judges, 3);
  assert.equal(complete.allSent, true);
  assert.equal(complete.sent, 3);
  assert.equal(complete.winner, "hong");

  judges[2] = makeFreshJudge(3, 2);
  const stale = pointsSummary(meta, judges, 3);
  assert.equal(stale.allSent, false);
  assert.equal(stale.winner, "en_curso");
});

test("POINTS summary ignores invalid cards and calculates DRAW exactly", () => {
  const meta = { evaluationId: 6 };
  const equalCard = card(side(3, 2, 1), side(3, 2, 1));
  const judges = [1, 2, 3].map((id) => applyFirstPointsSubmission(makeFreshJudge(id, 6), 6, equalCard).judge);
  assert.equal(pointsSummary(meta, judges, 3).winner, "draw");

  judges[2] = {
    ...judges[2],
    pattern: { ...judges[2].pattern, hong: side("3", 2, 1) },
  };
  assert.deepEqual(pointsSummary(meta, judges, 3), {
    hong: 12, chong: 12, sent: 2, allSent: false, winner: "en_curso",
  });
});

test("rapid duplicate submissions preserve the first accepted payload", () => {
  const initial = makeFreshJudge(1, 9);
  const attempts = Array.from({ length: 20 }, (_, index) => index === 0 ? "hong" : "chong");
  const final = attempts.reduce((judge, vote) => applyFirstBinarySubmission(judge, 9, vote).judge, initial);
  assert.equal(final.pattern.binary.vote, "hong");
});

test("twenty rapid POINTS attempts preserve the first accepted card", () => {
  const initial = makeFreshJudge(1, 14);
  const firstCard = card(side(5, 3, 3), side(1, 1, 1));
  const replacement = card(side(1, 1, 1), side(5, 3, 3));
  const attempts = Array.from({ length: 20 }, (_, index) => index === 0 ? firstCard : replacement);
  const final = attempts.reduce((judge, submitted) => applyFirstPointsSubmission(judge, 14, submitted).judge, initial);
  assert.deepEqual(final.pattern.hong, firstCard.hong);
  assert.deepEqual(final.pattern.chong, firstCard.chong);
});
