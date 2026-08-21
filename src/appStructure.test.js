import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Public and President winners use the viewport portal while Judge stays unchanged", () => {
  const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const publicStart = source.indexOf("function PublicScreen");
  const presidentStart = source.indexOf("function PresidentScreen");
  const judgeStart = source.indexOf("function JudgeScreen");
  const appStart = source.indexOf("export default function App", judgeStart);
  assert.match(source.slice(publicStart, presidentStart), /ViewportWinnerOverlay/);
  assert.match(source.slice(presidentStart, judgeStart), /ViewportWinnerOverlay/);
  assert.doesNotMatch(source.slice(judgeStart, appStart), /ViewportWinnerOverlay/);
  assert.match(source.slice(judgeStart, appStart), /<WinnerFullScreen winner=\{judgeWinner\}/);
  const portalStart = source.indexOf("function ViewportWinnerOverlay");
  const portalEnd = source.indexOf("function ScoreChoice", portalStart);
  const portalSource = source.slice(portalStart, portalEnd);
  assert.match(portalSource, /Math\.min\([\s\S]*?clientWidth \/ baseWidth[\s\S]*?clientHeight \/ baseHeight/);
  assert.match(portalSource, /rgba\(0,0,0,0\.90\)/);
  assert.match(portalSource, /overlayBackground="transparent"/);
});

test("DRAW keeps the approved presentation in President, Public and Judge", () => {
  const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  assert.match(source, /if \(winner === "chong"\) return "#0602e0";\s*return "#fff200";/);
  assert.match(source, /return "DRAW";/);
  assert.match(source, /winner !== "hong" && winner !== "chong" && winner !== "draw"/);
  assert.match(source, /else winner = "draw";/);
  assert.match(source, /applyPatternForcedWinner\("draw"\)/);
  assert.match(source, /<ViewportWinnerOverlay winner=\{meta\.patternResult\?\.winner\}/);
  assert.match(source, /<ViewportWinnerOverlay[\s\S]*?winner=\{presidentWinner\}[\s\S]*?mode="president"/);
  assert.match(source, /<WinnerFullScreen winner=\{judgeWinner\}/);
});

test("CLOSE is guarded in both the button and handler", () => {
  const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const guardStart = source.indexOf("function canClosePatternEvaluation");
  const guardEnd = source.indexOf("function formatTime", guardStart);
  const guardSource = source.slice(guardStart, guardEnd);
  assert.match(guardSource, /status === "running"/);
  assert.match(guardSource, /time > 0/);
  assert.match(guardSource, /patternResult\?\.completed/);
  assert.match(guardSource, /binarySummary\(meta, judges\)\.allSent/);
  assert.match(guardSource, /activeJudges\(meta, judges\)\.every/);

  const presidentStart = source.indexOf("function PresidentScreen");
  const judgeStart = source.indexOf("function JudgeScreen", presidentStart);
  const presidentSource = source.slice(presidentStart, judgeStart);
  assert.match(presidentSource, /const closePatternEvaluation = async \(\) => \{\s*if \(!canClosePatternEvaluation\(meta, time, judges\)\) return;/);
  assert.match(presidentSource, /disabled=\{!canCloseEvaluation\}[\s\S]*?CLOSE EVALUATION/);
});

test("forced decisions stay available in every scoring mode and latest intent wins", () => {
  const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const forceStart = source.indexOf("const applyPatternForcedWinner");
  const forceEnd = source.indexOf("const updateCompetitor", forceStart);
  const forceSource = source.slice(forceStart, forceEnd);
  assert.match(forceSource, /\["hong", "chong", "draw"\]\.includes\(winner\)/);
  assert.doesNotMatch(forceSource, /winner === "draw"[^\n]*getScoringMode/);
  assert.match(forceSource, /forceWriteQueueRef\.current = forceWriteQueueRef\.current/);
  assert.match(forceSource, /forcedDecisionToken: token/);
  assert.match(forceSource, /scoringMode: getScoringMode\(current\)/);
  assert.match(forceSource, /completed: true,\s*winner,/);
  assert.match(source, /<AppButton style=\{styles\.gray\} onClick=\{\(\) => applyPatternForcedWinner\("draw"\)\}>DRAW<\/AppButton>/);
});

test("match configuration is locked in the UI and guarded in handlers", () => {
  const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const presidentStart = source.indexOf("function PresidentScreen");
  const judgeStart = source.indexOf("function JudgeScreen", presidentStart);
  const presidentSource = source.slice(presidentStart, judgeStart);
  assert.match(presidentSource, /const configurationLocked = localConfigurationLock \|\| persistedConfigurationLock/);
  assert.match(presidentSource, /const saveConfig = async[\s\S]*?if \(configurationLocked && !allowDuringStart\) return;/);
  assert.match(presidentSource, /const setPatternJudgeCount = async[\s\S]*?if \(configurationLocked\) return;/);
  assert.match(presidentSource, /setLocalConfigurationLock\(true\);[\s\S]*?saveConfig\(\{ preserveRemaining: isResume, allowDuringStart: true \}\)/);
  assert.match(presidentSource, /disabled=\{configurationLocked\} value=\{secondsInput\}/);
  assert.match(presidentSource, /patterns-president__preset[\s\S]*?disabled=\{configurationLocked\}/);
  assert.match(presidentSource, /disabled=\{configurationLocked\} onClick=\{\(\) => setPatternJudgeCount\(3\)\}/);
  assert.match(presidentSource, /disabled=\{configurationLocked\} onClick=\{\(\) => setPatternJudgeCount\(5\)\}/);
  assert.match(presidentSource, /const resetEvaluation = async \(\) => \{\s*setLocalConfigurationLock\(false\)/);
});
