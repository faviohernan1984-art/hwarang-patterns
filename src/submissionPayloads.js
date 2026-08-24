export function makePointsSubmission({ evaluationId, judgeId, scores, submittedAt = Date.now() }) {
  return {
    evaluationId,
    judgeId,
    mode: "points",
    scores: {
      hong: { ...scores.hong },
      chong: { ...scores.chong },
    },
    sent: true,
    submittedAt,
  };
}

export function makeBinarySubmission({ evaluationId, judgeId, vote, submittedAt = Date.now() }) {
  return {
    evaluationId,
    judgeId,
    mode: "binary",
    vote,
    sent: true,
    submittedAt,
  };
}

export function currentSubmission(submission, { evaluationId, scoringMode, judgeId }) {
  if (!submission) return null;
  if (submission.evaluationId !== evaluationId) return null;
  if (submission.mode !== scoringMode) return null;
  if (submission.judgeId !== judgeId) return null;
  if (submission.sent !== true) return null;
  return submission;
}

export function submissionToJudge(raw, id) {
  const evaluationId = raw?.evaluationId || 1;
  const judge = {
    id,
    hongPoints: 0,
    chongPoints: 0,
    history: [],
    pattern: {
      evaluationId,
      hong: { tech: 0, power: 0, rhythm: 0, zero: false },
      chong: { tech: 0, power: 0, rhythm: 0, zero: false },
      sent: false,
      binary: { evaluationId, vote: null, sent: false },
    },
  };
  if (!raw || raw.sent !== true || raw.judgeId !== id) return judge;

  if (raw.mode === "points" && raw.scores) {
    judge.pattern.hong = { ...judge.pattern.hong, ...(raw.scores.hong || {}) };
    judge.pattern.chong = { ...judge.pattern.chong, ...(raw.scores.chong || {}) };
    judge.pattern.sent = true;
  }
  if (raw.mode === "binary" && (raw.vote === "hong" || raw.vote === "chong")) {
    judge.pattern.binary = { evaluationId, vote: raw.vote, sent: true };
  }
  return judge;
}
