export const DEFAULT_ROUND_SECONDS = 120;
export const DEFAULT_JUDGE_COUNT = 3;
export const DEFAULT_SCORING_MODE = "binary";

export function isValidEvaluationId(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

export function normalizeEvaluationId(value) {
  return isValidEvaluationId(value) ? value : 1;
}

export function isValidMetaDocument(meta) {
  if (!meta || typeof meta !== "object") return false;
  const config = meta.config;
  const result = meta.patternResult;
  if (!isValidEvaluationId(meta.evaluationId)) return false;
  if (!config || !Number.isSafeInteger(config.roundSeconds) || config.roundSeconds < 1) return false;
  if (config.patternJudges !== 3 && config.patternJudges !== 5) return false;
  if (config.scoringMode !== "points" && config.scoringMode !== "binary") return false;
  if (!Number.isSafeInteger(meta.pausedRemaining) || meta.pausedRemaining < 0 || meta.pausedRemaining > config.roundSeconds) return false;
  if (meta.phaseStartedAt !== null && (!Number.isSafeInteger(meta.phaseStartedAt) || meta.phaseStartedAt < 0)) return false;
  if (meta.status !== "running" && meta.status !== "paused") return false;
  if (meta.phase !== "fight" && meta.phase !== "finished") return false;
  if (typeof meta.evaluationStarted !== "boolean") return false;
  if (meta.status === "running" && (meta.phase !== "fight" || meta.evaluationStarted !== true || meta.phaseStartedAt === null)) return false;
  if (meta.phase === "finished" && (meta.status !== "paused" || meta.pausedRemaining !== 0 || meta.phaseStartedAt !== null)) return false;
  if (!result || typeof result.completed !== "boolean") return false;
  if (result.completed === true && !["hong", "chong", "draw"].includes(result.winner)) return false;
  return true;
}

export function nextEvaluationId(value) {
  const current = normalizeEvaluationId(value);
  if (current === Number.MAX_SAFE_INTEGER) throw new RangeError("evaluationId exhausted");
  return current + 1;
}

export function makeEmptyResult() {
  return {
    hong: 0,
    chong: 0,
    sent: 0,
    completed: false,
    winner: "en_curso",
  };
}

export function makeFreshJudge(id, evaluationId) {
  const generation = normalizeEvaluationId(evaluationId);
  return {
    id,
    hongPoints: 0,
    chongPoints: 0,
    history: [],
    pattern: {
      evaluationId: generation,
      hong: { tech: 0, power: 0, rhythm: 0, zero: false },
      chong: { tech: 0, power: 0, rhythm: 0, zero: false },
      sent: false,
      binary: { evaluationId: generation, vote: null, sent: false },
    },
  };
}

export function isValidPointsSide(side) {
  if (!side || typeof side !== "object") return false;
  if (side.zero === true) {
    return side.tech === 0 && side.power === 0 && side.rhythm === 0;
  }
  if (side.zero !== false) return false;
  return Number.isInteger(side.tech) && side.tech >= 1 && side.tech <= 5
    && Number.isInteger(side.power) && side.power >= 1 && side.power <= 3
    && Number.isInteger(side.rhythm) && side.rhythm >= 1 && side.rhythm <= 3;
}

export function isValidPointsSubmission(pattern) {
  return !!pattern
    && isValidPointsSide(pattern.hong)
    && isValidPointsSide(pattern.chong);
}

export function pointsTotals(pattern) {
  if (!isValidPointsSubmission(pattern)) return null;
  const totalSide = (side) => side.zero ? 0 : side.tech + side.power + side.rhythm;
  return { hong: totalSide(pattern.hong), chong: totalSide(pattern.chong) };
}

export function pointsSummary(meta, judges, judgeCount) {
  const generation = meta?.evaluationId;
  const active = judges.slice(0, judgeCount);
  let hong = 0;
  let chong = 0;
  let sent = 0;

  active.forEach((judge) => {
    if (judge?.pattern?.sent !== true) return;
    if (!isValidEvaluationId(generation) || judge.pattern.evaluationId !== generation) return;
    const totals = pointsTotals(judge.pattern);
    if (!totals) return;
    sent += 1;
    hong += totals.hong;
    chong += totals.chong;
  });

  const allSent = active.length === judgeCount && sent === judgeCount;
  const winner = !allSent ? "en_curso" : hong > chong ? "hong" : chong > hong ? "chong" : "draw";
  return { hong, chong, sent, allSent, winner };
}

export function isValidBinaryVote(vote) {
  return vote === "hong" || vote === "chong";
}

export function isEvaluationOpen(meta, evaluationId) {
  return Number.isSafeInteger(evaluationId)
    && meta?.evaluationId === evaluationId
    && meta?.evaluationStarted === true
    && meta?.patternResult?.completed !== true;
}

export function isExpectedEvaluation(meta, evaluationId) {
  return Number.isSafeInteger(evaluationId) && meta?.evaluationId === evaluationId;
}

export function isConfigurationLocked(meta) {
  return meta?.evaluationStarted === true;
}

export function canPrepareNext(meta) {
  return meta?.patternResult?.completed === true;
}

export function canCloseEvaluation({ time, allSent, completed }) {
  return time === 0 && allSent === true && completed !== true;
}

export function applyJudgeCountChange(meta, count) {
  if (isConfigurationLocked(meta)) return { status: "locked", meta };
  if (count !== 3 && count !== 5) return { status: "invalid", meta };
  return { status: "accepted", meta: { ...meta, config: { ...(meta.config || {}), patternJudges: count } } };
}

export function applyFirstPointsSubmission(judge, evaluationId, submittedPattern) {
  const generation = normalizeEvaluationId(evaluationId);
  if (!Number.isSafeInteger(evaluationId) || judge?.pattern?.evaluationId !== generation) {
    return { status: "stale_generation", judge };
  }
  if (judge.pattern.sent === true) return { status: "already_sent", judge };
  if (!isValidPointsSubmission(submittedPattern)) return { status: "invalid", judge };

  return {
    status: "accepted",
    judge: {
      ...judge,
      pattern: {
        ...judge.pattern,
        evaluationId: generation,
        hong: { ...submittedPattern.hong },
        chong: { ...submittedPattern.chong },
        sent: true,
      },
    },
  };
}

export function applyFirstBinarySubmission(judge, evaluationId, vote) {
  const generation = normalizeEvaluationId(evaluationId);
  if (!Number.isSafeInteger(evaluationId) || judge?.pattern?.binary?.evaluationId !== generation) {
    return { status: "stale_generation", judge };
  }
  if (judge.pattern.binary.sent === true) return { status: "already_sent", judge };
  if (!isValidBinaryVote(vote)) return { status: "invalid", judge };

  return {
    status: "accepted",
    judge: {
      ...judge,
      pattern: {
        ...judge.pattern,
        binary: { evaluationId: generation, vote, sent: true },
      },
    },
  };
}

export function makeNextEvaluationMeta(current) {
  const evaluationId = nextEvaluationId(current?.evaluationId);
  const roundSeconds = Number.isSafeInteger(current?.config?.roundSeconds) && current.config.roundSeconds >= 1
    ? current.config.roundSeconds
    : DEFAULT_ROUND_SECONDS;
  return {
    ...current,
    evaluationId,
    evaluationStarted: false,
    mode: "pattern",
    status: "paused",
    phase: "fight",
    round: 1,
    phaseStartedAt: null,
    pausedRemaining: roundSeconds,
    patternResult: makeEmptyResult(),
  };
}

export function makeResetEvaluationMeta(current) {
  return {
    mode: "pattern",
    config: {
      roundSeconds: DEFAULT_ROUND_SECONDS,
      patternJudges: DEFAULT_JUDGE_COUNT,
      scoringMode: DEFAULT_SCORING_MODE,
    },
    evaluationId: nextEvaluationId(current?.evaluationId),
    evaluationStarted: false,
    round: 1,
    phase: "fight",
    status: "paused",
    pausedRemaining: DEFAULT_ROUND_SECONDS,
    phaseStartedAt: null,
    hong: { label: "Hong", name: "HONG", club: "" },
    chong: { label: "Chong", name: "CHONG", club: "" },
    publicSwapSides: false,
    presidentSwapSides: false,
    patternResult: makeEmptyResult(),
  };
}
