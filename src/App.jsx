
import { useEffect, useRef, useState } from "react";
import {
  onSnapshot,
  runTransaction,
  setDoc,
  getDoc,
  getDocs,
  query,
} from "firebase/firestore";
import { db, matchMetaRef, judgesColRef, judgeRef } from "./firebase";
import { QRCodeCanvas } from "qrcode.react";
import { binarySummary } from "./binarySummary";
import { useWakeLock } from "./useWakeLock";
import {
  applyFirstBinarySubmission,
  applyFirstPointsSubmission,
  applyJudgeCountChange,
  canPrepareNext,
  canCloseEvaluation,
  isConfigurationLocked,
  isEvaluationOpen,
  isExpectedEvaluation,
  isValidPointsSubmission,
  makeEmptyResult,
  makeFreshJudge,
  makeNextEvaluationMeta,
  makeResetEvaluationMeta,
  normalizeEvaluationId,
  pointsSummary,
} from "./evaluationRules";
import "./PublicScreen.css";
import "./PresidentScreen.css";
import "./JudgeBinary.css";
import "./JudgePoints.css";

const HONG = "Hong";
const CHONG = "Chong";
const MAX_JUDGES = 5;

function getBaseURL() {
  return window.location.origin;
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function vibrate(ms = 35) {
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch {}
}

let audioCtx = null;
function getAudioCtx() {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  return audioCtx;
}

function playTone({
  frequency = 440,
  duration = 0.08,
  type = "square",
  gain = 0.03,
  sweepTo = null,
} = {}) {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state !== "running" && ctx.resume) ctx.resume();

    const osc = ctx.createOscillator();
    const g = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);
    if (sweepTo) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(1, sweepTo),
        ctx.currentTime + duration
      );
    }

    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

    osc.connect(g);
    g.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  } catch {}
}

function playButtonSound() {
  playTone({ frequency: 720, duration: 0.05, type: "square", gain: 0.025, sweepTo: 620 });
}

function playStartAlarm() {
  playTone({ frequency: 700, duration: 0.12, type: "sawtooth", gain: 0.045 });
  setTimeout(() => playTone({ frequency: 950, duration: 0.12, type: "sawtooth", gain: 0.045 }), 140);
  setTimeout(() => playTone({ frequency: 1250, duration: 0.18, type: "sawtooth", gain: 0.05 }), 290);
}

function playEndAlarm() {
  playTone({ frequency: 900, duration: 0.12, type: "triangle", gain: 0.05 });
  setTimeout(() => playTone({ frequency: 700, duration: 0.14, type: "triangle", gain: 0.05 }), 160);
  setTimeout(() => playTone({ frequency: 500, duration: 0.2, type: "triangle", gain: 0.055 }), 340);
}

function playWinnerSound() {
  playTone({ frequency: 520, duration: 0.09, type: "square", gain: 0.04 });
  setTimeout(() => playTone({ frequency: 780, duration: 0.1, type: "square", gain: 0.04 }), 110);
  setTimeout(() => playTone({ frequency: 1040, duration: 0.18, type: "square", gain: 0.045 }), 240);
}

function tapFeedback({ vibrateMs = 30 } = {}) {
  vibrate(vibrateMs);
  playButtonSound();
}

function getBaseCompetitor(label) {
  return {
    label,
    name: label.toUpperCase(),
    club: "",
  };
}

function GlobalAppStyle() {
  return (
    <style>{`
      html, body, #root {
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 0;
        overflow: hidden;
        background: #000;
      }
      * { box-sizing: border-box; }
      body {
        font-family: Arial, sans-serif;
      }
      input, button, textarea, select {
        font-family: inherit;
      }

      @keyframes hwarangLineFlow {
        0% { background-position: 0% 50%; opacity: 0.5; }
        50% { background-position: 100% 50%; opacity: 0.9; }
        100% { background-position: 0% 50%; opacity: 0.5; }
      }

      @keyframes winnerEnter {
        0% { opacity: 0; transform: scale(0.72) translateY(24px); filter: brightness(2.2) blur(6px); }
        60% { opacity: 1; transform: scale(1.08) translateY(0); filter: brightness(1.7) blur(0); }
        100% { opacity: 1; transform: scale(1); filter: brightness(1); }
      }

      @keyframes winnerPulsePro {
        0% { transform: scale(1); filter: brightness(1); }
        20% { transform: scale(1.06); filter: brightness(1.35); }
        30% { transform: scale(1.02); filter: brightness(1.1); }
        100% { transform: scale(1); filter: brightness(1); }
      }

      @keyframes winnerBorderPulseRed {
        0%, 100% { box-shadow: 0 0 10px rgba(255,26,26,.4), 0 0 20px rgba(255,26,26,.2); }
        50% { box-shadow: 0 0 24px rgba(255,26,26,.9), 0 0 52px rgba(255,26,26,.5); }
      }

      @keyframes winnerBorderPulseBlue {
        0%, 100% { box-shadow: 0 0 10px rgba(6,2,224,.4), 0 0 20px rgba(6,2,224,.2); }
        50% { box-shadow: 0 0 24px rgba(6,2,224,.9), 0 0 52px rgba(6,2,224,.5); }
      }

      @keyframes winnerBorderPulseYellow {
        0%, 100% { box-shadow: 0 0 10px rgba(255,242,0,.4), 0 0 20px rgba(255,242,0,.2); }
        50% { box-shadow: 0 0 24px rgba(255,242,0,.9), 0 0 52px rgba(255,242,0,.5); }
      }
    `}</style>
  );
}

function makeJudge(id, evaluationId = 1) {
  return makeFreshJudge(id, evaluationId);
}

function normalizeJudge(raw, id) {
  const base = makeJudge(id);
  if (!raw) return base;

  return {
    ...base,
    ...raw,
    pattern: {
      ...base.pattern,
      ...(raw.pattern || {}),
      hong: {
        ...base.pattern.hong,
        ...(raw.pattern?.hong || {}),
      },
      chong: {
        ...base.pattern.chong,
        ...(raw.pattern?.chong || {}),
      },
      binary: {
        ...base.pattern.binary,
        ...(raw.pattern?.binary || {}),
        vote: raw.pattern?.binary?.vote === "hong" || raw.pattern?.binary?.vote === "chong"
          ? raw.pattern.binary.vote
          : null,
        sent: raw.pattern?.binary?.sent === true,
      },
    },
  };
}

function makeEmptyPatternResult() {
  return makeEmptyResult();
}

function makeInitialMeta(evaluationId = 1) {
  return {
    mode: "pattern",
    config: {
      roundSeconds: 120,
      patternJudges: 3,
      scoringMode: "binary",
    },
    evaluationId: normalizeEvaluationId(evaluationId),
    evaluationStarted: false,
    round: 1,
    phase: "fight",
    status: "paused",
    pausedRemaining: 120,
    phaseStartedAt: null,
    hong: getBaseCompetitor(HONG),
    chong: getBaseCompetitor(CHONG),
    publicSwapSides: false,
    presidentSwapSides: false,
    patternResult: makeEmptyPatternResult(),
    updatedAt: Date.now(),
  };
}


function ensureMetaShape(raw) {
  const base = makeInitialMeta();
  const current = raw || {};
  const config = {
    ...base.config,
    ...(current.config || {}),
  };
  const legacyEvaluationStarted = current.status === "running"
    || current.phase === "finished"
    || (current.phase === "fight" && Number(current.pausedRemaining) < Number(config.roundSeconds));
  if (raw && !Object.prototype.hasOwnProperty.call(current.config || {}, "scoringMode")) {
    delete config.scoringMode;
  }
  return {
    ...base,
    ...current,
    config,
    evaluationId: normalizeEvaluationId(current.evaluationId),
    evaluationStarted: Object.prototype.hasOwnProperty.call(current, "evaluationStarted")
      ? current.evaluationStarted === true
      : legacyEvaluationStarted,
    hong: {
      ...base.hong,
      ...(current.hong || {}),
    },
    chong: {
      ...base.chong,
      ...(current.chong || {}),
    },
    patternResult: {
      ...base.patternResult,
      ...(current.patternResult || {}),
    },
  };
}

function getScoringMode(meta) {
  return meta?.config?.scoringMode === "points" ? "points" : "binary";
}

function activeJudgeCount(meta) {
  return meta?.config?.patternJudges === 5 ? 5 : 3;
}

function activeJudges(meta, judges) {
  return judges.slice(0, activeJudgeCount(meta));
}

function formatTime(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function getDerivedTime(meta, now = Date.now()) {
  if (!meta) return 0;
  if (meta.status !== "running" || !meta.phaseStartedAt) return meta.pausedRemaining || 0;
  const elapsed = Math.floor((now - meta.phaseStartedAt) / 1000);
  return Math.max(0, (meta.pausedRemaining || 0) - elapsed);
}

function useClock(meta) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 300);
    return () => clearInterval(t);
  }, []);

  return getDerivedTime(meta, now);
}

function patternTotalsForJudge(judge) {
  const hongZero = !!judge.pattern?.hong?.zero;
  const chongZero = !!judge.pattern?.chong?.zero;
  const validValue = (value, max) => Number.isInteger(value) && value >= 1 && value <= max ? value : 0;
  const totalSide = (side, zero) => zero
    ? 0
    : validValue(side?.tech, 5) + validValue(side?.power, 3) + validValue(side?.rhythm, 3);

  const hong = totalSide(judge.pattern?.hong, hongZero);
  const chong = totalSide(judge.pattern?.chong, chongZero);

  return { hong, chong };
}

