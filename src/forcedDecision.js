export function applyForcedDecisionState(current, { evaluationId, winner, token }) {
  if (current?.evaluationId !== evaluationId) return null;
  return {
    ...current,
    patternResult: {
      ...current.patternResult,
      scoringMode: current?.config?.scoringMode === "points" ? "points" : "binary",
      completed: true,
      winner,
      forcedDecisionToken: token,
    },
    phase: "finished",
    status: "paused",
    pausedRemaining: 0,
    phaseStartedAt: null,
  };
}
