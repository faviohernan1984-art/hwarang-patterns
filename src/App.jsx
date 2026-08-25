
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  onSnapshot,
  runTransaction,
  setDoc,
  getDoc,
  getDocs,
} from "firebase/firestore";
import {
  roomMetaRef,
  roomControlRef,
  roomPublicStateRef,
  roomJudgeRef,
  roomSubmissionsQuery,
  roomSubmissionRef,
} from "./firebase";
import { QRCodeCanvas } from "qrcode.react";
import { binarySummary } from "./binarySummary";
import { patternSummary, patternTotalsForJudge, currentPatternTotalsForJudge, currentPatternHasZero, isPatternSideComplete } from "./patternSummary";
import { makePointsSubmission, makeBinarySubmission, currentSubmission, submissionToJudge } from "./submissionPayloads";
import { currentPublicState, derivePublicState, serializePublicState } from "./publicState";
import { parseAppRoute, roomBasePath } from "./roomRoutes";
import { useWakeLock } from "./useWakeLock";
import HwarangAnimatedIsotype from "./components/HwarangAnimatedIsotype";
import "./HomeScreen.css";
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
  return {
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
}

function makeEmptyPatternResult() {
  return {
    hong: 0,
    chong: 0,
    sent: 0,
    completed: false,
    winner: "en_curso",
  };
}

