import test from "node:test";
import assert from "node:assert/strict";
import { applyForcedDecisionState } from "./forcedDecision.js";

const evaluation = (evaluationId) => ({
  evaluationId,
  config: { scoringMode: "binary" },
  status: "paused",
  phase: "fight",
  pausedRemaining: 120,
  phaseStartedAt: null,
  patternResult: { completed: false, winner: "en_curso" },
});

test("Forced Decision persists within the evaluation where it started", () => {
  const next = applyForcedDecisionState(evaluation(7), {
    evaluationId: 7,
    winner: "hong",
    token: "force-7",
  });

  assert.equal(next.evaluationId, 7);
  assert.equal(next.patternResult.completed, true);
  assert.equal(next.patternResult.winner, "hong");
  assert.equal(next.patternResult.forcedDecisionToken, "force-7");
  assert.equal(next.phase, "finished");
});

test("Forced Decision from evaluation N is rejected after NEXT advances to N+1", () => {
  assert.equal(applyForcedDecisionState(evaluation(8), {
    evaluationId: 7,
    winner: "chong",
    token: "late-next",
  }), null);
});

test("Forced Decision from evaluation N is rejected after RESET advances to N+1", () => {
  assert.equal(applyForcedDecisionState(evaluation(8), {
    evaluationId: 7,
    winner: "draw",
    token: "late-reset",
  }), null);
});