function isCurrentPointsSubmission(meta, judge) {
  return judge?.pattern?.sent === true
    && normalizeEvaluationId(judge.pattern.evaluationId) === normalizeEvaluationId(meta?.evaluationId)
    && isValidPointsSubmission(judge.pattern);
}

function isCurrentBinarySubmission(meta, judge) {
  const binary = judge?.pattern?.binary;
  return binary?.sent === true
    && (binary.vote === "hong" || binary.vote === "chong")
    && normalizeEvaluationId(binary.evaluationId) === normalizeEvaluationId(meta?.evaluationId);
}

function patternSummary(meta, judges) {
  const summary = pointsSummary(meta, judges, activeJudgeCount(meta));
  return meta.patternResult?.completed && meta.patternResult?.winner
    ? { ...summary, winner: meta.patternResult.winner }
    : summary;
}

function getDisplaySides(meta, context = "public") {
  const swap = context === "public" ? !!meta.publicSwapSides : !!meta.presidentSwapSides;

  const hong = {
    ...(meta.hong || getBaseCompetitor(HONG)),
    side: "hong",
    color: "hong",
    visualLabel: "HONG",
  };
  const chong = {
    ...(meta.chong || getBaseCompetitor(CHONG)),
    side: "chong",
    color: "chong",
    visualLabel: "CHONG",
  };

  if (context === "president") {
    return swap ? { left: chong, right: hong } : { left: hong, right: chong };
  }

  return swap ? { left: hong, right: chong } : { left: chong, right: hong };
}

async function ensureInitialDocs() {
  const metaSnap = await getDoc(matchMetaRef);
  const initialMeta = metaSnap.exists() ? ensureMetaShape(metaSnap.data()) : makeInitialMeta();

  if (!metaSnap.exists()) {
    await setDoc(matchMetaRef, initialMeta);
  }

  const existing = await getDocs(query(judgesColRef));
  const ids = new Set(existing.docs.map((d) => d.id));

  for (let i = 1; i <= MAX_JUDGES; i += 1) {
    if (!ids.has(String(i))) {
      await setDoc(judgeRef(i), makeJudge(i, initialMeta.evaluationId));
    }
  }
}

function useFightData() {
  const [meta, setMeta] = useState(null);
  const [judges, setJudges] = useState(Array.from({ length: MAX_JUDGES }, (_, i) => makeJudge(i + 1)));

  useEffect(() => {
    ensureInitialDocs();

    const unsubMeta = onSnapshot(matchMetaRef, (snap) => {
      if (snap.exists()) setMeta(ensureMetaShape(snap.data())); else setMeta(makeInitialMeta());
    });

    const unsubJudges = onSnapshot(judgesColRef, (snap) => {
      const next = Array.from({ length: MAX_JUDGES }, (_, i) => makeJudge(i + 1));
      snap.docs.forEach((doc) => {
        const idx = Number(doc.id) - 1;
        if (idx >= 0 && idx < MAX_JUDGES) next[idx] = normalizeJudge(doc.data(), idx + 1);
      });
      setJudges(next);
    });

    return () => {
      unsubMeta();
      unsubJudges();
    };
  }, []);

  const writeMeta = async (mutator) => {
    return runTransaction(db, async (transaction) => {
      const snap = await transaction.get(matchMetaRef);
      const current = ensureMetaShape(snap.exists() ? snap.data() : makeInitialMeta());
      const draft = clone(current);
      const result = typeof mutator === "function" ? mutator(draft) : mutator;
      const next = ensureMetaShape(result ?? draft);
      next.updatedAt = Date.now();
      transaction.set(matchMetaRef, next);
      return next;
    });
  };

  const submitPoints = async (id, evaluationId, submittedPattern) => {
    const ref = judgeRef(id);
    return runTransaction(db, async (transaction) => {
      const metaSnap = await transaction.get(matchMetaRef);
      const judgeSnap = await transaction.get(ref);
      const currentMeta = ensureMetaShape(metaSnap.exists() ? metaSnap.data() : makeInitialMeta());
      const generation = normalizeEvaluationId(currentMeta.evaluationId);
      const currentJudge = judgeSnap.exists()
        ? normalizeJudge(judgeSnap.data(), id)
        : makeJudge(id, generation);

      if (getScoringMode(currentMeta) !== "points") return { status: "wrong_mode", judge: currentJudge };
      if (id < 1 || id > activeJudgeCount(currentMeta)) return { status: "inactive_judge", judge: currentJudge };
      if (!isEvaluationOpen(currentMeta, evaluationId)) {
        return { status: currentMeta.patternResult?.completed ? "completed" : currentMeta.evaluationStarted ? "stale_generation" : "not_started", judge: currentJudge };
      }

      const result = applyFirstPointsSubmission(currentJudge, evaluationId, submittedPattern);
      if (result.status === "accepted") transaction.set(ref, result.judge);
      return result;
    });
  };

  const submitBinary = async (id, evaluationId, vote) => {
    const ref = judgeRef(id);
    return runTransaction(db, async (transaction) => {
      const metaSnap = await transaction.get(matchMetaRef);
      const judgeSnap = await transaction.get(ref);
      const currentMeta = ensureMetaShape(metaSnap.exists() ? metaSnap.data() : makeInitialMeta());
      const generation = normalizeEvaluationId(currentMeta.evaluationId);
      const currentJudge = judgeSnap.exists()
        ? normalizeJudge(judgeSnap.data(), id)
        : makeJudge(id, generation);

      if (getScoringMode(currentMeta) !== "binary") return { status: "wrong_mode", judge: currentJudge };
      if (id < 1 || id > activeJudgeCount(currentMeta)) return { status: "inactive_judge", judge: currentJudge };
      if (!isEvaluationOpen(currentMeta, evaluationId)) {
        return { status: currentMeta.patternResult?.completed ? "completed" : currentMeta.evaluationStarted ? "stale_generation" : "not_started", judge: currentJudge };
      }

      const result = applyFirstBinarySubmission(currentJudge, evaluationId, vote);
      if (result.status === "accepted") transaction.set(ref, result.judge);
      return result;
    });
  };

  const prepareNextEvaluation = async () => runTransaction(db, async (transaction) => {
    const metaSnap = await transaction.get(matchMetaRef);
    const current = ensureMetaShape(metaSnap.exists() ? metaSnap.data() : makeInitialMeta());
    if (!canPrepareNext(current)) return { status: "not_completed", meta: current };
    const next = makeNextEvaluationMeta(current);
    next.updatedAt = Date.now();
    transaction.set(matchMetaRef, next);
    for (let i = 1; i <= MAX_JUDGES; i += 1) {
      transaction.set(judgeRef(i), makeJudge(i, next.evaluationId));
    }
    return { status: "accepted", meta: next };
  });

  const closePointsEvaluation = async (evaluationId) => runTransaction(db, async (transaction) => {
    const metaSnap = await transaction.get(matchMetaRef);
    const current = ensureMetaShape(metaSnap.exists() ? metaSnap.data() : makeInitialMeta());
    const judgeCount = activeJudgeCount(current);
    const judgeSnapshots = [];
    for (let i = 1; i <= judgeCount; i += 1) judgeSnapshots.push(await transaction.get(judgeRef(i)));

    if (getScoringMode(current) !== "points") return { status: "wrong_mode" };
    if (normalizeEvaluationId(current.evaluationId) !== normalizeEvaluationId(evaluationId)) return { status: "stale_generation" };
    if (current.evaluationStarted !== true) return { status: "not_started" };
    if (current.patternResult?.completed === true) return { status: "already_completed" };
    if (!canCloseEvaluation({ time: getDerivedTime(current, Date.now()), allSent: true, completed: false })) {
      return { status: "time_running" };
    }

    const persistedJudges = judgeSnapshots.map((snapshot, index) => snapshot.exists()
      ? normalizeJudge(snapshot.data(), index + 1)
      : makeJudge(index + 1, current.evaluationId));
    if (!persistedJudges.every((judge) => isCurrentPointsSubmission(current, judge))) {
      return { status: "incomplete" };
    }

    const live = patternSummary(current, persistedJudges);
    if (live.sent !== judgeCount || !["hong", "chong", "draw"].includes(live.winner)) return { status: "invalid" };

    current.patternResult = { hong: live.hong, chong: live.chong, sent: live.sent, completed: true, winner: live.winner };
    current.status = "paused";
    current.phase = "finished";
    current.phaseStartedAt = null;
    current.pausedRemaining = 0;
    current.updatedAt = Date.now();
    transaction.set(matchMetaRef, current);
    return { status: "accepted", result: current.patternResult };
  });

  const closeBinaryEvaluation = async (evaluationId) => runTransaction(db, async (transaction) => {
    const metaSnap = await transaction.get(matchMetaRef);
    const current = ensureMetaShape(metaSnap.exists() ? metaSnap.data() : makeInitialMeta());
    const judgeCount = activeJudgeCount(current);
    const judgeSnapshots = [];
    for (let i = 1; i <= judgeCount; i += 1) judgeSnapshots.push(await transaction.get(judgeRef(i)));

    if (getScoringMode(current) !== "binary") return { status: "wrong_mode" };
    if (normalizeEvaluationId(current.evaluationId) !== normalizeEvaluationId(evaluationId)) return { status: "stale_generation" };
    if (current.evaluationStarted !== true) return { status: "not_started" };
    if (current.patternResult?.completed === true) return { status: "already_completed" };
    if (!canCloseEvaluation({ time: getDerivedTime(current, Date.now()), allSent: true, completed: false })) {
      return { status: "time_running" };
    }

    const persistedJudges = judgeSnapshots.map((snapshot, index) => snapshot.exists()
      ? normalizeJudge(snapshot.data(), index + 1)
      : makeJudge(index + 1, current.evaluationId));
    const live = binarySummary(current, persistedJudges);
    if (!live.allSent || (live.winner !== "hong" && live.winner !== "chong")) return { status: "incomplete" };

    current.patternResult = {
      ...(current.patternResult || makeEmptyPatternResult()),
      scoringMode: "binary",
      binary: { hongVotes: live.hong, chongVotes: live.chong, sent: live.sent, majorityRequired: live.majorityRequired },
      completed: true,
      winner: live.winner,
    };
    current.status = "paused";
    current.phase = "finished";
    current.phaseStartedAt = null;
    current.pausedRemaining = 0;
    current.updatedAt = Date.now();
    transaction.set(matchMetaRef, current);
    return { status: "accepted", result: current.patternResult };
  });

  const resetAll = async (evaluationId) => {
    return runTransaction(db, async (transaction) => {
      const metaSnap = await transaction.get(matchMetaRef);
      const current = ensureMetaShape(metaSnap.exists() ? metaSnap.data() : makeInitialMeta());
      if (!isExpectedEvaluation(current, evaluationId)) return { status: "stale_generation", meta: current };
      const next = makeResetEvaluationMeta(current);
      next.updatedAt = Date.now();
      transaction.set(matchMetaRef, next);
      for (let i = 1; i <= MAX_JUDGES; i += 1) {
        transaction.set(judgeRef(i), makeJudge(i, next.evaluationId));
      }
      return { status: "accepted", meta: next };
    });
  };

  return { meta, judges, writeMeta, submitPoints, submitBinary, prepareNextEvaluation, closePointsEvaluation, closeBinaryEvaluation, resetAll };
}

