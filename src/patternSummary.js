export function patternTotalsForJudge(judge) {
  const hongZero = !!judge.pattern?.hong?.zero;
  const chongZero = !!judge.pattern?.chong?.zero;
  const hong = hongZero ? 0 : (judge.pattern?.hong?.tech || 0) + (judge.pattern?.hong?.power || 0) + (judge.pattern?.hong?.rhythm || 0);
  const chong = chongZero ? 0 : (judge.pattern?.chong?.tech || 0) + (judge.pattern?.chong?.power || 0) + (judge.pattern?.chong?.rhythm || 0);
  return { hong, chong };
}

export function isPatternSideComplete(side) {
  if (side?.zero === true) return true;
  return [1, 2, 3, 4, 5].includes(side?.tech)
    && [1, 2, 3].includes(side?.power)
    && [1, 2, 3].includes(side?.rhythm);
}

export function isCurrentPatternSubmission(meta, judge) {
  return judge.pattern?.sent === true && judge.pattern?.evaluationId === meta?.evaluationId;
}

export function currentPatternTotalsForJudge(meta, judge) {
  if (!isCurrentPatternSubmission(meta, judge)) {
    return { hong: 0, chong: 0 };
  }
  return patternTotalsForJudge(judge);
}

export function currentPatternHasZero(meta, judge, side) {
  return isCurrentPatternSubmission(meta, judge) && judge.pattern?.[side]?.zero === true;
}

export function patternSummary(meta, judges) {
  const judgeCount = meta?.config?.patternJudges === 5 ? 5 : 3;
  const currentJudges = judges.slice(0, judgeCount);
  let hong = 0;
  let chong = 0;
  let sent = 0;

  currentJudges.forEach((judge) => {
    if (isCurrentPatternSubmission(meta, judge)) {
      sent += 1;
      const totals = currentPatternTotalsForJudge(meta, judge);
      hong += totals.hong;
      chong += totals.chong;
    }
  });

  let winner = "en_curso";
  if (meta?.patternResult?.completed && meta.patternResult?.winner) winner = meta.patternResult.winner;
  else if (sent === currentJudges.length) {
    if (hong > chong) winner = "hong";
    else if (chong > hong) winner = "chong";
    else winner = "draw";
  }
  return { hong, chong, sent, winner };
}