function makeInitialMeta() {
  return {
    evaluationId: 1,
    mode: "pattern",
    config: {
      roundSeconds: 120,
      patternJudges: 3,
      scoringMode: "binary",
    },
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
  if (raw && !Object.prototype.hasOwnProperty.call(current.config || {}, "scoringMode")) {
    delete config.scoringMode;
  }
  return {
    ...base,
    ...current,
    config,
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

function canClosePatternEvaluation(meta, time, judges) {
  if (meta?.status === "running" || time > 0 || meta?.patternResult?.completed) return false;
  if (getScoringMode(meta) === "binary") return binarySummary(meta, judges).allSent;
  return patternSummary(meta, judges).sent === activeJudgeCount(meta);
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

async function ensureInitialDocs(roomId) {
  const matchMetaRef = roomMetaRef(roomId);
  const controlRef = roomControlRef(roomId);
  const [metaSnap, controlSnap] = await Promise.all([getDoc(matchMetaRef), getDoc(controlRef)]);
  const migrationSource = metaSnap.exists() ? ensureMetaShape(metaSnap.data()) : makeInitialMeta();
  const initialWrites = [];
  if (!controlSnap.exists()) initialWrites.push(setDoc(controlRef, controlFromMeta(migrationSource)));
  if (!metaSnap.exists()) initialWrites.push(setDoc(matchMetaRef, legacyMetaFromMeta(migrationSource)));
  await Promise.all(initialWrites);
}

function useFightData(roomId, role, judgeId) {
  const roleDataKey = `${roomId}:${role}:${judgeId || "none"}`;
  const [control, setControl] = useState(null);
  const [legacyMeta, setLegacyMeta] = useState(null);
  const [publicState, setPublicState] = useState(null);
  const [judges, setJudges] = useState(Array.from({ length: MAX_JUDGES }, (_, i) => makeJudge(i + 1)));
  const [ownSubmission, setOwnSubmission] = useState(null);
  const [loadedControlRoomId, setLoadedControlRoomId] = useState(null);
  const [loadedMetaRoomId, setLoadedMetaRoomId] = useState(null);
  const [loadedRoleDataRoomId, setLoadedRoleDataRoomId] = useState(null);
  const [loadFailure, setLoadFailure] = useState(null);

  useEffect(() => {
    if (!roomId || role === "invalid") return undefined;
    const matchMetaRef = roomMetaRef(roomId);
    const controlRef = roomControlRef(roomId);
    const reportLoadFailure = (source, error) => {
      console.error(`[Firestore] Unable to load ${source} for room "${roomId}".`, error);
      setLoadFailure({ roomId, source, message: error?.message || String(error) });
    };
    const markRoomConnection = () => {
      setLoadFailure((current) => current?.roomId === roomId ? null : current);
    };
    if (role !== "public") ensureInitialDocs(roomId).catch((error) => reportLoadFailure("initial documents", error));

    const unsubControl = onSnapshot(controlRef, (snap) => {
      markRoomConnection();
      if (!snap.exists()) return;
      setControl(controlFromMeta(snap.data()));
      setLoadedControlRoomId(roomId);
    }, (error) => reportLoadFailure("control snapshot", error));

    let unsubMeta = () => {};
    if (role !== "public") {
      unsubMeta = onSnapshot(matchMetaRef, (snap) => {
        markRoomConnection();
        if (!snap.exists()) return;
        setLegacyMeta(legacyMetaFromMeta(snap.data()));
        setLoadedMetaRoomId(roomId);
      }, (error) => reportLoadFailure("meta snapshot", error));
    }

    let unsubRoleData = () => {};
    if (role === "president") {
      unsubRoleData = onSnapshot(roomSubmissionsQuery(roomId), (snap) => {
        markRoomConnection();
        const next = Array.from({ length: MAX_JUDGES }, (_, i) => makeJudge(i + 1));
        snap.docs.forEach((submissionDocument) => {
          const idx = Number(submissionDocument.id) - 1;
          if (idx >= 0 && idx < MAX_JUDGES) next[idx] = submissionToJudge(submissionDocument.data(), idx + 1);
        });
        setJudges(next);
        setLoadedRoleDataRoomId(`${roomId}:${role}:${judgeId || "none"}`);
      }, (error) => reportLoadFailure("submissions snapshot", error));
    } else if (role === "public") {
      unsubRoleData = onSnapshot(roomPublicStateRef(roomId), (snap) => {
        markRoomConnection();
        setPublicState(snap.exists() ? snap.data() : null);
        setLoadedRoleDataRoomId(`${roomId}:${role}:${judgeId || "none"}`);
      }, (error) => reportLoadFailure("public state snapshot", error));
    } else if (role === "judge" && judgeId) {
      unsubRoleData = onSnapshot(roomSubmissionRef(roomId, judgeId), (snap) => {
        markRoomConnection();
        setOwnSubmission(snap.exists() ? snap.data() : null);
        const next = Array.from({ length: MAX_JUDGES }, (_, i) => makeJudge(i + 1));
        if (snap.exists()) next[judgeId - 1] = submissionToJudge(snap.data(), judgeId);
        setJudges(next);
        setLoadedRoleDataRoomId(`${roomId}:${role}:${judgeId}`);
      }, (error) => reportLoadFailure("own submission snapshot", error));
    } else {
      setOwnSubmission(null);
      setJudges(Array.from({ length: MAX_JUDGES }, (_, i) => makeJudge(i + 1)));
      setLoadedRoleDataRoomId(`${roomId}:${role}:${judgeId || "none"}`);
    }

    return () => {
      unsubControl();
      unsubMeta();
      unsubRoleData();
    };
  }, [roomId, role, judgeId]);

  const writeMeta = async (mutator) => {
    const matchMetaRef = roomMetaRef(roomId);
    const controlRef = roomControlRef(roomId);
    const [controlSnap, metaSnap] = await Promise.all([getDoc(controlRef), getDoc(matchMetaRef)]);
    const current = mergeRoomState(
      controlSnap.exists() ? controlSnap.data() : makeInitialMeta(),
      metaSnap.exists() ? metaSnap.data() : legacyMetaFromMeta(makeInitialMeta())
    );
    const draft = clone(current);
    const result = typeof mutator === "function" ? mutator(draft) : mutator;
    const next = ensureMetaShape(result ?? draft);
    const currentControl = controlFromMeta(current);
    const nextControl = controlFromMeta(next);
    const currentLegacyMeta = legacyMetaFromMeta(current);
    const nextLegacyMeta = legacyMetaFromMeta(next);
    const writes = [];
    if (JSON.stringify(nextControl) !== JSON.stringify(currentControl)) writes.push(setDoc(controlRef, nextControl));
    if (JSON.stringify(nextLegacyMeta) !== JSON.stringify(currentLegacyMeta)) writes.push(setDoc(matchMetaRef, nextLegacyMeta));
    await Promise.all(writes);
  };

  const writeSubmission = async (id, submission) => {
    await setDoc(roomSubmissionRef(roomId, id), submission);
    return submission;
  };

  const publishLegacyJudge = async (id, judge) => {
    await setDoc(roomJudgeRef(roomId, id), judge);
  };

  const writePublicState = async (nextPublicState) => {
    await setDoc(roomPublicStateRef(roomId), nextPublicState);
  };

  const resetAll = async () => {
    const matchMetaRef = roomMetaRef(roomId);
    const controlRef = roomControlRef(roomId);
    const controlSnap = await getDoc(controlRef);
    const current = ensureMetaShape(controlSnap.exists() ? controlSnap.data() : makeInitialMeta());
    const evaluationId = current.evaluationId + 1;
    const resetState = { ...makeInitialMeta(), evaluationId };
    await Promise.all([
      setDoc(controlRef, controlFromMeta(resetState)),
      setDoc(matchMetaRef, legacyMetaFromMeta(resetState)),
    ]);
  };

  const acceptedPublicState = control ? currentPublicState(control, publicState) : null;
  const metaReady = role === "public" || loadedMetaRoomId === roomId;
  const meta = loadedControlRoomId === roomId && metaReady && loadedRoleDataRoomId === roleDataKey
    ? role === "public"
      ? ensureMetaShape({
          ...control,
          patternResult: {
            ...acceptedPublicState.aggregate,
            sent: acceptedPublicState.judges.filter((judge) => judge.sent).length,
            ...acceptedPublicState.result,
          },
        })
      : mergeRoomState(control, legacyMeta)
    : null;

  return {
    meta,
    judges,
    ownSubmission,
    publicState: acceptedPublicState,
    writeMeta,
    writeSubmission,
    publishLegacyJudge,
    writePublicState,
    resetAll,
    loadFailure: loadFailure?.roomId === roomId ? loadFailure : null,
  };
}

function controlFromMeta(meta) {
  const current = ensureMetaShape(meta);
  return {
    evaluationId: current.evaluationId,
    status: current.status,
    phase: current.phase,
    phaseStartedAt: current.phaseStartedAt,
    pausedRemaining: current.pausedRemaining,
    config: {
      roundSeconds: current.config.roundSeconds,
      patternJudges: current.config.patternJudges,
      scoringMode: current.config.scoringMode,
    },
    hong: { ...current.hong },
    chong: { ...current.chong },
    publicSwapSides: !!current.publicSwapSides,
  };
}

function legacyMetaFromMeta(meta) {
  const current = ensureMetaShape(meta);
  return {
    presidentSwapSides: !!current.presidentSwapSides,
    patternResult: { ...current.patternResult },
  };
}

function mergeRoomState(control, legacyMeta) {
  return ensureMetaShape({
    ...(control || {}),
    ...legacyMetaFromMeta(legacyMeta || makeInitialMeta()),
  });
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

function WinnerFullScreen({ winner, zIndex = 50, combatClone = false, mode = "public", onClose, overlayBackground = "rgba(0,0,0,0.90)" }) {
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
          background: overlayBackground,
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

function ViewportWinnerOverlay({ winner, mode = "public", onClose }) {
  const stageRef = useRef(null);
  const [scale, setScale] = useState(1);
  const baseWidth = 1920;
  const baseHeight = 1080;
  const overlayBackground = "rgba(0,0,0,0.90)";

  useLayoutEffect(() => {
    const stageHost = stageRef.current;
    if (!stageHost) return undefined;
    const recalc = () => {
      const nextScale = Math.min(
        stageHost.clientWidth / baseWidth,
        stageHost.clientHeight / baseHeight
      );
      setScale(Number.isFinite(nextScale) && nextScale > 0 ? nextScale : 1);
    };
    recalc();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(recalc) : null;
    observer?.observe(stageHost);
    window.addEventListener("resize", recalc);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", recalc);
    };
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100000,
        width: "100vw",
        height: "100dvh",
        overflow: "hidden",
        background: overlayBackground,
      }}
      ref={stageRef}
    >
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: baseWidth,
          height: baseHeight,
          overflow: "hidden",
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "center center",
        }}
      >
        <WinnerFullScreen
          winner={winner}
          zIndex={0}
          combatClone
          mode={mode}
          onClose={onClose}
          overlayBackground="transparent"
        />
      </div>
    </div>,
    document.body
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

function JudgePatternBinaryPanel({ vote, sent, onSelect, onSend }) {
  const renderSide = (side, label) => {
    const selected = vote === side;
    return (
      <button
        type="button"
        disabled={sent}
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
      <div className={`patterns-judge-binary__status${sent ? " is-sent" : ""}`}>{sent ? "SENT" : "SELECT WINNER"}</div>
      <div className="patterns-judge-binary__joystick">
        {renderSide("hong", "HONG")}
        {renderSide("chong", "CHONG")}
      </div>
      <div className="patterns-judge-binary__send-wrap">
        <AppButton className="patterns-judge-binary__send" style={vote && !sent ? styles.green : styles.gray} disabled={!vote || sent} onClick={onSend}>SEND</AppButton>
      </div>
    </div>
  );
}

function JudgePatternColorPanel({ judge, onSelectValue, onSave, onToggleZeroSide }) {
  const locked = !!judge.pattern.sent;
  const hongZero = !!judge.pattern.hong.zero;
  const chongZero = !!judge.pattern.chong.zero;
  const patternComplete = isPatternSideComplete(judge.pattern.hong)
    && isPatternSideComplete(judge.pattern.chong);

  const totals = patternTotalsForJudge(judge);

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
      <div className={`patterns-judge-points__status${locked ? " is-sent" : ""}`}>{locked ? "SCORE SENT" : "SELECT SCORES"}</div>

      <div className={`patterns-judge-points__joystick${locked ? " is-sent" : ""}`}>
        <SidePanel side="hong" title={HONG} />
        <SidePanel side="chong" title={CHONG} />
      </div>

      <div className="patterns-judge-points__send-wrap">
        <AppButton
          className={`patterns-judge-points__send${locked ? " is-confirmed" : patternComplete ? " is-ready" : ""}`}
          style={styles.green}
          disabled={locked || !patternComplete}
          onClick={onSave}
        >
          {locked ? "✓ SCORE REGISTERED" : "SEND"}
        </AppButton>
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

function Home({ navigate, meta, roomId }) {
  const judgesToShow = activeJudgeCount(meta);
  const [copiedPath, setCopiedPath] = useState(null);
  const base = getBaseURL();
  const roomPath = roomBasePath(roomId);
  const accessItems = [
    { key: "president", label: "PRESIDENT", path: `${roomPath}/president`, tone: "president" },
    { key: "public", label: "PUBLIC", path: `${roomPath}/public`, tone: "public" },
    ...Array.from({ length: judgesToShow }, (_, index) => ({
      key: `judge-${index + 1}`,
      label: `JUDGE ${index + 1}`,
      path: `${roomPath}/judge/${index + 1}`,
      tone: "judge",
    })),
  ].map((access) => ({ ...access, accessUrl: `${base}${access.path}` }));

  const copyAccessUrl = async (access) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(access.accessUrl);
      } else {
        const field = document.createElement("textarea");
        field.value = access.accessUrl;
        field.setAttribute("readonly", "");
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.appendChild(field);
        field.select();
        document.execCommand("copy");
        field.remove();
      }
      setCopiedPath(access.path);
      window.setTimeout(() => setCopiedPath((current) => current === access.path ? null : current), 1400);
    } catch {
      setCopiedPath(null);
    }
  };

  return (
    <main className="patterns-home">
      <div className="patterns-home__grid" aria-hidden="true" />
      <header className="patterns-home__header">
        <HwarangAnimatedIsotype size={58} showLabel />
        <h1>PATTERNS GUP PRO</h1>
        <div className="patterns-home__eyebrow">MATCH ACCESS CENTER</div>
        <span>WAITING ROOM · SCREEN ACCESS</span>
      </header>
      <nav className="patterns-home__quick-access" aria-label="Acceso directo a pantallas">
        {accessItems.map((access) => (
          <button key={access.key} type="button" className={`patterns-home__quick-button patterns-home__quick-button--${access.tone}`} onClick={() => navigate(access.path)}>{access.label}</button>
        ))}
      </nav>
      <section className="patterns-home__access-section" aria-labelledby="patterns-home-access-title">
        <div className="patterns-home__section-heading">
          <div><span>LIVE LINKS</span><h2 id="patterns-home-access-title">ACCESS SCREENS</h2></div>
          <small>{accessItems.length} ACTIVE ENDPOINTS</small>
        </div>
        <div className={`patterns-home__cards patterns-home__cards--count-${accessItems.length}`}>
          {accessItems.map((access) => (
            <article key={access.key} className={`patterns-home__card patterns-home__card--${access.tone}`}>
              <div className="patterns-home__card-role"><span>{access.label}</span><i aria-hidden="true" /></div>
              <button type="button" className="patterns-home__qr" aria-label={`Abrir ${access.label}`} onClick={() => navigate(access.path)}>
                <QRCodeCanvas value={access.accessUrl} size={192} level="M" />
              </button>
              <code className="patterns-home__route">{access.path}</code>
              <button type="button" className="patterns-home__copy" onClick={() => copyAccessUrl(access)}>{copiedPath === access.path ? "COPIED" : "COPY URL"}</button>
            </article>
          ))}
        </div>
      </section>
      <footer className="patterns-home__footer">
        <span>PATTERNS GUP</span>
        <strong><i aria-hidden="true" /> SYSTEM READY</strong>
        <span>HWARANG SCORING UNIVERSE</span>
      </footer>
    </main>
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

function PublicScreen({ meta, publicState, navigate, roomId }) {
  const time = useClock(meta);
  const p = meta.patternResult || makeEmptyPatternResult();
  const scoringMode = getScoringMode(meta);
  const binaryMode = scoringMode === "binary";
  const { left, right } = getDisplaySides(meta, "public");
  const publicJudges = publicState.judges;
  const binary = publicState.aggregate;
  const allSent = publicJudges.length === activeJudgeCount(meta) && publicJudges.every((judge) => judge.sent);
  const revealBinaryVoting = binaryMode && time === 0 && allSent;
  const revealPointsVoting = !binaryMode
    && time === 0
    && publicJudges.length > 0
    && allSent;
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
        onClick={() => navigate(roomBasePath(roomId))}
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
              <div className="patterns-public__product">PATTERNS GUP PRO</div>
            </div>
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
                  const sent = judge.sent;
                  let revealedDecision = null;
                  if (binaryMode && revealBinaryVoting && sent) {
                    revealedDecision = judge.decision;
                  } else if (!binaryMode && revealPointsVoting && sent) {
                    revealedDecision = judge.decision;
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
        <ViewportWinnerOverlay winner={meta.patternResult?.winner} />
      )}
    </>
  );
}

function PresidentScreen({ meta, judges, writeMeta, publishLegacyJudge, writePublicState, resetAll, navigate, roomId }) {
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
    if (scoringMode === "points") return !!judge.pattern?.sent && judge.pattern?.evaluationId === meta.evaluationId;
    const binaryVote = judge.pattern?.binary;
    return binaryVote?.sent === true && binaryVote.evaluationId === meta.evaluationId && (binaryVote.vote === "hong" || binaryVote.vote === "chong");
  });
  const [hidePresidentWinner, setHidePresidentWinner] = useState(false);
  const [forcedWinnerIntent, setForcedWinnerIntent] = useState(null);
  const [settledForceToken, setSettledForceToken] = useState(null);
  const [localConfigurationLock, setLocalConfigurationLock] = useState(false);
  const forceWriteQueueRef = useRef(Promise.resolve());
  const latestForceRef = useRef(null);
  const forceSequenceRef = useRef(0);
  const editorSaveTimeoutRef = useRef(null);
  const publishedSubmissionRef = useRef(new Map());
  const publishedPublicStateRef = useRef(null);
  const publicStateWriteQueueRef = useRef(Promise.resolve());
  const { left, right } = getDisplaySides(meta, "president");
  const persistedConfigurationLock = meta.status === "running"
    || meta.phase === "finished"
    || !!meta.patternResult?.completed
    || Number(meta.pausedRemaining) < Number(meta.config?.roundSeconds);
  const configurationLocked = localConfigurationLock || persistedConfigurationLock;

  useEffect(() => {
    setHidePresidentWinner(false);
    setForcedWinnerIntent(null);
    setSettledForceToken(null);
    latestForceRef.current = null;
    forceSequenceRef.current = 0;
  }, [meta.evaluationId]);

  useEffect(() => {
    activeJudges(meta, judges).forEach((judge) => {
      const isCurrentPoints = scoringMode === "points"
        && judge.pattern?.sent === true
        && judge.pattern.evaluationId === meta.evaluationId;
      const binary = judge.pattern?.binary;
      const isCurrentBinary = scoringMode === "binary"
        && binary?.sent === true
        && binary.evaluationId === meta.evaluationId;
      if (!isCurrentPoints && !isCurrentBinary) return;

      const token = JSON.stringify(judge);
      if (publishedSubmissionRef.current.get(judge.id) === token) return;
      publishedSubmissionRef.current.set(judge.id, token);
      publishLegacyJudge(judge.id, judge).catch((error) => {
        publishedSubmissionRef.current.delete(judge.id);
        console.error("Unable to publish legacy Judge projection.", error);
      });
    });
  }, [judges, meta, meta.evaluationId, scoringMode, publishLegacyJudge]);

  useEffect(() => {
    const nextPublicState = derivePublicState(meta, judges);
    const token = serializePublicState(nextPublicState);
    if (publishedPublicStateRef.current === token) return;
    publishedPublicStateRef.current = token;
    publicStateWriteQueueRef.current = publicStateWriteQueueRef.current
      .catch(() => undefined)
      .then(() => writePublicState(nextPublicState))
      .catch((error) => {
        if (publishedPublicStateRef.current === token) publishedPublicStateRef.current = null;
        console.error("Unable to publish Public State.", error);
      });
  }, [
    judges,
    meta.evaluationId,
    scoringMode,
    meta.config.patternJudges,
    meta.patternResult?.hong,
    meta.patternResult?.chong,
    meta.patternResult?.completed,
    meta.patternResult?.winner,
    writePublicState,
  ]);

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
    const finalEditor = nextEditor || editorDraftRef.current;
    const unchanged =
      (meta.hong?.name || "") === finalEditor.hongName &&
      (meta.hong?.club || "") === finalEditor.hongClub &&
      (meta.chong?.name || "") === finalEditor.chongName &&
      (meta.chong?.club || "") === finalEditor.chongClub;

    if (unchanged) return;

    await writeMeta((current) => ({
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
    if (!forcedWinnerIntent || !settledForceToken) return;
    if (meta.patternResult?.forcedDecisionToken !== settledForceToken) return;
    setForcedWinnerIntent(null);
    setSettledForceToken(null);
    latestForceRef.current = null;
  }, [forcedWinnerIntent, settledForceToken, meta.patternResult?.forcedDecisionToken]);

  useEffect(() => {
    if (meta.status !== "running") return;
    if (meta.phase === "finished") return;
    if (time > 0) return;

    const finishByTime = async () => {
      await writeMeta((current) => {
        if (current.status !== "running") return current;
        current.status = "paused";
        current.phase = "finished";
        current.phaseStartedAt = null;
        current.pausedRemaining = 0;
        return current;
      });
    };

    finishByTime();
  }, [meta.status, meta.phase, time, writeMeta]);

  useEffect(() => {
    setSecondsInput(String(meta.config.roundSeconds || 120));
  }, [meta.config.roundSeconds]);

  const saveConfig = async ({ preserveRemaining = false, allowDuringStart = false } = {}) => {
    if (configurationLocked && !allowDuringStart) return;
    const roundSeconds = Math.max(1, parseInt(secondsInput, 10) || 120);

    await writeMeta((current) => ({
      ...current,
      config: {
        ...(current.config || {}),
        roundSeconds,
      },
      pausedRemaining: current.status === "paused" && current.phase === "fight" && !preserveRemaining
        ? roundSeconds
        : current.pausedRemaining,
    }));
  };

  const setPatternJudgeCount = async (count) => {
    if (configurationLocked) return;
    await writeMeta((current) => ({
      ...current,
      config: {
        ...(current.config || {}),
        patternJudges: count,
      },
    }));
  };

  const setScoringMode = async (mode) => {
    if (scoringModeLocked) return;
    const nextMode = mode === "binary" ? "binary" : "points";
    await writeMeta((current) => ({
      ...current,
      config: {
        ...(current.config || {}),
        scoringMode: nextMode,
      },
    }));
  };

  const startTimer = async () => {
    const isResume = meta.status === "paused"
      && meta.phase === "fight"
      && Number(meta.pausedRemaining) < Number(meta.config?.roundSeconds);
    setLocalConfigurationLock(true);
    await commitEditor(editorDraftRef.current);
    await saveConfig({ preserveRemaining: isResume, allowDuringStart: true });

    await writeMeta((current) => {
      if (current.status === "running") return current;
      if (current.phase === "finished" || Number(current.pausedRemaining) <= 0) return current;

      return {
        ...current,
        status: "running",
        phaseStartedAt: Date.now(),
      };
    });
  };

  const pauseTimer = async () => {
    await writeMeta((current) => {
      if (current.status !== "running") return current;
      current.pausedRemaining = getDerivedTime(current, Date.now());
      current.status = "paused";
      current.phaseStartedAt = null;
      return current;
    });
  };

  const closePatternEvaluation = async () => {
    if (!canClosePatternEvaluation(meta, time, judges)) return;

    if (getScoringMode(meta) === "binary") {
      const matchMetaRef = roomMetaRef(roomId);
      const controlRef = roomControlRef(roomId);
      const submissionsQuery = roomSubmissionsQuery(roomId);
      const [controlSnapshot, metaSnapshot] = await Promise.all([getDoc(controlRef), getDoc(matchMetaRef)]);
      const persistedMeta = mergeRoomState(
        controlSnapshot.exists() ? controlSnapshot.data() : meta,
        metaSnapshot.exists() ? metaSnapshot.data() : legacyMetaFromMeta(meta)
      );
      const persistedJudges = Array.from({ length: MAX_JUDGES }, (_, index) => makeJudge(index + 1));
      const submissionsSnapshot = await getDocs(submissionsQuery);
      submissionsSnapshot.forEach((submissionDocument) => {
        const index = Number(submissionDocument.id) - 1;
        if (index >= 0 && index < MAX_JUDGES) {
          persistedJudges[index] = submissionToJudge(submissionDocument.data(), index + 1);
        }
      });
      const live = binarySummary(persistedMeta, persistedJudges);
      const persistedTime = getDerivedTime(persistedMeta, Date.now());
      if (!canClosePatternEvaluation(persistedMeta, persistedTime, persistedJudges) || (live.winner !== "hong" && live.winner !== "chong")) {
        console.error("Cannot close Binary evaluation: incomplete or inconsistent votes.", live);
        return;
      }

      await writeMeta((current) => {
        if (getScoringMode(current) !== "binary" || current.status === "running" || getDerivedTime(current, Date.now()) > 0 || current.patternResult?.completed) return current;
        current.patternResult = {
          ...(current.patternResult || makeEmptyPatternResult()),
          scoringMode: "binary",
          binary: {
            hongVotes: live.hong,
            chongVotes: live.chong,
            sent: live.sent,
            majorityRequired: live.majorityRequired,
          },
          completed: true,
          winner: live.winner,
        };
        current.status = "paused";
        current.phase = "finished";
        current.phaseStartedAt = null;
        current.pausedRemaining = 0;
        return current;
      });
      return;
    }

    const live = patternSummary(meta, judges);

    await writeMeta((current) => {
      if (getScoringMode(current) !== "points" || current.status === "running" || getDerivedTime(current, Date.now()) > 0 || current.patternResult?.completed) return current;
      if (live.sent !== activeJudgeCount(current)) return current;
      current.patternResult = {
        hong: live.hong,
        chong: live.chong,
        sent: live.sent,
        completed: true,
        winner: live.winner,
      };

      current.status = "paused";
      current.phase = "finished";
      current.phaseStartedAt = null;
      current.pausedRemaining = 0;
      return current;
    });
  };

  const prepareNextMatch = async () => {
    setLocalConfigurationLock(false);
    await writeMeta((current) => {
      const roundSeconds = current.config.roundSeconds || 120;
      current.mode = "pattern";
      current.status = "paused";
      current.phase = "fight";
      current.round = 1;
      current.phaseStartedAt = null;
      current.pausedRemaining = roundSeconds;
      current.patternResult = makeEmptyPatternResult();
      current.evaluationId += 1;
      return current;
    });
  };

  const applyPatternForcedWinner = (winner) => {
    if (!["hong", "chong", "draw"].includes(winner)) return;
    if (latestForceRef.current?.winner === winner) return;

    const sequence = forceSequenceRef.current + 1;
    forceSequenceRef.current = sequence;
    const token = `${Date.now()}-${sequence}`;
    latestForceRef.current = { winner, token };
    setLocalConfigurationLock(true);
    setForcedWinnerIntent(winner);
    setSettledForceToken(null);
    setHidePresidentWinner(false);

    forceWriteQueueRef.current = forceWriteQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        await writeMeta((current) => {
          current.patternResult = {
            ...current.patternResult,
            scoringMode: getScoringMode(current),
            completed: true,
            winner,
            forcedDecisionToken: token,
          };
          current.phase = "finished";
          current.status = "paused";
          current.pausedRemaining = 0;
          current.phaseStartedAt = null;
          return current;
        });
        if (latestForceRef.current?.token === token) setSettledForceToken(token);
      })
      .catch((error) => {
        console.error("Unable to apply forced decision.", error);
        if (latestForceRef.current?.token !== token) return;
        latestForceRef.current = null;
        setForcedWinnerIntent(null);
        setSettledForceToken(null);
      });
  };

  const resetEvaluation = async () => {
    setLocalConfigurationLock(false);
    await resetAll();
  };

  const updateCompetitor = async (side, field, value) => {
    await writeMeta((current) => {
      current[side] = current[side] || getBaseCompetitor(side === "hong" ? HONG : CHONG);
      current[side][field] = value;
      return current;
    });
  };

  const showPresidentWinner = !!forcedWinnerIntent || !!meta.patternResult?.completed;
  const presidentWinner = forcedWinnerIntent || meta.patternResult?.winner;
  const canCloseEvaluation = canClosePatternEvaluation(meta, time, judges);
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
            <AppButton className="patterns-president__action patterns-president__action--home" style={styles.gray} onClick={() => navigate(roomBasePath(roomId))}><span aria-hidden="true">⌂</span> HOME</AppButton>
            <AppButton className="patterns-president__action patterns-president__action--next" style={styles.green} onClick={prepareNextMatch}><span aria-hidden="true">→</span> NEXT</AppButton>
            <AppButton className="patterns-president__action patterns-president__action--reset" style={styles.red} onClick={resetEvaluation}><span aria-hidden="true">↻</span> RESET</AppButton>
            <AppButton
              className={`patterns-president__action patterns-president__action--swap${meta.publicSwapSides ? " patterns-president__action--active" : ""}`}
              style={styles.purple}
              onClick={() => writeMeta((c) => { c.publicSwapSides = !c.publicSwapSides; return c; })}
            >
              <span aria-hidden="true">⇄</span> SWAP PUBLIC
            </AppButton>
            <AppButton
              className={`patterns-president__action patterns-president__action--swap${meta.presidentSwapSides ? " patterns-president__action--active" : ""}`}
              style={styles.purple}
              onClick={() => writeMeta((c) => { c.presidentSwapSides = !c.presidentSwapSides; return c; })}
            >
              <span aria-hidden="true">⇄</span> SWAP PRESIDENT
            </AppButton>
          </nav>

          <div className="patterns-president__brand" aria-label="Hwarang Scoring Universe Patterns GUP Pro">
            <span>HWARANG SCORING UNIVERSE™</span>
            <strong>PATTERNS GUP PRO</strong>
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
              <input type="number" min="1" disabled={configurationLocked} value={secondsInput} onChange={(e) => setSecondsInput(e.target.value)} aria-label="Evaluation time in seconds" />
              <div className="patterns-president__presets">
                {[60, 90, 120, 180, 300].map((seconds) => (
                  <AppButton
                    key={seconds}
                    className={`patterns-president__preset${String(secondsInput) === String(seconds) ? " is-active" : ""}`}
                    style={styles.gray}
                    disabled={configurationLocked}
                    onClick={() => setSecondsInput(String(seconds))}
                  >
                    {seconds}
                  </AppButton>
                ))}
              </div>
            </div>
            <div className="patterns-president__settings-actions">
              <AppButton style={meta.config.patternJudges === 3 ? styles.green : styles.gray} disabled={configurationLocked} onClick={() => setPatternJudgeCount(3)}>3 JUDGES</AppButton>
              <AppButton style={meta.config.patternJudges === 5 ? styles.green : styles.gray} disabled={configurationLocked} onClick={() => setPatternJudgeCount(5)}>5 JUDGES</AppButton>
              <AppButton style={styles.blue} disabled={configurationLocked} onClick={saveConfig}>SAVE CONFIG</AppButton>
              <div className="patterns-president__scoring-mode">
                <span>SCORING MODE</span>
                <AppButton className={`patterns-president__scoring-option patterns-president__scoring-option--points${scoringMode === "points" ? " is-active" : ""}`} disabled={scoringModeLocked} onClick={() => setScoringMode("points")}>POINTS</AppButton>
                <AppButton className={`patterns-president__scoring-option patterns-president__scoring-option--binary${scoringMode === "binary" ? " is-active" : ""}`} disabled={scoringModeLocked} onClick={() => setScoringMode("binary")}>BINARY</AppButton>
              </div>
            </div>
          </div>

          <div className="patterns-president__panel patterns-president__match-control">
            <h2>MATCH CONTROL</h2>
            <div>
              <AppButton style={styles.green} onClick={startTimer}><span aria-hidden="true">▶</span> START</AppButton>
              <AppButton style={styles.amber} onClick={pauseTimer}><span aria-hidden="true">Ⅱ</span> PAUSE</AppButton>
              <AppButton style={styles.blue} disabled={!canCloseEvaluation} onClick={closePatternEvaluation}><span aria-hidden="true">⚑</span> CLOSE EVALUATION</AppButton>
            </div>
          </div>
        </section>

        <section className="patterns-president__judge-band" style={{ "--patterns-president-judges": currentJudges.length }}>
          {currentJudges.map((judge) => {
            const totals = currentPatternTotalsForJudge(meta, judge);
            const binaryVote = judge.pattern?.binary;
            const sent = scoringMode === "binary"
              ? binaryVote?.sent === true && binaryVote.evaluationId === meta.evaluationId && (binaryVote.vote === "hong" || binaryVote.vote === "chong")
              : !!judge.pattern?.sent && judge.pattern?.evaluationId === meta.evaluationId;
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
                        {scoringMode === "points" && <small>{currentPatternHasZero(meta, judge, side) ? `${fighter.visualLabel} ABSOLUTE ZERO` : ""}</small>}
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
            <AppButton style={styles.red} onClick={() => applyPatternForcedWinner("hong")}>HONG WINNER</AppButton>
            <AppButton style={styles.blue} onClick={() => applyPatternForcedWinner("chong")}>CHONG WINNER</AppButton>
            <AppButton style={styles.gray} onClick={() => applyPatternForcedWinner("draw")}>DRAW</AppButton>
            <button type="button" className="patterns-president__qr-home" onClick={() => navigate(roomBasePath(roomId))}>QR ACCESS</button>
          </div>
        </section>

        {showPresidentWinner && !hidePresidentWinner && (
          <ViewportWinnerOverlay
            winner={presidentWinner}
            mode="president"
            onClose={() => setHidePresidentWinner(true)}
          />
        )}
      </div>
    </Frame16x9>
  );
}

function JudgeScreen({ meta, judges, ownSubmission, writeSubmission, judgeId, navigate, roomId }) {
  useWakeLock();
  const time = useClock(meta);
  const scoringMode = getScoringMode(meta);
  const prevFinishedRef = useRef(false);
  const latestEvaluationIdRef = useRef(meta.evaluationId);
  latestEvaluationIdRef.current = meta.evaluationId;

  useEffect(() => {
    const isFinished = !!meta.patternResult?.completed;
    if (isFinished && !prevFinishedRef.current) {
      playWinnerSound();
    }
    prevFinishedRef.current = isFinished;
  }, [meta.patternResult?.completed]);

  if (judgeId > activeJudgeCount(meta)) {
    return (
      <div style={styles.page}>
        <AppButton style={{ ...styles.gray, boxShadow: "0 0 18px rgba(255,255,255,0.16)" }} onClick={() => navigate(roomBasePath(roomId))}>Inicio</AppButton>
        <BrandHeaderSmall />
        <h1>Juez {judgeId}</h1>
        <div style={styles.panel}>Este juez no está activo en la configuración actual.</div>
      </div>
    );
  }

  const judge = judges.find((j) => j.id === judgeId) || makeJudge(judgeId);
  const initialSubmission = currentSubmission(ownSubmission, {
    evaluationId: meta.evaluationId,
    scoringMode,
    judgeId,
  });
  const initialJudge = initialSubmission
    ? submissionToJudge(initialSubmission, judgeId)
    : makeJudge(judgeId, meta.evaluationId);
  const [localPattern, setLocalPattern] = useState(() => clone(initialJudge.pattern));
  const [localBinaryVote, setLocalBinaryVote] = useState(() => initialJudge.pattern.binary.vote);
  const [localBinarySent, setLocalBinarySent] = useState(() => !!initialJudge.pattern.binary.sent);
  const submittedEvaluationRef = useRef(null);

  useEffect(() => {
    const validSubmission = currentSubmission(ownSubmission, {
      evaluationId: meta.evaluationId,
      scoringMode,
      judgeId,
    });
    const hydratedJudge = validSubmission
      ? submissionToJudge(validSubmission, judgeId)
      : makeJudge(judgeId, meta.evaluationId);

    setLocalPattern(clone(
      scoringMode === "points" && validSubmission
        ? hydratedJudge.pattern
        : makeJudge(judgeId, meta.evaluationId).pattern
    ));
    setLocalBinaryVote(scoringMode === "binary" && validSubmission ? hydratedJudge.pattern.binary.vote : null);
    setLocalBinarySent(scoringMode === "binary" && validSubmission ? !!hydratedJudge.pattern.binary.sent : false);
  }, [judgeId, meta.evaluationId, scoringMode, ownSubmission]);

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
    const patternComplete = isPatternSideComplete(localPattern.hong)
      && isPatternSideComplete(localPattern.chong);
    if (!patternComplete) return;
    if (localPattern.sent) return;
    const evaluationId = meta.evaluationId;
    const submissionKey = `${evaluationId}:points`;
    if (submittedEvaluationRef.current === submissionKey) return;
    submittedEvaluationRef.current = submissionKey;
    try {
      await writeSubmission(judgeId, makePointsSubmission({
        evaluationId,
        judgeId,
        scores: {
          hong: { ...localPattern.hong },
          chong: { ...localPattern.chong },
        },
      }));
    } catch (error) {
      if (submittedEvaluationRef.current === submissionKey) submittedEvaluationRef.current = null;
      throw error;
    }

    if (latestEvaluationIdRef.current === evaluationId) {
      setLocalPattern((current) => ({ ...current, evaluationId, sent: true }));
    }
  };

  const saveBinaryVote = async () => {
    if (!localBinaryVote || localBinarySent) return;
    const evaluationId = meta.evaluationId;
    const vote = localBinaryVote;
    const submissionKey = `${evaluationId}:binary`;
    if (submittedEvaluationRef.current === submissionKey) return;
    submittedEvaluationRef.current = submissionKey;
    try {
      await writeSubmission(judgeId, makeBinarySubmission({
        evaluationId,
        judgeId,
        vote,
      }));
    } catch (error) {
      if (submittedEvaluationRef.current === submissionKey) submittedEvaluationRef.current = null;
      throw error;
    }
    if (latestEvaluationIdRef.current === evaluationId) {
      setLocalBinaryVote(vote);
      setLocalBinarySent(true);
    }
  };

  const judgeWinner = meta.patternResult?.winner;
  const showJudgeWinner = !!meta.patternResult?.completed;
  const judgePreview = { ...judge, pattern: localPattern };
  const judgeStatus = meta.phase === "finished"
    ? "FINISHED"
    : meta.status === "running"
      ? "EVALUATING"
      : meta.status === "paused"
          && meta.phase === "fight"
          && Number(meta.pausedRemaining) < Number(meta.config?.roundSeconds)
        ? "PAUSED"
        : "READY";

  return (
    <div className={scoringMode === "binary" ? "patterns-judge-page patterns-judge-page--binary" : "patterns-judge-page patterns-judge-page--points"} style={{ ...styles.page, background: "#06101c", minHeight: "100vh" }}>
      <AppButton className={scoringMode === "binary" ? "patterns-judge-page__home" : "patterns-judge-points__exit"} style={{ ...styles.gray, boxShadow: "0 0 18px rgba(255,255,255,0.16)" }} onClick={() => navigate(roomBasePath(roomId))}>EXIT</AppButton>

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
            onSelect={setLocalBinaryVote}
            onSend={saveBinaryVote}
          />
        ) : (
          <JudgePatternColorPanel judge={judgePreview} onSelectValue={selectPatternValue} onSave={savePattern} onToggleZeroSide={togglePatternZeroSide} />
        )}
      </div>

      {showJudgeWinner && <WinnerFullScreen winner={judgeWinner} />}
    </div>
  );
}

