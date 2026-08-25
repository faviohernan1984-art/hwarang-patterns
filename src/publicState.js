import { binarySummary } from "./binarySummary.js";
import { patternTotalsForJudge } from "./patternSummary.js";

const scoringModeFor = (meta) => meta?.config?.scoringMode === "points" ? "points" : "binary";
const judgeCountFor = (meta) => meta?.config?.patternJudges === 5 ? 5 : 3;

function decisionFromTotals(totals) {
  if (totals.hong > totals.chong) return "hong";
  if (totals.chong > totals.hong) return "chong";
  return "draw";
}

export function emptyPublicState(control) {
  const evaluationId = control?.evaluationId || 1;
  const scoringMode = scoringModeFor(control);
  return {
    evaluationId,
    scoringMode,
    judges: Array.from({ length: judgeCountFor(control) }, (_, index) => ({
      id: index + 1,
      sent: false,
      decision: null,
    })),
    aggregate: { hong: 0, chong: 0 },
    result: { completed: false, winner: "en_curso" },
  };
}

export function derivePublicState(meta, judges) {
  const next = emptyPublicState(meta);
  next.judges = next.judges.map(({ id }) => {
    const judge = judges.find((candidate) => candidate.id === id);
    if (next.scoringMode === "points") {
      const sent = judge?.pattern?.sent === true && judge.pattern?.evaluationId === next.evaluationId;
      return {
        id,
        sent,
        decision: sent ? decisionFromTotals(patternTotalsForJudge(judge)) : null,
      };
    }

    const binary = judge?.pattern?.binary;
    const sent = binary?.sent === true
      && binary.evaluationId === next.evaluationId
      && (binary.vote === "hong" || binary.vote === "chong");
    return { id, sent, decision: sent ? binary.vote : null };
  });

  if (next.scoringMode === "binary") {
    const aggregate = binarySummary(meta, judges);
    next.aggregate = { hong: aggregate.hong, chong: aggregate.chong };
  } else {
    next.aggregate = {
      hong: meta?.patternResult?.hong || 0,
      chong: meta?.patternResult?.chong || 0,
    };
  }

  next.result = {
    completed: meta?.patternResult?.completed === true,
    winner: meta?.patternResult?.winner || "en_curso",
  };
  return next;
}

export function currentPublicState(control, publicState) {
  const expectedMode = scoringModeFor(control);
  if (publicState?.evaluationId !== control?.evaluationId || publicState?.scoringMode !== expectedMode) {
    return emptyPublicState(control);
  }
  return publicState;
}

export function serializePublicState(publicState) {
  return JSON.stringify(publicState);
}
