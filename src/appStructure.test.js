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
  const summarySource = readFileSync(new URL("./patternSummary.js", import.meta.url), "utf8");
  assert.match(source, /if \(winner === "chong"\) return "#0602e0";\s*return "#fff200";/);
  assert.match(source, /return "DRAW";/);
  assert.match(source, /winner !== "hong" && winner !== "chong" && winner !== "draw"/);
  assert.match(summarySource, /else winner = "draw";/);
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
  assert.match(guardSource, /patternSummary\(meta, judges\)\.sent === activeJudgeCount\(meta\)/);

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

test("Firestore snapshot failures are reported without bypassing the loading gate", () => {
  const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  assert.match(source, /reportLoadFailure\("control snapshot", error\)/);
  assert.match(source, /reportLoadFailure\("meta snapshot", error\)/);
  assert.match(source, /reportLoadFailure\("public state snapshot", error\)/);
  assert.match(source, /reportLoadFailure\("submissions snapshot", error\)/);
  assert.match(source, /reportLoadFailure\("own submission snapshot", error\)/);
  assert.match(source, /Unable to load \$\{source\} for room/);
  assert.match(source, /if \(loadFailure\)[\s\S]*?No se pudo cargar Room/);
  assert.match(source, /if \(!meta\)[\s\S]*?Cargando\.\.\./);
});