function useRoute() {
  const [path, setPath] = useState(window.location.pathname || "/");

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname || "/");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = (p) => {
    window.history.pushState({}, "", p);
    setPath(p);
  };

  return { path, navigate };
}

const styles = {
  page: {
    background: "linear-gradient(180deg, #07111f 0%, #02060d 100%)",
    color: "white",
    width: "100%",
    height: "100%",
    minHeight: "100%",
    padding: 20,
    boxSizing: "border-box",
    fontFamily: "Arial, sans-serif",
  },
  frameBg: {
    background: "#020814",
    color: "white",
    height: "100vh",
    overflow: "hidden",
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    boxSizing: "border-box",
    fontFamily: "Arial, sans-serif",
  },
  panel: {
    background: "#111",
    border: "1px solid #333",
    borderRadius: 16,
    padding: 16,
  },
  row: {
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
  },
  stat: {
    background: "#111",
    border: "1px solid #333",
    borderRadius: 14,
    padding: 16,
    minWidth: 180,
  },
  button: {
    padding: "14px 18px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.18)",
    color: "white",
    cursor: "pointer",
    fontWeight: "bold",
    boxShadow: "0 0 18px rgba(255,255,255,0.10), inset 0 0 12px rgba(255,255,255,0.05)",
    transition: "transform 0.08s ease, box-shadow 0.12s ease, filter 0.12s ease",
  },
  red: { background: "#b91c1c" },
  blue: { background: "#1d4ed8" },
  amber: { background: "#d97706" },
  green: { background: "#15803d" },
  gray: { background: "#444" },
};

function Frame16x9({ children }) {
  const baseWidth = 1920;
  const baseHeight = 1080;
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const recalc = () => {
      const scaleX = window.innerWidth / baseWidth;
      const scaleY = window.innerHeight / baseHeight;
      setScale(Math.min(scaleX, scaleY));
    };
    recalc();
    window.addEventListener("resize", recalc);
    return () => window.removeEventListener("resize", recalc);
  }, []);

  return (
    <div style={styles.frameBg}>
      <div
        style={{
          width: baseWidth,
          height: baseHeight,
          position: "relative",
          background: "linear-gradient(180deg, #07111f 0%, #02060d 100%)",
          overflow: "hidden",
          transform: `scale(${scale})`,
          transformOrigin: "center center",
          boxSizing: "border-box",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function BrandHeaderLarge() {
  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 30, marginBottom: 14 }}>
      <img src="/logo-universe.png" alt="Hwarang Universe" style={{ height: 180, maxWidth: 360, objectFit: "contain" }} />
      <img src="/logo-patterns.png" alt="Hwarang Patterns" style={{ height: 180, maxWidth: 360, objectFit: "contain" }} />
    </div>
  );
}

function BrandHeaderSmall() {
  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 14, margin: "8px 0 12px" }}>
      <img src="/logo-universe.png" alt="Hwarang Universe" style={{ height: 78, maxWidth: 220, objectFit: "contain" }} />
      <img src="/logo-patterns.png" alt="Hwarang Patterns" style={{ height: 78, maxWidth: 220, objectFit: "contain" }} />
    </div>
  );
}

function AppButton({ children, style = {}, onClick, feedback = "ui", ...props }) {
  const triggerFeedback = () => {
    if (feedback === "judge") tapFeedback();
    else if (feedback === "ui") playButtonSound();
  };

  return (
    <button
      {...props}
      onClick={(e) => {
        triggerFeedback();
        onClick?.(e);
      }}
      style={{ ...styles.button, ...style }}
      onMouseDown={(e) => {
        e.currentTarget.style.transform = "scale(0.985)";
        e.currentTarget.style.filter = "brightness(1.08)";
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = "scale(1)";
        e.currentTarget.style.filter = "brightness(1)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "scale(1)";
        e.currentTarget.style.filter = "brightness(1)";
      }}
    >
      {children}
    </button>
  );
}

function WinnerFullScreen({ winner, zIndex = 50, combatClone = false, mode = "public", onClose }) {
  if (combatClone) {
    if (winner !== "hong" && winner !== "chong" && winner !== "draw") return null;

    const getColor = () => {
      if (winner === "hong") return "#ff1a1a";
      if (winner === "chong") return "#0602e0";
      return "#fff200";
    };

    const getText = () => {
      if (winner === "hong") return "HONG WINNER";
      if (winner === "chong") return "CHONG WINNER";
      return "DRAW";
    };

    const color = getColor();

    return (
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0,0,0,0.90)",
        }}
      >
        <div style={{ textAlign: "center", width: "100%", transform: "translateY(-50px)" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 50 }}>
            <div
              style={{
                color,
                fontWeight: 600,
                fontSize: "clamp(20px, 2.2vw, 30px)",
                letterSpacing: "0.32em",
                WebkitTextStroke: "0.3px rgba(255,255,255,0.25)",
                textShadow: `0 0 4px ${color}, 0 0 10px ${color}66`,
                opacity: 0.9,
              }}
            >
              HWARANG SCORING UNIVERSE<span style={{ fontSize: 10, verticalAlign: "super" }}>™</span>
            </div>
            <div
              style={{
                marginTop: 8,
                width: "330px",
                height: 2,
                background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.85), transparent)",
                backgroundSize: "200% 100%",
                animation: "hwarangLineFlow 3.5s ease-in-out infinite",
                boxShadow: "0 0 10px rgba(255,255,255,0.8)",
                opacity: 0.9,
              }}
            />
          </div>
          <div style={{ transform: "translateY(-50px)" }} />
          <div
            style={{
              color,
              fontWeight: 900,
              fontSize: "clamp(60px, 10vw, 160px)",
              WebkitTextStroke: `1px ${color}`,
              letterSpacing: "0.08em",
              textShadow: `0 0 4px ${color}, 0 0 10px ${color}55`,
              animation: "winnerEnter 0.6s ease-out, winnerPulsePro 1.6s ease-in-out 0.6s infinite",
            }}
          >
            {getText()}
          </div>

          {mode === "president" && (
            <div
              style={{
                position: "absolute",
                left: "50%",
                bottom: -470,
                transform: "translateX(-50%)",
                zIndex: zIndex + 1,
              }}
            >
              <AppButton style={styles.gray} onClick={onClose}>Close</AppButton>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (winner !== "hong" && winner !== "chong" && winner !== "draw") return null;

  const isDraw = winner === "draw";
  const color = winner === "hong" ? "#ff1a1a" : winner === "chong" ? "#0602e0" : "#fff200";
  const glow = winner === "hong"
    ? "0 0 14px rgba(255,26,26,.65), 0 0 32px rgba(255,26,26,.35)"
    : winner === "chong"
      ? "0 0 14px rgba(6,2,224,.65), 0 0 32px rgba(6,2,224,.35)"
      : "0 0 18px rgba(255,242,0,.65), 0 0 42px rgba(255,242,0,.35)";
  const borderPulse = winner === "hong"
    ? "winnerBorderPulseRed"
    : winner === "chong"
      ? "winnerBorderPulseBlue"
      : "winnerBorderPulseYellow";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex,
        background: "rgba(0,0,0,0.92)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        padding: 20,
        fontFamily: "Orbitron, Arial, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          borderRadius: 24,
          marginTop: isDraw ? -36 : -50,
          border: `4px solid ${color}`,
          background: "#050505",
          color,
          textAlign: "center",
          padding: "36px 20px",
          fontWeight: 900,
          boxShadow: glow,
          animation: `winnerEnter 0.45s ease-out, winnerPulsePro 1.6s ease-in-out 0.6s infinite, ${borderPulse} 1.8s ease-in-out infinite`,
        }}
      >
        <div
          style={{
            fontSize: 16,
            letterSpacing: "0.28em",
            marginBottom: 16,
            color: "rgba(255,255,255,0.75)",
            fontWeight: 800,
          }}
        >
          HWARANG SCORING UNIVERSE<span style={{ fontSize: 10, verticalAlign: "super" }}>™</span>
        </div>

        <div style={{ fontSize: isDraw ? 56 : 58, lineHeight: isDraw ? 1 : 0.95, textShadow: "none", letterSpacing: isDraw ? undefined : "0.04em" }}>
          {winner === "hong" ? "HONG" : winner === "chong" ? "CHONG" : "DRAW"}
        </div>

        {!isDraw && (
          <div style={{ fontSize: 44, lineHeight: 0.95, textShadow: "none", letterSpacing: "0.06em", marginTop: 6 }}>
            WINNER
          </div>
        )}

        <div style={{ fontSize: 12, marginTop: 18, color: "rgba(255,255,255,0.5)", letterSpacing: 2, fontWeight: 800 }}>
          WWW.HWARANGSCORING.ORG
        </div>
      </div>

      {mode === "president" && <AppButton style={styles.gray} onClick={onClose}>Close</AppButton>}
    </div>
  );
}

