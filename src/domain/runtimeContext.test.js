import test from "node:test";
import assert from "node:assert/strict";
import {
  createRuntimeContext,
  HSU_PRODUCTS,
  isSameArena,
  isSameEvaluation,
  isSameMatch,
  isValidDocumentId,
  RUNTIME_ENVIRONMENTS,
} from "./runtimeContext.js";
import {
  arenaClockStatePath,
  arenaJudgeSlotPath,
  arenaMetricsPath,
  arenaPrivateControlPath,
  arenaPublicStatePath,
  evaluationPath,
  evaluationSubmissionPath,
  runtimePaths,
} from "./dataPaths.js";

const context = (overrides = {}) => createRuntimeContext({
  environment: RUNTIME_ENVIRONMENTS.TOURNAMENT,
  product: HSU_PRODUCTS.PATTERNS_GUP_PRO,
  tournamentId: "tournament-a",
  arenaId: "arena-1",
  matchId: "match-001",
  evaluationId: 1,
  ...overrides,
});

test("runtime context preserves Tournament -> Arena -> Match -> Evaluation identity", () => {
  assert.deepEqual(context(), {
    environment: "tournament",
    product: "patterns-gup-pro",
    tournamentId: "tournament-a",
    arenaId: "arena-1",
    matchId: "match-001",
    evaluationId: 1,
  });
  assert.equal(Object.isFrozen(context()), true);
});

test("runtime context rejects ambiguous or malformed identifiers", () => {
  for (const invalid of ["", " arena-1", "arena-1 ", "arena/1", null, 1]) {
    assert.equal(isValidDocumentId(invalid), false);
  }

  assert.throws(() => context({ arenaId: "arena/1" }), /arenaId/);
  assert.throws(() => context({ matchId: "" }), /matchId/);
  assert.throws(() => context({ evaluationId: 0 }), /evaluationId/);
  assert.throws(() => context({ evaluationId: "1" }), /evaluationId/);
  assert.throws(() => context({ environment: "production" }), /environment/);
  assert.throws(() => context({ product: "patterns" }), /product/);
});

test("Arena remains stable while Match and Evaluation change", () => {
  const first = context();
  const nextEvaluation = context({ evaluationId: 2 });
  const nextMatch = context({ matchId: "match-002", evaluationId: 1 });

  assert.equal(isSameArena(first, nextEvaluation), true);
  assert.equal(isSameMatch(first, nextEvaluation), true);
  assert.equal(isSameEvaluation(first, nextEvaluation), false);
  assert.equal(isSameArena(first, nextMatch), true);
  assert.equal(isSameMatch(first, nextMatch), false);
});

test("simultaneous Arenas and Tournaments never share operational identity", () => {
  const first = context();
  const otherArena = context({ arenaId: "arena-2" });
  const otherTournament = context({ tournamentId: "tournament-b" });
  const training = context({ environment: RUNTIME_ENVIRONMENTS.TRAINING });

  assert.equal(isSameArena(first, otherArena), false);
  assert.equal(isSameArena(first, otherTournament), false);
  assert.equal(isSameArena(first, training), false);
});

test("hybrid data paths keep Arena runtime separate from Match history", () => {
  assert.equal(arenaJudgeSlotPath("arena-1", "judge-3"), "arenas/arena-1/judgeSlots/judge-3");
  assert.equal(arenaPrivateControlPath("arena-1"), "arenas/arena-1/private/control");
  assert.equal(arenaPublicStatePath("arena-1"), "arenas/arena-1/public/state");
  assert.equal(arenaClockStatePath("arena-1"), "arenas/arena-1/clock/state");
  assert.equal(arenaMetricsPath("arena-1"), "arenas/arena-1/metrics/current");
  assert.equal(evaluationPath("match-001", 7), "matches/match-001/evaluations/7");
  assert.equal(
    evaluationSubmissionPath("match-001", 7, "judge-3"),
    "matches/match-001/evaluations/7/submissions/judge-3",
  );
});

test("runtime paths are derived from one validated context", () => {
  assert.deepEqual(runtimePaths(context({ evaluationId: 4 })), {
    tournament: "tournaments/tournament-a",
    arena: "arenas/arena-1",
    match: "matches/match-001",
    evaluation: "matches/match-001/evaluations/4",
    publicState: "arenas/arena-1/public/state",
    clockState: "arenas/arena-1/clock/state",
  });
});

test("path builders reject cross-segment injection and invalid generations", () => {
  assert.throws(() => arenaPublicStatePath("arena-1/public/state"), /arenaId/);
  assert.throws(() => evaluationPath("match-001", -1), /evaluationId/);
  assert.throws(() => evaluationSubmissionPath("match-001", 1, "judge/2"), /judgeSlotId/);
});
