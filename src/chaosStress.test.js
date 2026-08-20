import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  applyFirstBinarySubmission,
  applyFirstPointsSubmission,
  canCloseEvaluation,
  isConfigurationLocked,
  isExpectedEvaluation,
  makeFreshJudge,
  makeNextEvaluationMeta,
  makeResetEvaluationMeta,
} from "./evaluationRules.js";
import { isCurrentSendOperation, sendStatusLabel } from "./sendRecovery.js";

const side = (tech, power, rhythm) => ({ tech, power, rhythm, zero: false });
const card = (seed) => ({
  hong: side((seed % 5) + 1, (seed % 3) + 1, ((seed + 1) % 3) + 1),
  chong: side(((seed + 2) % 5) + 1, ((seed + 1) % 3) + 1, ((seed + 2) % 3) + 1),
});

test("POINTS x100 accepts exactly the first complete card without mixing payloads", (t) => {
  const started = performance.now();
  const attempts = Array.from({ length: 100 }, (_, index) => card(index));
  let judge = makeFreshJudge(1, 31);
  const statuses = [];
  for (const payload of attempts) {
    const result = applyFirstPointsSubmission(judge, 31, payload);
    statuses.push(result.status);
    judge = result.judge;
  }
  t.diagnostic(`durationMs=${(performance.now() - started).toFixed(3)} accepted=${statuses.filter((value) => value === "accepted").length}`);
  assert.equal(statuses.filter((value) => value === "accepted").length, 1);
  assert.equal(statuses.filter((value) => value === "already_sent").length, 99);
  assert.deepEqual(judge.pattern.hong, attempts[0].hong);
  assert.deepEqual(judge.pattern.chong, attempts[0].chong);
  assert.equal(judge.pattern.sent, true);
});

test("BINARY x100 alternating HONG/CHONG persists one valid first decision", (t) => {
  const started = performance.now();
  let judge = makeFreshJudge(1, 32);
  const statuses = [];
  for (let index = 0; index < 100; index += 1) {
    const result = applyFirstBinarySubmission(judge, 32, index % 2 === 0 ? "hong" : "chong");
    statuses.push(result.status);
    judge = result.judge;
  }
  t.diagnostic(`durationMs=${(performance.now() - started).toFixed(3)} accepted=${statuses.filter((value) => value === "accepted").length}`);
  assert.equal(statuses.filter((value) => value === "accepted").length, 1);
  assert.equal(judge.pattern.binary.vote, "hong");
  assert.notEqual(judge.pattern.binary.vote, "draw");
});

test("NEXT x20 from one observed generation advances exactly once", () => {
  let meta = { evaluationId: 40, config: { roundSeconds: 120 }, patternResult: { completed: true } };
  const observed = meta.evaluationId;
  let accepted = 0;
  for (let index = 0; index < 20; index += 1) {
    if (!isExpectedEvaluation(meta, observed) || meta.patternResult.completed !== true) continue;
    meta = makeNextEvaluationMeta(meta);
    accepted += 1;
  }
  assert.equal(accepted, 1);
  assert.equal(meta.evaluationId, 41);
});

test("RESET x20 rejects stale activations and erases every old submission", () => {
  let meta = { evaluationId: 50 };
  let judges = [1, 2, 3].map((id) => ({
    ...makeFreshJudge(id, 50),
    pattern: { ...makeFreshJudge(id, 50).pattern, sent: true },
  }));
  const observed = meta.evaluationId;
  let accepted = 0;
  for (let index = 0; index < 20; index += 1) {
    if (!isExpectedEvaluation(meta, observed)) continue;
    meta = makeResetEvaluationMeta(meta);
    judges = judges.map((judge) => makeFreshJudge(judge.id, meta.evaluationId));
    accepted += 1;
  }
  assert.equal(accepted, 1);
  assert.equal(meta.evaluationId, 51);
  assert.ok(judges.every((judge) => !judge.pattern.sent && !judge.pattern.binary.sent));
});

test("CLOSE x20 produces one official completion and never closes early", () => {
  const attempts = Array.from({ length: 20 });
  let completed = false;
  let accepted = 0;
  for (const _ of attempts) {
    if (!canCloseEvaluation({ time: 0, allSent: true, completed })) continue;
    completed = true;
    accepted += 1;
  }
  assert.equal(accepted, 1);
  assert.equal(completed, true);
  assert.equal(canCloseEvaluation({ time: 1, allSent: true, completed: false }), false);
  assert.equal(canCloseEvaluation({ time: 0, allSent: false, completed: false }), false);
});

test("START/PAUSE x40 keeps generation and timer state coherent", () => {
  const meta = {
    evaluationId: 60,
    evaluationStarted: false,
    status: "paused",
    phase: "fight",
    pausedRemaining: 120,
    phaseStartedAt: null,
    patternResult: { completed: false },
  };
  for (let index = 0; index < 40; index += 1) {
    if (index % 2 === 0 && meta.status !== "running") {
      meta.evaluationStarted = true;
      meta.status = "running";
      meta.phaseStartedAt = 1_000 + index;
    } else if (index % 2 === 1 && meta.status === "running") {
      meta.pausedRemaining = Math.max(0, meta.pausedRemaining - 1);
      meta.status = "paused";
      meta.phaseStartedAt = null;
    }
  }
  assert.equal(meta.evaluationId, 60);
  assert.equal(meta.status, "paused");
  assert.equal(meta.phaseStartedAt, null);
  assert.ok(meta.pausedRemaining >= 0);
});

test("active configuration rejects repeated operator changes", () => {
  const meta = { evaluationStarted: true };
  for (let index = 0; index < 100; index += 1) assert.equal(isConfigurationLocked(meta), true);
});

test("late generation and out-of-order send responses cannot regress SENT", () => {
  const next = makeNextEvaluationMeta({ evaluationId: 70, config: { roundSeconds: 120 }, patternResult: { completed: true } });
  assert.equal(applyFirstPointsSubmission(makeFreshJudge(1, 70), next.evaluationId, card(0)).status, "stale_generation");
  assert.equal(applyFirstBinarySubmission(makeFreshJudge(1, 70), next.evaluationId, "hong").status, "stale_generation");
  assert.equal(isCurrentSendOperation(101, 100), false);
  assert.equal(sendStatusLabel({ sent: true, sending: true, delayed: true, error: true }), "SENT");
  assert.equal(sendStatusLabel({ sent: false, sending: true, delayed: true, error: false }), "CONNECTION DELAYED");
});
