import test from "node:test";
import assert from "node:assert/strict";
import { makePointsSubmission, makeBinarySubmission, currentSubmission, submissionToJudge } from "./submissionPayloads.js";

test("POINTS submission contains only the minimum payload", () => {
  const scores = {
    hong: { tech: 5, power: 2, rhythm: 3, zero: false },
    chong: { tech: 4, power: 3, rhythm: 2, zero: false },
  };
  assert.deepEqual(makePointsSubmission({ evaluationId: 8, judgeId: 1, scores, submittedAt: 123 }), {
    evaluationId: 8, judgeId: 1, mode: "points", scores, sent: true, submittedAt: 123,
  });
});

test("BINARY submission contains only the minimum payload", () => {
  assert.deepEqual(makeBinarySubmission({ evaluationId: 9, judgeId: 5, vote: "chong", submittedAt: 456 }), {
    evaluationId: 9, judgeId: 5, mode: "binary", vote: "chong", sent: true, submittedAt: 456,
  });
});

test("BINARY submission rehydrates vote and sent after reload", () => {
  const submission = makeBinarySubmission({ evaluationId: 4, judgeId: 1, vote: "hong", submittedAt: 1 });
  const judge = submissionToJudge(submission, 1);
  assert.deepEqual(judge.pattern.binary, { evaluationId: 4, vote: "hong", sent: true });
});

test("POINTS submission rehydrates scores and sent after reload", () => {
  const scores = {
    hong: { tech: 5, power: 2, rhythm: 3, zero: false },
    chong: { tech: 0, power: 0, rhythm: 0, zero: true },
  };
  const submission = makePointsSubmission({ evaluationId: 6, judgeId: 2, scores, submittedAt: 1 });
  const judge = submissionToJudge(submission, 2);
  assert.equal(judge.pattern.sent, true);
  assert.deepEqual(judge.pattern.hong, scores.hong);
  assert.deepEqual(judge.pattern.chong, scores.chong);
});

test("a Judge never rehydrates a submission declared for another Judge", () => {
  const submission = makeBinarySubmission({ evaluationId: 4, judgeId: 2, vote: "chong", submittedAt: 1 });
  assert.equal(submissionToJudge(submission, 1).pattern.binary.sent, false);
});

test("old submission present before evaluationId changes stays rejected", () => {
  const submission = makeBinarySubmission({ evaluationId: 3, judgeId: 1, vote: "hong", submittedAt: 1 });
  const control = { evaluationId: 4, scoringMode: "binary", judgeId: 1 };
  assert.equal(currentSubmission(submission, control), null);
  assert.equal(currentSubmission(submission, control), null);
});

test("old submission arriving after evaluationId changes stays rejected", () => {
  const control = { evaluationId: 8, scoringMode: "points", judgeId: 2 };
  const lateSubmission = makePointsSubmission({
    evaluationId: 7,
    judgeId: 2,
    scores: { hong: {}, chong: {} },
    submittedAt: 1,
  });
  assert.equal(currentSubmission(null, control), null);
  assert.equal(currentSubmission(lateSubmission, control), null);
});

test("new submission for the active evaluation rehydrates", () => {
  const submission = makeBinarySubmission({ evaluationId: 9, judgeId: 4, vote: "chong", submittedAt: 1 });
  assert.equal(currentSubmission(submission, {
    evaluationId: 9, scoringMode: "binary", judgeId: 4,
  }), submission);
});

test("submission mode must match CONTROL before rehydration", () => {
  const submission = makeBinarySubmission({ evaluationId: 9, judgeId: 4, vote: "chong", submittedAt: 1 });
  assert.equal(currentSubmission(submission, {
    evaluationId: 9, scoringMode: "points", judgeId: 4,
  }), null);
});
