export function binarySummary(meta, judges) {
  const judgeCount = meta?.config?.patternJudges === 5 ? 5 : 3;
  const currentJudges = judges.slice(0, judgeCount);
  const majorityRequired = Math.floor(judgeCount / 2) + 1;

  let hong = 0;
  let chong = 0;

  currentJudges.forEach((judge) => {
    const binary = judge.pattern?.binary;
    if (binary?.sent !== true) return;
    if (Number.isSafeInteger(meta?.evaluationId) && binary.evaluationId !== meta.evaluationId) return;
    if (binary.vote === "hong") hong += 1;
    if (binary.vote === "chong") chong += 1;
  });

  const sent = hong + chong;
  const allSent = sent === judgeCount;
  let winner = null;

  if (allSent) {
    if (hong >= majorityRequired) winner = "hong";
    if (chong >= majorityRequired) winner = "chong";
  }

  return { sent, hong, chong, majorityRequired, allSent, winner };
}