export default function App() {
  const { path, navigate } = useRoute();
  const { roomId, role, judgeId } = parseAppRoute(path);
  const { meta, judges, ownSubmission, publicState, writeMeta, writeSubmission, publishLegacyJudge, writePublicState, resetAll, loadFailure } = useFightData(roomId, role, judgeId);

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

  if (role === "invalid") {
    return <><GlobalAppStyle /><div style={styles.page}>Ruta de Room inválida.</div></>;
  }

  if (loadFailure) {
    return <><GlobalAppStyle /><div style={styles.page}>No se pudo cargar Room {roomId}: {loadFailure.message}</div></>;
  }

  if (!meta) {
    return <><GlobalAppStyle /><div style={styles.page}>Cargando...</div></>;
  }

  if (role === "president") {
    return (
      <><GlobalAppStyle /><PresidentScreen
        meta={meta}
        judges={judges}
        writeMeta={writeMeta}
        publishLegacyJudge={publishLegacyJudge}
        writePublicState={writePublicState}
        resetAll={resetAll}
        navigate={navigate}
        roomId={roomId}
      /></>
    );
  }

  if (role === "public") {
    return <><GlobalAppStyle /><PublicScreen meta={meta} publicState={publicState} navigate={navigate} roomId={roomId} /></>;
  }

  if (role === "judge") {
    return (
      <><GlobalAppStyle /><JudgeScreen
        meta={meta}
        judges={judges}
        ownSubmission={ownSubmission}
        writeSubmission={writeSubmission}
        judgeId={judgeId}
        navigate={navigate}
        roomId={roomId}
      /></>
    );
  }

  return <><GlobalAppStyle /><Home navigate={navigate} meta={meta} roomId={roomId} /></>;
}