test("CONTROL is the official source for shared room coordination", () => {
  const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const controlStart = source.indexOf("function controlFromMeta");
  const legacyStart = source.indexOf("function legacyMetaFromMeta", controlStart);
  const mergeStart = source.indexOf("function mergeRoomState", legacyStart);
  const controlSource = source.slice(controlStart, legacyStart);
  const legacySource = source.slice(legacyStart, mergeStart);

  [
    "evaluationId", "status", "phase", "phaseStartedAt", "pausedRemaining",
    "config", "hong", "chong", "publicSwapSides",
  ].forEach((field) => assert.match(controlSource, new RegExp(field)));
  assert.doesNotMatch(controlSource, /patternResult|presidentSwapSides/);
  assert.match(legacySource, /patternResult/);
  assert.match(legacySource, /presidentSwapSides/);
  assert.match(source, /onSnapshot\(controlRef/);
  assert.match(source, /setDoc\(controlRef, nextControl\)/);
});

test("START PAUSE NEXT RESET FORCE and CLOSE keep active state through CONTROL", () => {
  const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const presidentSource = source.slice(source.indexOf("function PresidentScreen"), source.indexOf("function JudgeScreen"));
  assert.match(presidentSource, /const startTimer[\s\S]*?status: "running"[\s\S]*?phaseStartedAt: Date\.now\(\)/);
  assert.match(presidentSource, /const pauseTimer[\s\S]*?current\.status = "paused"[\s\S]*?current\.phaseStartedAt = null/);
  assert.match(presidentSource, /const prepareNextMatch[\s\S]*?current\.evaluationId \+= 1/);
  assert.match(presidentSource, /const closePatternEvaluation[\s\S]*?current\.patternResult =/);
  assert.match(presidentSource, /const applyPatternForcedWinner[\s\S]*?current\.patternResult =/);
  assert.match(source, /const resetAll[\s\S]*?setDoc\(controlRef, controlFromMeta\(resetState\)\)/);
});

test("timer derivation and 3/5 scoring configuration remain local and shared", () => {
  const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  assert.match(source, /function getDerivedTime[\s\S]*?now - meta\.phaseStartedAt/);
  assert.match(source, /setInterval\(\(\) => setNow\(Date\.now\(\)\), 300\)/);
  assert.match(source, /meta\?\.config\?\.patternJudges === 5 \? 5 : 3/);
  assert.match(source, /meta\?\.config\?\.scoringMode === "points" \? "points" : "binary"/);
});

test("NEXT and RESET advance evaluationId without physically resetting Judges", () => {
  const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const nextStart = source.indexOf("const prepareNextMatch = async");
  const nextEnd = source.indexOf("const applyPatternForcedWinner", nextStart);
  const nextSource = source.slice(nextStart, nextEnd);
  const resetStart = source.indexOf("const resetAll = async");
  const resetEnd = source.indexOf("return {", resetStart);
  const resetSource = source.slice(resetStart, resetEnd);

  assert.match(nextSource, /current\.evaluationId \+= 1/);
  assert.doesNotMatch(nextSource, /writeJudge|roomJudgeRef|makeJudge/);
  assert.match(resetSource, /const evaluationId = current\.evaluationId \+ 1/);
  assert.doesNotMatch(resetSource, /roomJudgeRef|makeJudge\(i|for \(let i/);
});

test("SEND captures the active evaluationId for Points and Binary", () => {
  const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const judgeSource = source.slice(source.indexOf("function JudgeScreen"));
  assert.match(judgeSource, /const savePattern = async \(\) => \{[\s\S]*?const evaluationId = meta\.evaluationId/);
  assert.match(judgeSource, /const saveBinaryVote = async \(\) => \{[\s\S]*?const evaluationId = meta\.evaluationId/);
  assert.match(judgeSource, /makePointsSubmission\(\{\s*evaluationId,\s*judgeId,\s*scores:/);
  assert.match(judgeSource, /makeBinarySubmission\(\{\s*evaluationId,\s*judgeId,\s*vote/);
  assert.match(source, /setDoc\(roomSubmissionRef\(roomId, id\), submission\)/);
});

test("Judge SEND ignores repeated attempts for the same evaluation and mode", () => {
  const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const judgeSource = source.slice(source.indexOf("function JudgeScreen"));

  assert.match(judgeSource, /const submittedEvaluationRef = useRef\(null\)/);
  assert.match(judgeSource, /const submissionKey = `\$\{evaluationId\}:points`[\s\S]*?submittedEvaluationRef\.current === submissionKey/);
  assert.match(judgeSource, /const submissionKey = `\$\{evaluationId\}:binary`[\s\S]*?submittedEvaluationRef\.current === submissionKey/);
  assert.match(judgeSource, /catch \(error\) \{[\s\S]*?submittedEvaluationRef\.current = null/);
});

test("temporary Judge 2.4 diagnostics are removed", () => {
  const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\[Judge 2\.4 diagnostic\]/);
});

test("Points SEND cannot persist an incomplete evaluation", () => {
  const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const saveStart = source.indexOf("const savePattern = async");
  const saveEnd = source.indexOf("const saveBinaryVote", saveStart);
  const saveSource = source.slice(saveStart, saveEnd);
  const guardIndex = saveSource.indexOf("if (!patternComplete) return");
  const writeIndex = saveSource.indexOf("writeSubmission");

  assert.match(saveSource, /isPatternSideComplete\(localPattern\.hong\)[\s\S]*?isPatternSideComplete\(localPattern\.chong\)/);
  assert.ok(guardIndex >= 0 && guardIndex < writeIndex);
});

test("Judge resets Points and Binary locally when evaluationId changes", () => {
  const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const judgeSource = source.slice(source.indexOf("function JudgeScreen"));
  assert.match(judgeSource, /currentSubmission\(ownSubmission, \{\s*evaluationId: meta\.evaluationId,\s*scoringMode,\s*judgeId/);
  assert.match(judgeSource, /makeJudge\(judgeId, meta\.evaluationId\)\.pattern/);
  assert.match(judgeSource, /setLocalBinaryVote\(scoringMode === "binary" && validSubmission[\s\S]*?: null\)/);
  assert.match(judgeSource, /setLocalBinarySent\(scoringMode === "binary" && validSubmission[\s\S]*?: false\)/);
  assert.match(judgeSource, /latestEvaluationIdRef\.current === evaluationId/);
  assert.match(judgeSource, /setLocalBinarySent\(true\)/);
});

test("Points SEND distinguishes incomplete, ready and registered visual states", () => {
  const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("./JudgePoints.css", import.meta.url), "utf8");
  const pointsStart = source.indexOf("function JudgePatternColorPanel");
  const pointsEnd = source.indexOf("function JudgePatternReadOnlyCard", pointsStart);
  const pointsSource = source.slice(pointsStart, pointsEnd);

  assert.match(pointsSource, /\{locked \? "SCORE SENT" : "SELECT SCORES"\}/);
  assert.match(pointsSource, /patterns-judge-points__joystick\$\{locked \? " is-sent" : ""\}/);
  assert.match(pointsSource, /patterns-judge-points__send\$\{locked \? " is-confirmed" : patternComplete \? " is-ready" : ""\}/);
  assert.match(pointsSource, /disabled=\{locked \|\| !patternComplete\}/);
  assert.match(pointsSource, /\{locked \? "✓ SCORE REGISTERED" : "SEND"\}/);
  assert.match(css, /\.patterns-judge-points__send\.is-ready[\s\S]*?animation: patternsJudgePointsReadyButton 650ms ease-out/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.patterns-judge-points__send\.is-ready[\s\S]*?animation: none/);
  assert.doesNotMatch(pointsSource, /setTimeout|onSnapshot|writeJudge/);
});

test("President and Public indicators reject submissions from old evaluations", () => {
  const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const publicStateSource = readFileSync(new URL("./publicState.js", import.meta.url), "utf8");
  const presidentSource = source.slice(source.indexOf("function PresidentScreen"), source.indexOf("function JudgeScreen"));
  assert.match(publicStateSource, /publicState\?\.evaluationId !== control\?\.evaluationId/);
  assert.match(publicStateSource, /publicState\?\.scoringMode !== expectedMode/);
  assert.match(presidentSource, /judge\.pattern\?\.evaluationId === meta\.evaluationId/);
  assert.match(presidentSource, /binaryVote\.evaluationId === meta\.evaluationId/);
  assert.match(presidentSource, /patternSummary\(meta, judges\)/);
  assert.match(presidentSource, /binarySummary\(meta, judges\)/);
});

test("roles use the minimum room data listeners", () => {
  const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const hookSource = source.slice(source.indexOf("function useFightData"), source.indexOf("function controlFromMeta"));
  assert.match(hookSource, /role === "president"[\s\S]*?onSnapshot\(roomSubmissionsQuery\(roomId\)/);
  assert.match(hookSource, /role === "public"[\s\S]*?onSnapshot\(roomPublicStateRef\(roomId\)/);
  assert.match(hookSource, /role === "judge" && judgeId[\s\S]*?onSnapshot\(roomSubmissionRef\(roomId, judgeId\)/);
  const judgeBranch = hookSource.slice(hookSource.indexOf('role === "judge"'), hookSource.indexOf("} else {", hookSource.indexOf('role === "judge"')));
  assert.doesNotMatch(judgeBranch, /roomSubmissionsQuery|roomJudgesQuery/);
  assert.match(hookSource, /const writeSubmission[\s\S]*?setDoc\(roomSubmissionRef\(roomId, id\), submission\)/);

  const publicStart = hookSource.indexOf('role === "public"');
  const publicEnd = hookSource.indexOf('role === "judge"', publicStart);
  const publicBranch = hookSource.slice(publicStart, publicEnd);
  assert.doesNotMatch(publicBranch, /roomJudgesQuery|roomSubmissionsQuery|roomMetaRef|matchMetaRef/);
  assert.match(hookSource, /if \(role !== "public"\)[\s\S]*?onSnapshot\(matchMetaRef/);
});

test("President publishes deduplicated Public State while keeping the legacy projection", () => {
  const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const presidentSource = source.slice(source.indexOf("function PresidentScreen"), source.indexOf("function JudgeScreen"));
  const publicEffectStart = presidentSource.indexOf("const nextPublicState = derivePublicState");
  const publicEffectEnd = presidentSource.indexOf("useEffect", publicEffectStart);
  const publicEffect = presidentSource.slice(publicEffectStart, publicEffectEnd);

  assert.match(presidentSource, /publishLegacyJudge\(judge\.id, judge\)/);
  assert.match(publicEffect, /serializePublicState\(nextPublicState\)/);
  assert.match(publicEffect, /publishedPublicStateRef\.current === token/);
  assert.match(publicEffect, /publicStateWriteQueueRef\.current[\s\S]*?writePublicState\(nextPublicState\)/);
  assert.match(publicEffect, /meta\.evaluationId/);
  assert.match(publicEffect, /scoringMode/);
  assert.match(publicEffect, /meta\.config\.patternJudges/);
  assert.match(publicEffect, /meta\.patternResult\?\.completed/);
  assert.match(publicEffect, /meta\.patternResult\?\.winner/);
  assert.doesNotMatch(publicEffect, /\btime\b|meta\.status|meta\.phase|phaseStartedAt|pausedRemaining|roundSeconds|publicSwapSides|meta\.hong|meta\.chong/);
});

test("Judge rehydrates only a current own submission and clears on generation changes", () => {
  const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const hookSource = source.slice(source.indexOf("function useFightData"), source.indexOf("function controlFromMeta"));
  const judgeSource = source.slice(source.indexOf("function JudgeScreen"));
  assert.match(hookSource, /roomSubmissionRef\(roomId, judgeId\)/);
  assert.match(hookSource, /submissionToJudge\(snap\.data\(\), judgeId\)/);
  assert.match(judgeSource, /const validSubmission = currentSubmission\(ownSubmission/);
  assert.match(judgeSource, /scoringMode === "points" && validSubmission/);
  assert.match(judgeSource, /scoringMode === "binary" && validSubmission/);
  assert.match(judgeSource, /makeJudge\(judgeId, meta\.evaluationId\)\.pattern/);
});

test("RESET restores Binary while advancing evaluationId", () => {
  const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const resetSource = source.slice(source.indexOf("const resetAll"), source.indexOf("return {", source.indexOf("const resetAll")));
  assert.match(resetSource, /const evaluationId = current\.evaluationId \+ 1/);
  assert.match(resetSource, /const resetState = \{ \.\.\.makeInitialMeta\(\), evaluationId \}/);
  assert.doesNotMatch(resetSource, /scoringMode: getScoringMode\(current\)/);
});

test("NEXT and RESET never delete or clear submissions", () => {
  const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const resetSource = source.slice(source.indexOf("const resetAll"), source.indexOf("return {", source.indexOf("const resetAll")));
  const nextSource = source.slice(source.indexOf("const prepareNextMatch"), source.indexOf("const applyPatternForcedWinner"));
  assert.doesNotMatch(resetSource, /roomSubmissionRef|roomSubmissionsQuery|deleteDoc/);
  assert.doesNotMatch(nextSource, /roomSubmissionRef|roomSubmissionsQuery|deleteDoc/);
});