function ScoreChoice({ selected, value, onClick, disabled }) {
  return (
    <button
      onClick={() => {
        tapFeedback({ vibrateMs: 35 });
        onClick();
      }}
      disabled={disabled}
      className={`patterns-judge-points__choice${selected === value ? " is-selected" : ""}`}
      type="button"
    >
      {value}
    </button>
  );
}

function ZeroAbsoluteButton({ active, disabled, onClick, label, bg }) {
  return (
    <button
      onClick={() => {
        tapFeedback({ vibrateMs: 45 });
        onClick();
      }}
      disabled={disabled}
      type="button"
      className={`patterns-judge-points__zero${active ? " is-active" : ""}`}
      style={{ "--points-zero-bg": bg }}
    >
      {active ? `${label} ACTIVADO` : label}
    </button>
  );
}

function JudgePatternBinaryPanel({ vote, sent, sending, canSend, sendError, onSelect, onSend }) {
  const renderSide = (side, label) => {
    const selected = vote === side;
    return (
      <button
        type="button"
        disabled={sent || sending}
        className={`patterns-judge-binary__side patterns-judge-binary__side--${side}${selected ? " is-selected" : ""}`}
        onClick={() => {
          tapFeedback({ vibrateMs: 45 });
          onSelect(side);
        }}
      >
        <div className="patterns-judge-binary__identity">{label}</div>
        <div className="patterns-judge-binary__mark">{selected ? "✓" : "—"}</div>
        <div className="patterns-judge-binary__select-label">{selected ? "SELECTED" : "SELECT"}</div>
      </button>
    );
  };

  return (
    <div className="patterns-judge-binary">
      <div className="patterns-judge-binary__band">BINARY · GUP</div>
      <div className={`patterns-judge-binary__status${sent ? " is-sent" : ""}`}>{sent ? "SENT" : sending ? "SENDING" : sendError ? "SEND ERROR · RETRY" : "SELECT WINNER"}</div>
      <div className="patterns-judge-binary__joystick">
        {renderSide("hong", "HONG")}
        {renderSide("chong", "CHONG")}
      </div>
      <div className="patterns-judge-binary__send-wrap">
        <AppButton className="patterns-judge-binary__send" style={vote && canSend && !sent && !sending ? styles.green : styles.gray} disabled={!vote || !canSend || sent || sending} onClick={onSend}>{sending ? "SENDING" : "SEND"}</AppButton>
      </div>
    </div>
  );
}

function JudgePatternColorPanel({ judge, canSend, sending, sendError, onSelectValue, onSave, onToggleZeroSide }) {
  const sent = !!judge.pattern.sent;
  const locked = sent || sending;
  const hongZero = !!judge.pattern.hong.zero;
  const chongZero = !!judge.pattern.chong.zero;

  const totals = patternTotalsForJudge(judge);
  const complete = isValidPointsSubmission(judge.pattern);

  const toggleValue = (side, field, value) => {
    if (locked) return;
    if (side === "hong" && hongZero) return;
    if (side === "chong" && chongZero) return;

    const current = judge.pattern[side][field] || 0;
    const next = current === value ? 0 : value;
    onSelectValue(side, field, next);
  };

  const SidePanel = ({ side, title }) => (
    <section className={`patterns-judge-points__side patterns-judge-points__side--${side}`}>
      <div className="patterns-judge-points__identity">{title}</div>
      <div className="patterns-judge-points__total">{side === "hong" ? totals.hong : totals.chong}</div>

      <ZeroAbsoluteButton
        active={judge.pattern[side].zero}
        disabled={locked}
        onClick={() => onToggleZeroSide(side)}
        label={`CERO ABSOLUTO ${title}`}
        bg={side === "hong" ? "#7f1d1d" : "#1e3a8a"}
      />

      <div className="patterns-judge-points__criterion">Contenido técnico</div>
      <div className="patterns-judge-points__choices patterns-judge-points__choices--five">{[1, 2, 3, 4, 5].map((n) => <ScoreChoice key={`${side}-tech-${n}`} selected={judge.pattern[side].tech || 0} value={n} disabled={locked || judge.pattern[side].zero} onClick={() => toggleValue(side, "tech", n)} />)}</div>

      <div className="patterns-judge-points__criterion">Poder</div>
      <div className="patterns-judge-points__choices">{[1, 2, 3].map((n) => <ScoreChoice key={`${side}-power-${n}`} selected={judge.pattern[side].power || 0} value={n} disabled={locked || judge.pattern[side].zero} onClick={() => toggleValue(side, "power", n)} />)}</div>

      <div className="patterns-judge-points__criterion">Ritmo</div>
      <div className="patterns-judge-points__choices">{[1, 2, 3].map((n) => <ScoreChoice key={`${side}-rhythm-${n}`} selected={judge.pattern[side].rhythm || 0} value={n} disabled={locked || judge.pattern[side].zero} onClick={() => toggleValue(side, "rhythm", n)} />)}</div>
    </section>
  );

  return (
    <div className="patterns-judge-points">
      <div className="patterns-judge-points__band">POINTS · GUP</div>
      <div className={`patterns-judge-points__status${sent ? " is-sent" : ""}`}>{sent ? "SENT" : sending ? "SENDING" : sendError ? "SEND ERROR · RETRY" : complete ? canSend ? "READY TO SEND" : "WAIT FOR START" : "COMPLETE BOTH SIDES"}</div>

      <div className="patterns-judge-points__joystick">
        <SidePanel side="hong" title={HONG} />
        <SidePanel side="chong" title={CHONG} />
      </div>

      <div className="patterns-judge-points__send-wrap">
        <AppButton className="patterns-judge-points__send" style={complete && canSend && !sent && !sending ? styles.green : styles.gray} disabled={!complete || !canSend || sent || sending} onClick={onSave}>{sending ? "ENVIANDO" : "Guardar / Enviar"}</AppButton>
      </div>
    </div>
  );
}

function JudgePatternReadOnlyCard({ judge }) {
  const totals = patternTotalsForJudge(judge);
  const statusHong = judge.pattern.hong.zero ? " / Hong cero" : "";
  const statusChong = judge.pattern.chong.zero ? " / Chong cero" : "";

  return (
    <div style={styles.panel}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, fontWeight: "bold" }}>
        <span>Juez {judge.id}</span>
        <span>{judge.pattern.sent ? `Enviado${statusHong}${statusChong}` : "Pendiente"}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ ...styles.panel, background: "#2a0606", border: "1px solid #631010" }}>
          <div style={{ fontWeight: "bold" }}>{HONG}</div>
          <div style={{ fontSize: 34, fontWeight: 900 }}>{totals.hong}</div>
        </div>

        <div style={{ ...styles.panel, background: "#07172f", border: "1px solid #174a9c" }}>
          <div style={{ fontWeight: "bold" }}>{CHONG}</div>
          <div style={{ fontSize: 34, fontWeight: 900 }}>{totals.chong}</div>
        </div>
      </div>
    </div>
  );
}

