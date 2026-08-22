export function patternTotalsForJudge(judge) {
  const hongZero = !!judge.pattern?.hong?.zero;
  const chongZero = !!judge.pattern?.chong?.zero;
  const hong = hongZero ? 0 : (judge.pattern?.hong?.tech || 0) + (judge.pattern?.hong?.power || 0) + (judge.pattern?.hong?.rhythm || 0);
  const chong = chongZero ? 0 : (judge.pattern?.chong?.tech || 0) + (judge.pattern?.chong?.power || 0) + (judge.pattern?.chong?.rhythm || 0);
  return { hong, chong };
}

export function patternSummary(meta, judges) {
  const judgeCount = meta?.config?.patternJudges === 5 ? 5 : 3;
  const currentJudges = judges.slice(0, judgeCount);
  let hong = 0;
  let chong = 0;
  let sent = 0;

  currentJudges.forEach((judge) => {
    if (judge.pattern?.sent && judge.pattern?.evaluationId === meta?.evaluationId) {
      sent += 1;
      const totals = patternTotalsForJudge(judge);
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