function QRSection({ meta }) {
  const judgesToShow = activeJudgeCount(meta);
  const base = getBaseURL();

  return (
    <div style={{ ...styles.panel, marginTop: 16 }}>
      <h2>QR Conexión</h2>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ marginBottom: 8 }}>Presidente</div>
          <div style={{ background: "white", padding: 10, borderRadius: 12 }}>
            <QRCodeCanvas value={`${base}/president`} size={150} />
          </div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ marginBottom: 8 }}>Pantalla pública</div>
          <div style={{ background: "white", padding: 10, borderRadius: 12 }}>
            <QRCodeCanvas value={`${base}/public`} size={150} />
          </div>
        </div>

        {Array.from({ length: judgesToShow }, (_, i) => i + 1).map((n) => (
          <div key={n} style={{ textAlign: "center" }}>
            <div style={{ marginBottom: 8 }}>Juez {n}</div>
            <div style={{ background: "white", padding: 10, borderRadius: 12 }}>
              <QRCodeCanvas value={`${base}/judge/${n}`} size={150} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Home({ navigate, meta }) {
  const judgesToShow = activeJudgeCount(meta);

  return (
    <Frame16x9>
      <div style={{ ...styles.page, display: "grid", gridTemplateRows: "260px auto 1fr", alignContent: "start" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <BrandHeaderLarge />
        </div>

        <div style={{ textAlign: "center", marginTop: -20 }}>
          <h1 style={{ margin: 0, fontSize: 62 }}>Hwarang Scoring Patterns Gups</h1>
          <p style={{ fontSize: 28, opacity: 0.9 }}>Elegí una pantalla</p>
        </div>

        <div style={{ ...styles.panel, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", marginTop: 20 }}>
          <div style={styles.row}>
            <AppButton style={{ ...styles.green, boxShadow: "0 0 20px rgba(34,197,94,0.35)" }} onClick={() => navigate("/president")}>Presidente</AppButton>
            <AppButton style={{ ...styles.blue, boxShadow: "0 0 20px rgba(59,130,246,0.35)" }} onClick={() => navigate("/public")}>Pantalla pública</AppButton>
            {Array.from({ length: judgesToShow }, (_, i) => i + 1).map((n) => (
              <AppButton key={n} style={{ ...styles.red, boxShadow: "0 0 20px rgba(239,68,68,0.35)" }} onClick={() => navigate(`/judge/${n}`)}>Juez {n}</AppButton>
            ))}
          </div>
        </div>
      </div>
    </Frame16x9>
  );
}

function PublicCompetitorPanel({ fighter, title, side, total, position, scoreCaption = "TOTAL" }) {
  return (
    <section className={`patterns-public__competitor patterns-public__competitor--${side} patterns-public__competitor--${position}`}>
      <div className="patterns-public__side-glow" />
      <div className="patterns-public__side-label">{title}</div>
      <div className="patterns-public__identity">
        <div className="patterns-public__name">{fighter.name || title}</div>
        <div className="patterns-public__club">
          {fighter.club || "ACADEMY / TEAM"}
        </div>
      </div>
      <div className="patterns-public__score-block">
        <div className="patterns-public__score-caption">{scoreCaption}</div>
        <div className="patterns-public__score">{total}</div>
      </div>
    </section>
  );
}

function PublicScreen({ meta, judges, navigate }) {
  const time = useClock(meta);
  const p = meta.patternResult || makeEmptyPatternResult();
  const scoringMode = getScoringMode(meta);
  const binaryMode = scoringMode === "binary";
  const { left, right } = getDisplaySides(meta, "public");
  const publicJudges = activeJudges(meta, judges);
  const binary = binarySummary(meta, judges);
  const revealBinaryVoting = binaryMode && time === 0 && binary.allSent;
  const revealPointsVoting = !binaryMode
    && time === 0
    && publicJudges.length > 0
    && publicJudges.every((judge) => isCurrentPointsSubmission(meta, judge));
  const evaluationStatus = meta.patternResult?.completed
    ? "FINISHED"
    : revealBinaryVoting
      ? "DECISION READY"
      : meta.phase === "finished"
        ? "FINISHED"
    : meta.status === "running"
      ? "EVALUATING"
      : meta.status === "paused"
          && meta.phase === "fight"
          && Number(meta.pausedRemaining) < Number(meta.config?.roundSeconds)
        ? "PAUSED"
        : "READY";

  return (
    <>
      <main className="patterns-public">
      <button
        type="button"
        className="patterns-public__home"
        onClick={() => navigate("/")}
        aria-label="Home"
      >
        <span aria-hidden="true">⌂</span>
      </button>

      <div className="patterns-public__ambient patterns-public__ambient--red" />
      <div className="patterns-public__ambient patterns-public__ambient--blue" />
      <header className="patterns-public__header">
          <div className="patterns-public__live-block">
            <div className="patterns-public__screen-label">PUBLIC TV SCREEN</div>
            <div className="patterns-public__live-status">
              <span aria-hidden="true" />
              <strong>LIVE</strong>
            </div>
          </div>
          <div className="patterns-public__title-lockup">
            <div className="patterns-public__eyebrow">HWARANG SCORING UNIVERSE™</div>
            <div className="patterns-public__product-stage">
              <span className="patterns-public__title-scan" aria-hidden="true" />
              <div className="patterns-public__product">PATTERNS</div>
            </div>
            <div className="patterns-public__discipline">GUP MATCH</div>
          </div>
      </header>

      <div className="patterns-public__arena">
          <PublicCompetitorPanel
            fighter={meta[left.color]}
            title={left.visualLabel}
            side={left.color}
            total={binaryMode ? revealBinaryVoting ? binary[left.color] : "--" : left.color === "hong" ? p.hong || 0 : p.chong || 0}
            scoreCaption={binaryMode && revealBinaryVoting ? "VOTES" : "TOTAL"}
            position="left"
          />

          <section className="patterns-public__center">
            <div className="patterns-public__timer-shell">
              <div className="patterns-public__timer-label">TIME</div>
              <div className="patterns-public__timer">{formatTime(time)}</div>
            </div>

            <div
              className={`patterns-public__status patterns-public__status--${
                meta.patternResult?.completed
                  ? "complete"
                  : meta.status === "running"
                    ? "running"
                    : "ready"
              }`}
            >
              {evaluationStatus}
            </div>

            <div className="patterns-public__judges">
              <div className="patterns-public__judges-title">
                JUDGES <strong>{activeJudgeCount(meta)}</strong>
              </div>
              <div
                className="patterns-public__judge-grid"
                style={{ "--patterns-judge-count": publicJudges.length }}
              >
                {publicJudges.map((judge) => {
                  const binary = judge.pattern?.binary;
                  const sent = binaryMode
                    ? isCurrentBinarySubmission(meta, judge)
                    : isCurrentPointsSubmission(meta, judge);
                  let revealedDecision = null;
                  if (binaryMode && revealBinaryVoting && sent) {
                    revealedDecision = binary.vote;
                  } else if (!binaryMode && revealPointsVoting && sent) {
                    const totals = patternTotalsForJudge(judge);
                    revealedDecision = totals.hong > totals.chong
                      ? "hong"
                      : totals.chong > totals.hong
                        ? "chong"
                        : "draw";
                  }
                  const decisionLetter = revealedDecision === "hong" ? "H" : revealedDecision === "chong" ? "C" : revealedDecision === "draw" ? "D" : "";
                  return (
                    <div
                      className={`patterns-public__judge-indicator ${sent ? "patterns-public__judge-indicator--sent" : "patterns-public__judge-indicator--pending"}${revealedDecision ? ` patterns-public__judge-indicator--vote-${revealedDecision}` : ""}`}
                      key={judge.id}
                    >
                      <span>J{judge.id}</span>
                      <i aria-hidden="true">{decisionLetter}</i>
                      <small>{sent ? "SENT" : "PENDING"}</small>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <PublicCompetitorPanel
            fighter={meta[right.color]}
            title={right.visualLabel}
            side={right.color}
            total={binaryMode ? revealBinaryVoting ? binary[right.color] : "--" : right.color === "hong" ? p.hong || 0 : p.chong || 0}
            scoreCaption={binaryMode && revealBinaryVoting ? "VOTES" : "TOTAL"}
            position="right"
          />
      </div>

      <footer className="patterns-public__footer">
          <span />
          <strong>HWARANG SCORING UNIVERSE™ · OFFICIAL PATTERNS SYSTEM</strong>
          <span />
      </footer>

      </main>

      {!!meta.patternResult?.completed && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100 }}>
          <Frame16x9>
            <WinnerFullScreen winner={meta.patternResult?.winner} zIndex={100} combatClone />
          </Frame16x9>
        </div>
      )}
    </>
  );
}

function PresidentScreen({ meta, judges, writeMeta, prepareNextEvaluation, closePointsEvaluation, closeBinaryEvaluation, resetAll, navigate }) {
  meta = ensureMetaShape(meta);
  const time = useClock(meta);
  const p = patternSummary(meta, judges);
  const prevRunningRef = useRef(false);
  const prevFinishedRef = useRef(false);
  const [secondsInput, setSecondsInput] = useState(String(meta.config.roundSeconds || 120));
  const [editor, setEditor] = useState({
    hongName: meta.hong?.name || "",
    hongClub: meta.hong?.club || "",
    chongName: meta.chong?.name || "",
    chongClub: meta.chong?.club || "",
  });
  const editorFocusRef = useRef(false);
  const editorDraftRef = useRef({
    hongName: meta.hong?.name || "",
    hongClub: meta.hong?.club || "",
    chongName: meta.chong?.name || "",
    chongClub: meta.chong?.club || "",
  });
  const currentJudges = activeJudges(meta, judges);
  const scoringMode = getScoringMode(meta);
  const binary = binarySummary(meta, judges);
  const activeSummary = scoringMode === "binary" ? binary : p;
  const scoringModeLocked = currentJudges.some((judge) => {
    if (scoringMode === "points") return isCurrentPointsSubmission(meta, judge);
    return isCurrentBinarySubmission(meta, judge);
  });
  const configurationLocked = isConfigurationLocked(meta);
  const [hidePresidentWinner, setHidePresidentWinner] = useState(false);
  const [commandPending, setCommandPending] = useState(null);
  const commandPendingRef = useRef(false);
  const editorSaveTimeoutRef = useRef(null);
  const { left, right } = getDisplaySides(meta, "president");

  const runCriticalAction = async (name, action) => {
    if (commandPendingRef.current) return;
    commandPendingRef.current = true;
    setCommandPending(name);
    try {
      return await action();
    } finally {
      commandPendingRef.current = false;
      setCommandPending(null);
    }
  };

  useEffect(() => {
    const next = {
      hongName: meta.hong?.name || "",
      hongClub: meta.hong?.club || "",
      chongName: meta.chong?.name || "",
      chongClub: meta.chong?.club || "",
    };
    editorDraftRef.current = next;
    if (editorFocusRef.current) return;
    setEditor((current) => (
      current.hongName === next.hongName &&
      current.hongClub === next.hongClub &&
      current.chongName === next.chongName &&
      current.chongClub === next.chongClub
    ) ? current : next);
  }, [meta.hong?.name, meta.hong?.club, meta.chong?.name, meta.chong?.club]);

  const commitEditor = async (nextEditor) => {
    const expectedEvaluationId = meta.evaluationId;
    const finalEditor = nextEditor || editorDraftRef.current;
    const unchanged =
      (meta.hong?.name || "") === finalEditor.hongName &&
      (meta.hong?.club || "") === finalEditor.hongClub &&
      (meta.chong?.name || "") === finalEditor.chongName &&
      (meta.chong?.club || "") === finalEditor.chongClub;

    if (unchanged) return;

    await writeMeta((current) => !isExpectedEvaluation(current, expectedEvaluationId) ? current : ({
      ...current,
      hong: {
        ...(current.hong || getBaseCompetitor(HONG)),
        name: finalEditor.hongName,
        club: finalEditor.hongClub,
      },
      chong: {
        ...(current.chong || getBaseCompetitor(CHONG)),
        name: finalEditor.chongName,
        club: finalEditor.chongClub,
      },
    }));
  };

  const queueEditorCommit = (nextEditor) => {
    if (editorSaveTimeoutRef.current) clearTimeout(editorSaveTimeoutRef.current);
    editorSaveTimeoutRef.current = setTimeout(() => {
      commitEditor(nextEditor);
    }, 250);
  };

  const updateEditorField = (field, value) => {
    setEditor((current) => {
      const next = { ...current, [field]: value };
      editorDraftRef.current = next;
      queueEditorCommit(next);
      return next;
    });
  };

  useEffect(() => () => {
    if (editorSaveTimeoutRef.current) clearTimeout(editorSaveTimeoutRef.current);
  }, []);

  useEffect(() => {
    const isRunning = meta.status === "running" && meta.phase === "fight";
    if (isRunning && !prevRunningRef.current) playStartAlarm();
    prevRunningRef.current = isRunning;
  }, [meta.status, meta.phase]);

  useEffect(() => {
    const isFinished = !!meta.patternResult?.completed;
    if (isFinished && !prevFinishedRef.current) {
      playEndAlarm();
      setTimeout(() => playWinnerSound(), 320);
    }
    prevFinishedRef.current = isFinished;
  }, [meta.patternResult?.completed]);

  useEffect(() => {
    if (meta.patternResult?.completed) setHidePresidentWinner(false);
  }, [meta.patternResult?.completed, meta.patternResult?.winner]);

  useEffect(() => {
    if (meta.status !== "running") return;
    if (meta.phase === "finished") return;
    if (time > 0) return;

    const expectedEvaluationId = meta.evaluationId;
    const finishByTime = async () => {
      await writeMeta((current) => {
        if (!isExpectedEvaluation(current, expectedEvaluationId)) return current;
        if (current.status !== "running") return current;
        current.status = "paused";
        current.phase = "finished";
        current.phaseStartedAt = null;
        current.pausedRemaining = 0;
        return current;
      });
    };

    finishByTime();
  }, [meta.status, meta.phase, meta.evaluationId, time, writeMeta]);

  useEffect(() => {
    setSecondsInput(String(meta.config.roundSeconds || 120));
  }, [meta.config.roundSeconds]);

  const saveConfig = async ({ preserveRemaining = false } = {}) => {
    if (configurationLocked) return;
    const expectedEvaluationId = meta.evaluationId;
    const parsedSeconds = Number(secondsInput);
    const roundSeconds = Number.isSafeInteger(parsedSeconds) && parsedSeconds >= 1 ? parsedSeconds : 120;

    await writeMeta((current) => !isExpectedEvaluation(current, expectedEvaluationId) || isConfigurationLocked(current) ? current : ({
        ...current,
        config: { ...(current.config || {}), roundSeconds },
        pausedRemaining: current.status === "paused" && current.phase === "fight" && !preserveRemaining
          ? roundSeconds
          : current.pausedRemaining,
      }));
  };

  const setPatternJudgeCount = async (count) => {
    if (configurationLocked) return;
    const expectedEvaluationId = meta.evaluationId;
    await writeMeta((current) => !isExpectedEvaluation(current, expectedEvaluationId)
      ? current
      : applyJudgeCountChange(current, count).meta);
  };

  const setScoringMode = async (mode) => {
    if (scoringModeLocked || configurationLocked) return;
    const expectedEvaluationId = meta.evaluationId;
    const nextMode = mode === "binary" ? "binary" : "points";
    await writeMeta((current) => !isExpectedEvaluation(current, expectedEvaluationId) || isConfigurationLocked(current) ? current : ({
        ...current,
        config: { ...(current.config || {}), scoringMode: nextMode },
      }));
  };

  const startTimer = async () => {
    const expectedEvaluationId = meta.evaluationId;
    return runCriticalAction("start", async () => {
      const isResume = meta.status === "paused"
        && meta.phase === "fight"
        && Number(meta.pausedRemaining) < Number(meta.config?.roundSeconds);
      await commitEditor(editorDraftRef.current);
      await saveConfig({ preserveRemaining: isResume });

      await writeMeta((current) => {
        if (!isExpectedEvaluation(current, expectedEvaluationId)) return current;
        if (current.status === "running") return current;
        if (current.patternResult?.completed || current.phase === "finished" || Number(current.pausedRemaining) <= 0) return current;
        return { ...current, evaluationStarted: true, status: "running", phaseStartedAt: Date.now() };
      });
    });
  };

  const pauseTimer = async () => {
    const expectedEvaluationId = meta.evaluationId;
    return runCriticalAction("pause", () => writeMeta((current) => {
        if (!isExpectedEvaluation(current, expectedEvaluationId)) return current;
        if (current.status !== "running" || current.patternResult?.completed) return current;
        current.pausedRemaining = getDerivedTime(current, Date.now());
        current.status = "paused";
        current.phaseStartedAt = null;
        return current;
      }));
  };

  const closePatternEvaluation = async () => {
    return runCriticalAction("close", async () => {
      if (getScoringMode(meta) === "binary") return closeBinaryEvaluation(meta.evaluationId);
      return closePointsEvaluation(meta.evaluationId);
    });
  };

  const prepareNextMatch = async () => {
    return runCriticalAction("next", prepareNextEvaluation);
  };

  const resetEvaluation = async () => runCriticalAction("reset", () => resetAll(meta.evaluationId));

  const swapPublicSides = async () => runCriticalAction("swap-public", () => writeMeta((current) => {
    current.publicSwapSides = !current.publicSwapSides;
    return current;
  }));

  const swapPresidentSides = async () => runCriticalAction("swap-president", () => writeMeta((current) => {
    current.presidentSwapSides = !current.presidentSwapSides;
    return current;
  }));

  const applyPatternForcedWinner = async (winner) => {
    if (getScoringMode(meta) === "binary" && winner === "draw") return;
    if (meta.patternResult?.completed) return;
    const expectedEvaluationId = meta.evaluationId;
    return runCriticalAction("forced", () => writeMeta((current) => {
      if (!isExpectedEvaluation(current, expectedEvaluationId)) return current;
      if (current.patternResult?.completed) return current;
      if (getScoringMode(current) === "binary" && winner === "draw") return current;
      current.patternResult = {
        ...current.patternResult,
        ...(getScoringMode(current) === "binary" ? { scoringMode: "binary" } : {}),
        completed: true,
        winner,
      };
      current.phase = "finished";
      current.status = "paused";
      current.pausedRemaining = 0;
      current.phaseStartedAt = null;
      return current;
    }));
  };

  const updateCompetitor = async (side, field, value) => {
    await writeMeta((current) => {
      current[side] = current[side] || getBaseCompetitor(side === "hong" ? HONG : CHONG);
      current[side][field] = value;
      return current;
    });
  };

  const showPresidentWinner = !!meta.patternResult?.completed;
  const presidentStatus = meta.patternResult?.completed || meta.phase === "finished"
    ? "FINISHED"
    : meta.status === "running"
      ? "EVALUATING"
      : meta.status === "paused"
          && meta.phase === "fight"
          && Number(meta.pausedRemaining) < Number(meta.config?.roundSeconds)
        ? "PAUSED"
        : "READY";

  return (
    <Frame16x9>
      <div className="patterns-president">
        <header className="patterns-president__header">
          <nav className="patterns-president__actions" aria-label="President controls">
            <AppButton className="patterns-president__action patterns-president__action--home" style={styles.gray} onClick={() => navigate("/")}><span aria-hidden="true">⌂</span> HOME</AppButton>
            <AppButton className="patterns-president__action patterns-president__action--next" style={styles.green} disabled={!!commandPending || !meta.patternResult?.completed} onClick={prepareNextMatch}><span aria-hidden="true">→</span> NEXT</AppButton>
            <AppButton className="patterns-president__action patterns-president__action--reset" style={styles.red} disabled={!!commandPending} onClick={resetEvaluation}><span aria-hidden="true">↻</span> RESET</AppButton>
            <AppButton
              className={`patterns-president__action patterns-president__action--swap${meta.publicSwapSides ? " patterns-president__action--active" : ""}`}
              style={styles.purple}
              disabled={!!commandPending}
              onClick={swapPublicSides}
            >
              <span aria-hidden="true">⇄</span> SWAP PUBLIC
            </AppButton>
            <AppButton
              className={`patterns-president__action patterns-president__action--swap${meta.presidentSwapSides ? " patterns-president__action--active" : ""}`}
              style={styles.purple}
              disabled={!!commandPending}
              onClick={swapPresidentSides}
            >
              <span aria-hidden="true">⇄</span> SWAP PRESIDENT
            </AppButton>
          </nav>

          <div className="patterns-president__brand" aria-label="Hwarang Scoring Universe Patterns GUP Match">
            <span>HWARANG SCORING UNIVERSE™</span>
            <strong>PATTERNS</strong>
            <small>GUP MATCH</small>
          </div>
        </header>

        <section className="patterns-president__hud">
          <div className="patterns-president__hud-cell patterns-president__hud-status">
            <span>STATUS</span>
            <strong>{presidentStatus}</strong>
            <small>{scoringMode.toUpperCase()} · GUP MATCH</small>
          </div>
          <div className={`patterns-president__hud-cell patterns-president__hud-timer${meta.status === "running" ? " is-running" : ""}`}>
            <span>EVALUATION TIME</span>
            <strong>{formatTime(time)}</strong>
          </div>
          <div className="patterns-president__hud-cell patterns-president__hud-judges">
            <span>JUDGES</span>
            <strong>{p.sent} / {activeJudgeCount(meta)}</strong>
            <small>SENT</small>
          </div>
        </section>

        <section className="patterns-president__competitors">
          {[left, right].map((fighter) => {
            const side = fighter.color;
            return (
              <div className={`patterns-president__competitor patterns-president__competitor--${side}`} key={side}>
                <strong>{fighter.visualLabel} DATA</strong>
                <div className="patterns-president__competitor-inputs">
                  <input
                    value={side === "hong" ? editor.hongName : editor.chongName}
                    onFocus={() => { editorFocusRef.current = true; }}
                    onChange={(e) => updateEditorField(side === "hong" ? "hongName" : "chongName", e.target.value)}
                    onBlur={async () => { editorFocusRef.current = false; await commitEditor(editorDraftRef.current); }}
                    placeholder="NAME"
                  />
                  <input
                    value={side === "hong" ? editor.hongClub : editor.chongClub}
                    onFocus={() => { editorFocusRef.current = true; }}
                    onChange={(e) => updateEditorField(side === "hong" ? "hongClub" : "chongClub", e.target.value)}
                    onBlur={async () => { editorFocusRef.current = false; await commitEditor(editorDraftRef.current); }}
                    placeholder="ACADEMY / TEAM"
                  />
                </div>
              </div>
            );
          })}
        </section>

        <section className="patterns-president__configuration">
          <div className="patterns-president__panel patterns-president__settings">
            <h2>EVALUATION SETTINGS</h2>
            <div className="patterns-president__settings-main">
              <input type="number" min="1" disabled={configurationLocked || !!commandPending} value={secondsInput} onChange={(e) => setSecondsInput(e.target.value)} aria-label="Evaluation time in seconds" />
              <div className="patterns-president__presets">
                {[60, 90, 120, 180, 300].map((seconds) => (
                  <AppButton
                    key={seconds}
                    className={`patterns-president__preset${String(secondsInput) === String(seconds) ? " is-active" : ""}`}
                    style={styles.gray}
                    disabled={configurationLocked || !!commandPending}
                    onClick={() => setSecondsInput(String(seconds))}
                  >
                    {seconds}
                  </AppButton>
                ))}
              </div>
            </div>
            <div className="patterns-president__settings-actions">
              <AppButton style={meta.config.patternJudges === 3 ? styles.green : styles.gray} disabled={configurationLocked || !!commandPending} onClick={() => setPatternJudgeCount(3)}>3 JUDGES</AppButton>
              <AppButton style={meta.config.patternJudges === 5 ? styles.green : styles.gray} disabled={configurationLocked || !!commandPending} onClick={() => setPatternJudgeCount(5)}>5 JUDGES</AppButton>
              <AppButton style={styles.blue} disabled={configurationLocked || !!commandPending} onClick={saveConfig}>SAVE CONFIG</AppButton>
              <div className="patterns-president__scoring-mode">
                <span>SCORING MODE</span>
                <AppButton className={`patterns-president__scoring-option patterns-president__scoring-option--points${scoringMode === "points" ? " is-active" : ""}`} disabled={scoringModeLocked || configurationLocked || !!commandPending} onClick={() => setScoringMode("points")}>POINTS</AppButton>
                <AppButton className={`patterns-president__scoring-option patterns-president__scoring-option--binary${scoringMode === "binary" ? " is-active" : ""}`} disabled={scoringModeLocked || configurationLocked || !!commandPending} onClick={() => setScoringMode("binary")}>BINARY</AppButton>
              </div>
            </div>
          </div>

          <div className="patterns-president__panel patterns-president__match-control">
            <h2>MATCH CONTROL</h2>
            <div>
              <AppButton style={styles.green} disabled={!!commandPending || meta.status === "running" || meta.phase === "finished" || meta.patternResult?.completed || Number(meta.pausedRemaining) <= 0} onClick={startTimer}><span aria-hidden="true">▶</span> START</AppButton>
              <AppButton style={styles.amber} disabled={!!commandPending || meta.status !== "running" || meta.patternResult?.completed} onClick={pauseTimer}><span aria-hidden="true">Ⅱ</span> PAUSE</AppButton>
              <AppButton style={styles.blue} disabled={!!commandPending || !canCloseEvaluation({ time, allSent: scoringMode === "binary" ? binary.allSent : p.sent === activeJudgeCount(meta), completed: meta.patternResult?.completed })} onClick={closePatternEvaluation}><span aria-hidden="true">⚑</span> CLOSE EVALUATION</AppButton>
            </div>
          </div>
        </section>

        <section className="patterns-president__judge-band" style={{ "--patterns-president-judges": currentJudges.length }}>
          {currentJudges.map((judge) => {
            const totals = patternTotalsForJudge(judge);
            const binaryVote = judge.pattern?.binary;
            const sent = scoringMode === "binary"
              ? isCurrentBinarySubmission(meta, judge)
              : isCurrentPointsSubmission(meta, judge);
            return (
              <article className={`patterns-president__judge${sent ? " is-sent" : " is-pending"}`} key={judge.id}>
                <div className="patterns-president__judge-heading">
                  <strong>JUDGE {judge.id}</strong>
                  <span><i aria-hidden="true" />{sent ? "SENT" : "PENDING"}</span>
                </div>
                <div className={`patterns-president__judge-scores${scoringMode === "binary" ? " is-binary" : ""}`}>
                  {[left, right].map((fighter) => {
                    const side = fighter.color;
                    const selected = scoringMode === "binary" && sent && binaryVote.vote === side;
                    return (
                      <div className={`is-${side}${selected ? " is-selected" : ""}`} key={side}>
                        <span>{fighter.visualLabel}</span>
                        <strong>{scoringMode === "binary" ? selected ? fighter.visualLabel : "—" : totals[side]}</strong>
                        {scoringMode === "points" && <small>{judge.pattern?.[side]?.zero ? `${fighter.visualLabel} ABSOLUTE ZERO` : ""}</small>}
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </section>

        <section className="patterns-president__bottom-band">
          <div className="patterns-president__aggregate">
            <span>AGGREGATE RESULT</span>
            {[left, right].map((fighter) => {
              const side = fighter.color;
              return (
                <div className={`is-${side}`} key={side}>
                  <small>{fighter.visualLabel} {scoringMode === "binary" ? "VOTES" : "TOTAL"}</small>
                  <strong>{scoringMode === "binary" ? binary[side] : p[side]}</strong>
                </div>
              );
            })}
            <div>
              <small>JUDGES SENT</small>
              <strong>{activeSummary.sent}/{activeJudgeCount(meta)}</strong>
              {scoringMode === "binary" && <small>MAJORITY {binary.majorityRequired}</small>}
            </div>
          </div>

          <div className="patterns-president__secondary">
            <span>FORCED DECISION</span>
            <AppButton style={styles.red} disabled={!!commandPending || meta.patternResult?.completed} onClick={() => applyPatternForcedWinner("hong")}>HONG WINNER</AppButton>
            <AppButton style={styles.blue} disabled={!!commandPending || meta.patternResult?.completed} onClick={() => applyPatternForcedWinner("chong")}>CHONG WINNER</AppButton>
            <AppButton style={styles.gray} disabled={!!commandPending || meta.patternResult?.completed || scoringMode === "binary"} onClick={() => applyPatternForcedWinner("draw")}>DRAW</AppButton>
            <details>
              <summary>QR ACCESS</summary>
              <div className="patterns-president__qr-overlay">
                <button
                  type="button"
                  className="patterns-president__qr-back"
                  onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}
                >
                  <span aria-hidden="true">←</span> BACK
                </button>
                <QRSection meta={meta} />
              </div>
            </details>
          </div>
        </section>

        {showPresidentWinner && !hidePresidentWinner && (
          <WinnerFullScreen
            winner={meta.patternResult.winner}
            zIndex={100}
            combatClone
            mode="president"
            onClose={() => setHidePresidentWinner(true)}
          />
        )}
      </div>
    </Frame16x9>
  );
}

function JudgeScreen({ meta, judges, submitPoints, submitBinary, judgeId, navigate }) {
  useWakeLock();
  const time = useClock(meta);
  const prevFinishedRef = useRef(false);

  useEffect(() => {
    const isFinished = !!meta.patternResult?.completed;
    if (isFinished && !prevFinishedRef.current) {
      playWinnerSound();
    }
    prevFinishedRef.current = isFinished;
  }, [meta.patternResult?.completed]);

  const judge = judges.find((j) => j.id === judgeId) || makeJudge(judgeId);
  const [localPattern, setLocalPattern] = useState(() => clone(judge.pattern));
  const [localBinaryVote, setLocalBinaryVote] = useState(() => judge.pattern.binary.vote);
  const [localBinarySent, setLocalBinarySent] = useState(() => !!judge.pattern.binary.sent);
  const [pointsSendState, setPointsSendState] = useState(judge.pattern.sent ? "sent" : "idle");
  const [binarySendState, setBinarySendState] = useState(judge.pattern.binary.sent ? "sent" : "idle");
  const pointsSendingRef = useRef(false);
  const binarySendingRef = useRef(false);
  const serializedJudgePattern = JSON.stringify(judge.pattern);
  const persistedPointsSent = isCurrentPointsSubmission(meta, judge);
  const persistedBinaryVote = judge.pattern.binary.vote;
  const persistedBinarySent = isCurrentBinarySubmission(meta, judge);

  useEffect(() => {
    setLocalPattern(JSON.parse(serializedJudgePattern));
    setPointsSendState(persistedPointsSent ? "sent" : "idle");
  }, [judgeId, meta.evaluationId, serializedJudgePattern, persistedPointsSent]);

  useEffect(() => {
    setLocalBinaryVote(persistedBinaryVote);
    setLocalBinarySent(persistedBinarySent);
    setBinarySendState(persistedBinarySent ? "sent" : "idle");
  }, [judgeId, meta.evaluationId, persistedBinaryVote, persistedBinarySent]);

  const selectPatternValue = (side, field, value) => {
    setLocalPattern((prev) => ({
      ...prev,
      [side]: {
        ...prev[side],
        [field]: value,
      },
      sent: false,
    }));
  };

  const togglePatternZeroSide = (side) => {
    setLocalPattern((prev) => {
      const willBeZero = !prev[side].zero;
      return {
        ...prev,
        [side]: {
          ...prev[side],
          zero: willBeZero,
          tech: willBeZero ? 0 : prev[side].tech,
          power: willBeZero ? 0 : prev[side].power,
          rhythm: willBeZero ? 0 : prev[side].rhythm,
        },
        sent: false,
      };
    });
  };

  const savePattern = async () => {
    if (pointsSendingRef.current || !isValidPointsSubmission(localPattern)) return;
    pointsSendingRef.current = true;
    setPointsSendState("sending");
    try {
      const result = await submitPoints(judgeId, meta.evaluationId, localPattern);
      if (result.status === "accepted" || result.status === "already_sent") {
        setLocalPattern(clone(result.judge.pattern));
        setPointsSendState("sent");
      } else {
        setPointsSendState("error");
      }
    } catch {
      setPointsSendState("error");
    } finally {
      pointsSendingRef.current = false;
    }
  };

  const saveBinaryVote = async () => {
    if (!localBinaryVote || localBinarySent || binarySendingRef.current) return;
    binarySendingRef.current = true;
    setBinarySendState("sending");
    try {
      const result = await submitBinary(judgeId, meta.evaluationId, localBinaryVote);
      if (result.status === "accepted" || result.status === "already_sent") {
        setLocalBinaryVote(result.judge.pattern.binary.vote);
        setLocalBinarySent(true);
        setBinarySendState("sent");
      } else {
        setBinarySendState("error");
      }
    } catch {
      setBinarySendState("error");
    } finally {
      binarySendingRef.current = false;
    }
  };

  const judgeWinner = meta.patternResult?.winner;
  const showJudgeWinner = !!meta.patternResult?.completed;
  const judgePreview = { ...judge, pattern: localPattern };
  const scoringMode = getScoringMode(meta);
  const currentGeneration = normalizeEvaluationId(meta.evaluationId);
  const pointsGenerationMatches = normalizeEvaluationId(localPattern.evaluationId) === currentGeneration;
  const binaryGenerationMatches = normalizeEvaluationId(judge.pattern.binary.evaluationId) === currentGeneration;
  const evaluationAcceptsVotes = meta.evaluationStarted === true && meta.patternResult?.completed !== true;
  const judgeStatus = meta.phase === "finished"
    ? "FINISHED"
    : meta.status === "running"
      ? "EVALUATING"
      : meta.status === "paused"
          && meta.phase === "fight"
          && Number(meta.pausedRemaining) < Number(meta.config?.roundSeconds)
        ? "PAUSED"
        : "READY";

  if (judgeId > activeJudgeCount(meta)) {
    return (
      <div style={styles.page}>
        <AppButton style={{ ...styles.gray, boxShadow: "0 0 18px rgba(255,255,255,0.16)" }} onClick={() => navigate("/")}>Inicio</AppButton>
        <BrandHeaderSmall />
        <h1>Juez {judgeId}</h1>
        <div style={styles.panel}>Este juez no está activo en la configuración actual.</div>
      </div>
    );
  }

  return (
    <div className={scoringMode === "binary" ? "patterns-judge-page patterns-judge-page--binary" : "patterns-judge-page patterns-judge-page--points"} style={{ ...styles.page, background: "#06101c", minHeight: "100vh" }}>
      <AppButton className={scoringMode === "binary" ? "patterns-judge-page__home" : "patterns-judge-points__exit"} style={{ ...styles.gray, boxShadow: "0 0 18px rgba(255,255,255,0.16)" }} onClick={() => navigate("/")}>EXIT</AppButton>

      {scoringMode === "binary" ? (
        <div className="patterns-judge-page__brand" aria-label="Hwarang Scoring Universe Patterns GUP">
          <img src="/logoooo.png" alt="Hwarang Scoring Universe" />
          <small>PATTERNS GUP</small>
        </div>
      ) : (
        <div className="patterns-judge-points__brand" aria-label="Hwarang Scoring Universe Patterns GUP">
          <img src="/logoooo.png" alt="Hwarang Scoring Universe" />
          <small>PATTERNS GUP</small>
        </div>
      )}

      <h1 className={scoringMode === "binary" ? "patterns-judge-page__title" : "patterns-judge-points__title"}>Juez {judgeId}</h1>

      {scoringMode === "binary" ? (
        <div className="patterns-judge-page__stats">
          <div className="patterns-judge-page__stat"><span>TIME</span><strong>{formatTime(time)}</strong></div>
          <div className="patterns-judge-page__stat"><span>STATUS</span><strong>{judgeStatus}</strong></div>
        </div>
      ) : (
        <div className="patterns-judge-points__stats">
          <div className="patterns-judge-points__stat"><span>TIME</span><strong>{formatTime(time)}</strong></div>
          <div className="patterns-judge-points__stat"><span>STATUS</span><strong>{judgeStatus}</strong></div>
        </div>
      )}

      <div className={scoringMode === "binary" ? "patterns-judge-page__content" : "patterns-judge-points__content"} style={{ marginTop: 16 }}>
        {scoringMode === "binary" ? (
          <JudgePatternBinaryPanel
            vote={localBinaryVote}
            sent={localBinarySent}
            sending={binarySendState === "sending"}
            sendError={binarySendState === "error"}
            canSend={evaluationAcceptsVotes && binaryGenerationMatches}
            onSelect={setLocalBinaryVote}
            onSend={saveBinaryVote}
          />
        ) : (
          <JudgePatternColorPanel
            judge={judgePreview}
            canSend={evaluationAcceptsVotes && pointsGenerationMatches}
            sending={pointsSendState === "sending"}
            sendError={pointsSendState === "error"}
            onSelectValue={selectPatternValue}
            onSave={savePattern}
            onToggleZeroSide={togglePatternZeroSide}
          />
        )}
      </div>

      {showJudgeWinner && <WinnerFullScreen winner={judgeWinner} />}
    </div>
  );
}

export default function App() {
  const { meta, judges, writeMeta, submitPoints, submitBinary, prepareNextEvaluation, closePointsEvaluation, closeBinaryEvaluation, resetAll } = useFightData();
  const { path, navigate } = useRoute();

  useEffect(() => {
    if (!meta) return;
    if (meta.mode !== "pattern") {
      writeMeta((current) => {
        current.mode = "pattern";
        current.config.roundSeconds = current.config.roundSeconds || 120;
        if (!current.pausedRemaining) current.pausedRemaining = current.config.roundSeconds;
        current.publicSwapSides = !!current.publicSwapSides;
        current.presidentSwapSides = !!current.presidentSwapSides;
        current.hong = current.hong || getBaseCompetitor(HONG);
        current.chong = current.chong || getBaseCompetitor(CHONG);
        return current;
      });
    }
  }, [meta, writeMeta]);

  if (!meta) {
    return <><GlobalAppStyle /><div style={styles.page}>Cargando...</div></>;
  }

  if (path === "/president") {
    return (
      <><GlobalAppStyle /><PresidentScreen
        meta={meta}
        judges={judges}
        writeMeta={writeMeta}
        prepareNextEvaluation={prepareNextEvaluation}
        closePointsEvaluation={closePointsEvaluation}
        closeBinaryEvaluation={closeBinaryEvaluation}
        resetAll={resetAll}
        navigate={navigate}
      /></>
    );
  }

  if (path === "/public") {
    return <><GlobalAppStyle /><PublicScreen meta={meta} judges={judges} navigate={navigate} /></>;
  }

  if (path.startsWith("/judge/")) {
    const n = Number(path.split("/")[2]);
    if (n >= 1 && n <= MAX_JUDGES) {
      return (
        <><GlobalAppStyle /><JudgeScreen
          meta={meta}
          judges={judges}
          submitPoints={submitPoints}
          submitBinary={submitBinary}
          judgeId={n}
          navigate={navigate}
        /></>
      );
    }
  }

  return <><GlobalAppStyle /><Home navigate={navigate} meta={meta} /></>;
}
