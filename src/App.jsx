
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
    `}</style>
  );
}

function makeJudge(id) {
  return {
    id,
    hongPoints: 0,
    chongPoints: 0,
    history: [],
    pattern: {
      hong: { tech: 0, power: 0, rhythm: 0, zero: false },
      chong: { tech: 0, power: 0, rhythm: 0, zero: false },
      sent: false,
    },
  };
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
    mode: "pattern",
    config: {
      roundSeconds: 120,
      patternJudges: 3,
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
  return {
    ...base,
    ...current,
    config: {
      ...base.config,
      ...(current.config || {}),
    },
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

  const hong = hongZero ? 0 : (judge.pattern?.hong?.tech || 0) + (judge.pattern?.hong?.power || 0) + (judge.pattern?.hong?.rhythm || 0);
  const chong = chongZero ? 0 : (judge.pattern?.chong?.tech || 0) + (judge.pattern?.chong?.power || 0) + (judge.pattern?.chong?.rhythm || 0);

  return { hong, chong };
}

function patternSummary(meta, judges) {
  const currentJudges = activeJudges(meta, judges);

  let hong = 0;
  let chong = 0;
  let sent = 0;

  currentJudges.forEach((j) => {
    if (j.pattern?.sent) {
      sent += 1;
      const totals = patternTotalsForJudge(j);
      hong += totals.hong;
      chong += totals.chong;
    }
  });

  let winner = "en_curso";
  if (meta.patternResult?.completed && meta.patternResult?.winner) {
    winner = meta.patternResult.winner;
  } else if (sent === currentJudges.length) {
    if (hong > chong) winner = "hong";
    else if (chong > hong) winner = "chong";
    else winner = "draw";
  }

  return { hong, chong, sent, winner };
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

  if (!swap) {
    return { left: chong, right: hong };
  }

  return { left: hong, right: chong };
}

async function ensureInitialDocs() {
  const metaSnap = await getDoc(matchMetaRef);

  if (!metaSnap.exists()) {
    await setDoc(matchMetaRef, makeInitialMeta());
  }

  const existing = await getDocs(query(judgesColRef));
  const ids = new Set(existing.docs.map((d) => d.id));

  for (let i = 1; i <= MAX_JUDGES; i += 1) {
    if (!ids.has(String(i))) {
      await setDoc(judgeRef(i), makeJudge(i));
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
    const snap = await getDoc(matchMetaRef);
    const current = ensureMetaShape(snap.exists() ? snap.data() : makeInitialMeta());
    const draft = clone(current);
    const result = typeof mutator === "function" ? mutator(draft) : mutator;
    const next = ensureMetaShape(result ?? draft);
    next.updatedAt = Date.now();
    await setDoc(matchMetaRef, next);
  };

  const writeJudge = async (id, mutator) => {
    const ref = judgeRef(id);
    const snap = await getDoc(ref);
    const current = snap.exists() ? normalizeJudge(snap.data(), id) : makeJudge(id);
    const draft = clone(current);
    const result = typeof mutator === "function" ? mutator(draft) : mutator;
    const next = result ?? draft;
    await setDoc(ref, next);
    return next;
  };

  const resetAll = async () => {
    await setDoc(matchMetaRef, makeInitialMeta());
    for (let i = 1; i <= MAX_JUDGES; i += 1) {
      await setDoc(judgeRef(i), makeJudge(i));
    }
  };

  return { meta, judges, writeMeta, writeJudge, resetAll };
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
    padding: 28,
    boxSizing: "border-box",
    fontFamily: "Arial, sans-serif",
  },
  frameBg: {
    background: "#020814",
    color: "white",
    minHeight: "100vh",
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
    const recalc = () => setScale(Math.min(window.innerWidth / baseWidth, window.innerHeight / baseHeight));
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
      <img src="/logo-universe.png" alt="Hwarang Universe" style={{ height: 220, maxWidth: 420, objectFit: "contain" }} />
      <img src="/logo-patterns.png" alt="Hwarang Patterns" style={{ height: 220, maxWidth: 420, objectFit: "contain" }} />
    </div>
  );
}

function BrandHeaderSmall() {
  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 14, margin: "8px 0 12px" }}>
      <img src="/logo-universe.png" alt="Hwarang Universe" style={{ height: 92, maxWidth: 240, objectFit: "contain" }} />
      <img src="/logo-patterns.png" alt="Hwarang Patterns" style={{ height: 92, maxWidth: 240, objectFit: "contain" }} />
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

function WinnerFullScreen({ winner, zIndex = 50 }) {
  if (winner === "draw") {
    return (
      <div style={{ position: "absolute", inset: 0, zIndex, background: "#3b3b3b", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "5vw" }}>
        <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontSize: 62, fontWeight: 800, letterSpacing: "0.16em", lineHeight: 1 }}>RESULTADO</div>
          <div style={{ marginTop: 28, fontSize: 210, fontWeight: 900, lineHeight: 0.92 }}>EMPATE</div>
        </div>
      </div>
    );
  }

  if (winner !== "hong" && winner !== "chong") return null;
  const isHong = winner === "hong";

  return (
    <div style={{ position: "absolute", inset: 0, zIndex, background: isHong ? "#b91c1c" : "#1d4ed8", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "5vw", animation: "winnerPulse 1.2s infinite" }}>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: 62, fontWeight: 800, letterSpacing: "0.16em", opacity: 0.92, lineHeight: 1 }}>WINNER</div>
        <div style={{ marginTop: 28, fontSize: 220, fontWeight: 900, lineHeight: 0.92 }}>{isHong ? "HONG" : "CHONG"}</div>
      </div>
      <style>{`@keyframes winnerPulse {0%{opacity:1;}50%{opacity:0.76;}100%{opacity:1;}}`}</style>
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
      style={{
        padding: "12px 15px",
        borderRadius: 12,
        border: "none",
        cursor: disabled ? "default" : "pointer",
        fontWeight: 900,
        color: "white",
        background: selected === value ? "#15803d" : "#444",
        marginRight: 8,
        marginBottom: 8,
        minWidth: 54,
        minHeight: 52,
        fontSize: 22,
        boxShadow: selected === value ? "0 0 18px rgba(34,197,94,0.45)" : "none",
      }}
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
      style={{
        width: "100%",
        padding: "16px 16px",
        borderRadius: 14,
        border: "2px solid rgba(255,255,255,0.15)",
        background: active ? "#dc2626" : bg,
        color: "white",
        fontWeight: 900,
        fontSize: 16,
        cursor: disabled ? "default" : "pointer",
        marginBottom: 12,
        boxShadow: active ? "0 0 20px rgba(248,113,113,0.55)" : "none",
      }}
    >
      {active ? `${label} ACTIVADO` : label}
    </button>
  );
}

function JudgePatternColorPanel({ judge, onSelectValue, onSave, onToggleZeroSide }) {
  const locked = !!judge.pattern.sent;
  const hongZero = !!judge.pattern.hong.zero;
  const chongZero = !!judge.pattern.chong.zero;

  const totals = patternTotalsForJudge(judge);

  const toggleValue = (side, field, value) => {
    if (locked) return;
    if (side === "hong" && hongZero) return;
    if (side === "chong" && chongZero) return;

    const current = judge.pattern[side][field] || 0;
    const next = current === value ? 0 : value;
    onSelectValue(side, field, next);
  };

  const SidePanel = ({ side, title, bg, border }) => (
    <div style={{ ...styles.panel, background: bg, border }}>
      <div style={{ fontWeight: 900, marginBottom: 8 }}>{title}</div>

      <ZeroAbsoluteButton
        active={judge.pattern[side].zero}
        disabled={locked}
        onClick={() => onToggleZeroSide(side)}
        label={`CERO ABSOLUTO ${title}`}
        bg={side === "hong" ? "#7f1d1d" : "#1e3a8a"}
      />

      <div style={{ marginBottom: 8 }}>Contenido técnico</div>
      <div>{[1, 2, 3, 4, 5].map((n) => <ScoreChoice key={`${side}-tech-${n}`} selected={judge.pattern[side].tech || 0} value={n} disabled={locked || judge.pattern[side].zero} onClick={() => toggleValue(side, "tech", n)} />)}</div>

      <div style={{ margin: "12px 0 8px" }}>Poder</div>
      <div>{[1, 2, 3].map((n) => <ScoreChoice key={`${side}-power-${n}`} selected={judge.pattern[side].power || 0} value={n} disabled={locked || judge.pattern[side].zero} onClick={() => toggleValue(side, "power", n)} />)}</div>

      <div style={{ margin: "12px 0 8px" }}>Ritmo</div>
      <div>{[1, 2, 3].map((n) => <ScoreChoice key={`${side}-rhythm-${n}`} selected={judge.pattern[side].rhythm || 0} value={n} disabled={locked || judge.pattern[side].zero} onClick={() => toggleValue(side, "rhythm", n)} />)}</div>

      <div style={{ marginTop: 12, fontWeight: 900 }}>Total: {side === "hong" ? totals.hong : totals.chong}</div>
    </div>
  );

  return (
    <div style={{ ...styles.panel, background: "#07111f", border: "1px solid #17304f" }}>
      <div style={{ fontWeight: 900, marginBottom: 16, fontSize: 28, textAlign: "center" }}>JUEZ {judge.id}</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <SidePanel side="hong" title={HONG} bg="#2a0606" border="1px solid #631010" />
        <SidePanel side="chong" title={CHONG} bg="#07172f" border="1px solid #174a9c" />
      </div>

      <div style={{ marginTop: 18 }}>
        <AppButton style={styles.green} onClick={onSave}>Guardar / Enviar</AppButton>
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

function PublicCompetitorPanel({ fighter, title, color }) {
  return (
    <div style={{ borderRadius: 34, background: color, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "22px 18px", minWidth: 0, boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.10)" }}>
      <div style={{ fontSize: 32, fontWeight: 900, letterSpacing: "0.16em", lineHeight: 1 }}>{title}</div>
      <div style={{ marginTop: 26, fontSize: 66, fontWeight: 900, lineHeight: 0.98, textTransform: "uppercase", textAlign: "center", wordBreak: "break-word" }}>
        {fighter.name || title}
      </div>
      <div style={{ marginTop: 12, fontSize: 24, fontWeight: 600, opacity: 0.95, textAlign: "center", wordBreak: "break-word" }}>
        {fighter.club || "ACADEMIA / EQUIPO"}
      </div>
    </div>
  );
}

function PublicScreen({ meta, navigate }) {
  const time = useClock(meta);
  const p = meta.patternResult || makeEmptyPatternResult();
  const { left, right } = getDisplaySides(meta, "public");

  return (
    <Frame16x9>
      <AppButton
        style={{ ...styles.gray, position: "absolute", right: 26, bottom: 18, zIndex: 20, fontSize: 22, padding: "12px 22px", boxShadow: "0 0 18px rgba(255,255,255,0.16)" }}
        onClick={() => navigate("/")}
      >
        Inicio
      </AppButton>

      <div style={{ width: "100%", height: "100%", display: "grid", gridTemplateRows: "190px 1fr 52px", padding: "18px 24px 10px 24px", boxSizing: "border-box" }}>
        <div style={{ display: "grid", gridTemplateColumns: "420px 1fr 420px", alignItems: "center" }}>
          <div style={{ display: "flex", justifyContent: "flex-start", alignItems: "center" }}>
            <img src="/logo-universe.png" alt="Hwarang Universe" style={{ maxWidth: 420, maxHeight: 190, width: "auto", height: "auto", objectFit: "contain", display: "block" }} />
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: "0.24em", lineHeight: 1, opacity: 0.92 }}>HWARANG SCORING</div>
            <div style={{ marginTop: 12, fontSize: 70, fontWeight: 900, lineHeight: 1, letterSpacing: "0.04em" }}>PATTERNS</div>
            <div style={{ marginTop: 12, fontSize: 28, fontWeight: 800, letterSpacing: "0.10em", opacity: 0.92 }}>FORMAS GUP</div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
            <img src="/logo-patterns.png" alt="Hwarang Patterns" style={{ maxWidth: 420, maxHeight: 190, width: "auto", height: "auto", objectFit: "contain", display: "block" }} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 360px 1fr", gap: 20, minHeight: 0 }}>
          <div style={{ borderRadius: 28, background: left.color === "hong" ? "linear-gradient(180deg, rgba(185,28,28,0.95) 0%, rgba(80,7,7,0.98) 100%)" : "linear-gradient(180deg, rgba(29,78,216,0.95) 0%, rgba(14,35,86,0.98) 100%)", display: "flex", flexDirection: "column", justifyContent: "space-between", alignItems: "stretch", padding: "28px 24px" }}>
            <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: "0.12em" }}>{left.visualLabel}</div>
            <div style={{ fontSize: 70, fontWeight: 900, lineHeight: 0.95 }}>{meta[left.color]?.name || left.visualLabel}</div>
            <div style={{ fontSize: 26, opacity: 0.92 }}>{meta[left.color]?.club || "ACADEMIA / EQUIPO"}</div>
            <div style={{ fontSize: 190, fontWeight: 900, textAlign: "center", lineHeight: 1 }}>{left.color === "hong" ? p.hong || 0 : p.chong || 0}</div>
          </div>

          <div style={{ minHeight: 0, display: "grid", gridTemplateRows: "290px 1fr 120px", gap: 18 }}>
            <div style={{ borderRadius: 34, background: "linear-gradient(180deg, #ffffff 0%, #dde4ec 100%)", color: "#111", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", boxShadow: "0 8px 24px rgba(0,0,0,0.30)" }}>
              <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: "0.20em", lineHeight: 1 }}>TIME</div>
              <div style={{ marginTop: 18, fontSize: 122, fontWeight: 900, lineHeight: 0.9, letterSpacing: "-0.04em" }}>{formatTime(time)}</div>
              <div style={{ marginTop: 16, fontSize: 34, fontWeight: 900, letterSpacing: "0.08em" }}>JUECES {activeJudgeCount(meta)}</div>
            </div>

            <div style={{ borderRadius: 34, background: "rgba(255,255,255,0.06)", display: "flex", justifyContent: "center", alignItems: "center", boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.08)" }}>
              <div style={{ fontSize: 58, fontWeight: 900, lineHeight: 1, letterSpacing: "0.06em", opacity: 0.9 }}>FORMAS GUP</div>
            </div>

            <div style={{ borderRadius: 24, background: "rgba(255,255,255,0.08)", display: "flex", justifyContent: "center", alignItems: "center", boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.08)" }}>
              <div style={{ fontSize: 34, fontWeight: 900, letterSpacing: "0.08em", textAlign: "center" }}>
                {meta.patternResult?.completed ? "FALLO EMITIDO" : meta.status === "running" ? "EVALUANDO" : "LISTO"}
              </div>
            </div>
          </div>

          <div style={{ borderRadius: 28, background: right.color === "hong" ? "linear-gradient(180deg, rgba(185,28,28,0.95) 0%, rgba(80,7,7,0.98) 100%)" : "linear-gradient(180deg, rgba(29,78,216,0.95) 0%, rgba(14,35,86,0.98) 100%)", display: "flex", flexDirection: "column", justifyContent: "space-between", alignItems: "stretch", padding: "28px 24px" }}>
            <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: "0.12em", textAlign: "center" }}>{right.visualLabel}</div>
            <div style={{ fontSize: 70, fontWeight: 900, lineHeight: 0.95, textAlign: "center" }}>{meta[right.color]?.name || right.visualLabel}</div>
            <div style={{ fontSize: 26, opacity: 0.92, textAlign: "center" }}>{meta[right.color]?.club || "ACADEMIA / EQUIPO"}</div>
            <div style={{ fontSize: 190, fontWeight: 900, textAlign: "center", lineHeight: 1 }}>{right.color === "hong" ? p.hong || 0 : p.chong || 0}</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.82 }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "0.08em" }}>TORNEO / FORMAS GUP</div>
        </div>
      </div>

      {!!meta.patternResult?.completed && <WinnerFullScreen winner={meta.patternResult?.winner} zIndex={100} />}
    </Frame16x9>
  );
}

function PresidentScreen({ meta, judges, writeMeta, writeJudge, resetAll, navigate }) {
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
  const editorSaveTimeoutRef = useRef(null);
  const { left, right } = getDisplaySides(meta, "president");

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

  const saveConfig = async () => {
    const roundSeconds = Math.max(1, parseInt(secondsInput, 10) || 120);

    await writeMeta((current) => ({
      ...current,
      config: {
        ...(current.config || {}),
        roundSeconds,
      },
      pausedRemaining: current.status === "paused" ? roundSeconds : current.pausedRemaining,
    }));
  };

  const setPatternJudgeCount = async (count) => {
    await writeMeta((current) => ({
      ...current,
      config: {
        ...(current.config || {}),
        patternJudges: count,
      },
    }));
  };

  const startTimer = async () => {
    await commitEditor(editorDraftRef.current);
    await saveConfig();

    await writeMeta((current) => {
      if (current.status === "running") return current;

      const next = {
        ...current,
        status: "running",
        phaseStartedAt: Date.now(),
      };

      if (current.phase === "finished") {
        next.phase = "fight";
        next.pausedRemaining = current.config?.roundSeconds || 120;
        next.patternResult = {
          ...(current.patternResult || makeEmptyPatternResult()),
          completed: false,
          winner: "en_curso",
        };
      }

      return next;
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
    const live = patternSummary(meta, judges);

    await writeMeta((current) => {
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
    for (let i = 1; i <= MAX_JUDGES; i += 1) {
      await writeJudge(i, () => makeJudge(i));
    }

    await writeMeta((current) => {
      const roundSeconds = current.config.roundSeconds || 120;
      current.mode = "pattern";
      current.status = "paused";
      current.phase = "fight";
      current.round = 1;
      current.phaseStartedAt = null;
      current.pausedRemaining = roundSeconds;
      current.patternResult = makeEmptyPatternResult();
      return current;
    });
  };

  const applyPatternForcedWinner = async (winner) => {
    await writeMeta((current) => {
      current.patternResult = {
        ...current.patternResult,
        completed: true,
        winner,
      };
      current.phase = "finished";
      current.status = "paused";
      current.pausedRemaining = 0;
      current.phaseStartedAt = null;
      return current;
    });
  };

  const updateCompetitor = async (side, field, value) => {
    await writeMeta((current) => {
      current[side] = current[side] || getBaseCompetitor(side === "hong" ? HONG : CHONG);
      current[side][field] = value;
      return current;
    });
  };

  const showPresidentWinner = !!meta.patternResult?.completed;

  return (
    <Frame16x9>
      <div style={{ position: "absolute", inset: 0, overflow: "auto", padding: 22, boxSizing: "border-box" }}>
        <div style={{ position: "sticky", top: 0, zIndex: 120, display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12, paddingBottom: 6, background: "rgba(2,6,13,0.92)" }}>
          <AppButton style={{ ...styles.gray, boxShadow: "0 0 18px rgba(255,255,255,0.16)" }} onClick={() => navigate("/")}>Inicio</AppButton>
          <AppButton style={{ ...styles.green, boxShadow: "0 0 18px rgba(34,197,94,0.35)" }} onClick={prepareNextMatch}>Siguiente match</AppButton>
          <AppButton style={{ ...styles.gray, boxShadow: "0 0 18px rgba(255,255,255,0.16)" }} onClick={resetAll}>Reset total</AppButton>
        </div>

        <BrandHeaderLarge />

        <h1 style={{ margin: "0 0 16px 0", textAlign: "center", fontSize: "clamp(34px,4vw,64px)" }}>Presidente</h1>

        <div style={{ ...styles.panel, marginTop: 16 }}>
          <h2>Modalidad</h2>
          <div style={{ fontSize: 28, fontWeight: 900 }}>FORMAS GUP</div>
        </div>

        <div style={styles.row}>
          <div style={styles.stat}>Tiempo: <strong>{formatTime(time)}</strong></div>
          <div style={styles.stat}>Jueces: <strong>{meta.config.patternJudges}</strong></div>
          <div style={styles.stat}>Estado: <strong>{meta.phase === "finished" ? "Finalizado" : meta.status === "running" ? "En marcha" : "Pausado"}</strong></div>
        </div>

        <div style={{ ...styles.panel, marginTop: 16 }}>
          <h2>Competidores</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {["hong", "chong"].map((side) => (
              <div key={side} style={{ ...styles.panel, background: side === "hong" ? "#2a0606" : "#07172f", border: side === "hong" ? "1px solid #631010" : "1px solid #174a9c" }}>
                <div style={{ fontWeight: 900, marginBottom: 10, fontSize: 22 }}>{side === "hong" ? "Hong" : "Chong"}</div>
                <div style={{ display: "grid", gap: 10 }}>
                  <input value={side === "hong" ? editor.hongName : editor.chongName} onFocus={() => { editorFocusRef.current = true; }} onChange={(e) => updateEditorField(side === "hong" ? "hongName" : "chongName", e.target.value)} onBlur={async () => { editorFocusRef.current = false; await commitEditor(editorDraftRef.current); }} placeholder={`Nombre ${side}`} style={{ width: "100%", padding: 12, borderRadius: 10 }} />
                  <input value={side === "hong" ? editor.hongClub : editor.chongClub} onFocus={() => { editorFocusRef.current = true; }} onChange={(e) => updateEditorField(side === "hong" ? "hongClub" : "chongClub", e.target.value)} onBlur={async () => { editorFocusRef.current = false; await commitEditor(editorDraftRef.current); }} placeholder={`Club ${side}`} style={{ width: "100%", padding: 12, borderRadius: 10 }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ ...styles.panel, marginTop: 16 }}>
          <h2>Cambio de lado independiente</h2>
          <div style={styles.row}>
            <AppButton style={meta.publicSwapSides ? styles.green : styles.gray} onClick={() => writeMeta((c) => { c.publicSwapSides = !c.publicSwapSides; return c; })}>
              Pública: {meta.publicSwapSides ? "Invertida" : "Normal"}
            </AppButton>
            <AppButton style={meta.presidentSwapSides ? styles.green : styles.gray} onClick={() => writeMeta((c) => { c.presidentSwapSides = !c.presidentSwapSides; return c; })}>
              Presidente: {meta.presidentSwapSides ? "Invertida" : "Normal"}
            </AppButton>
          </div>

          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ ...styles.panel, background: "#091423" }}>
              <div style={{ fontWeight: 900, marginBottom: 10 }}>Vista presidente</div>
              <div>Izquierda: <strong>{left.visualLabel} - {left.name || left.visualLabel}</strong></div>
              <div>Derecha: <strong>{right.visualLabel} - {right.name || right.visualLabel}</strong></div>
            </div>
            <div style={{ ...styles.panel, background: "#091423" }}>
              <div style={{ fontWeight: 900, marginBottom: 10 }}>Vista pública</div>
              <div>Izquierda: <strong>{getDisplaySides(meta, "public").left.visualLabel} - {getDisplaySides(meta, "public").left.name || getDisplaySides(meta, "public").left.visualLabel}</strong></div>
              <div>Derecha: <strong>{getDisplaySides(meta, "public").right.visualLabel} - {getDisplaySides(meta, "public").right.name || getDisplaySides(meta, "public").right.visualLabel}</strong></div>
            </div>
          </div>
        </div>

        <div style={{ ...styles.panel, marginTop: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "end" }}>
            <div>
              <label>Tiempo de evaluación (segundos)</label>
              <input type="number" min="1" value={secondsInput} onChange={(e) => setSecondsInput(e.target.value)} style={{ width: "100%", padding: 10, marginTop: 6, borderRadius: 10 }} />
              <div style={{ ...styles.row, marginTop: 10 }}>
                {[60, 90, 120, 180, 300].map((s) => (
                  <AppButton key={s} style={styles.gray} onClick={() => setSecondsInput(String(s))}>{s}s</AppButton>
                ))}
              </div>
            </div>

            <AppButton style={styles.blue} onClick={saveConfig}>Guardar configuración</AppButton>
          </div>

          <div style={{ ...styles.row, marginTop: 16 }}>
            <AppButton style={meta.config.patternJudges === 3 ? styles.green : styles.gray} onClick={() => setPatternJudgeCount(3)}>3 jueces</AppButton>
            <AppButton style={meta.config.patternJudges === 5 ? styles.green : styles.gray} onClick={() => setPatternJudgeCount(5)}>5 jueces</AppButton>
          </div>

          <div style={{ ...styles.row, marginTop: 16 }}>
            <AppButton style={{ ...styles.green, boxShadow: "0 0 18px rgba(34,197,94,0.35)" }} onClick={startTimer}>Iniciar</AppButton>
            <AppButton style={{ ...styles.amber, boxShadow: "0 0 18px rgba(245,158,11,0.35)" }} onClick={pauseTimer}>Pausar</AppButton>
            <AppButton style={{ ...styles.blue, boxShadow: "0 0 18px rgba(59,130,246,0.35)" }} disabled={p.sent !== activeJudgeCount(meta)} onClick={closePatternEvaluation}>
              Cerrar evaluación
            </AppButton>
          </div>
        </div>

        <QRSection meta={meta} />

        <div style={{ ...styles.panel, marginTop: 16 }}>
          <h2>Fallo arbitral Formas</h2>
          <div style={styles.row}>
            <AppButton style={styles.red} onClick={() => applyPatternForcedWinner("hong")}>Ganador Rojo</AppButton>
            <AppButton style={styles.blue} onClick={() => applyPatternForcedWinner("chong")}>Ganador Azul</AppButton>
            <AppButton style={styles.gray} onClick={() => applyPatternForcedWinner("draw")}>Empate</AppButton>
          </div>
        </div>

        <div style={{ ...styles.panel, marginTop: 16 }}>
          <h2>Resultado Formas Gup</h2>
          <div style={styles.row}>
            <div style={{ ...styles.stat, background: "#2a0606", border: "1px solid #631010" }}>Hong total: <strong>{p.hong}</strong></div>
            <div style={{ ...styles.stat, background: "#07172f", border: "1px solid #174a9c" }}>Chong total: <strong>{p.chong}</strong></div>
            <div style={styles.stat}>Jueces enviados: <strong>{p.sent}/{activeJudgeCount(meta)}</strong></div>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <h2>Tarjetas de jueces (solo lectura)</h2>
          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
            {currentJudges.map((j) => (
              <JudgePatternReadOnlyCard key={j.id} judge={j} />
            ))}
          </div>
        </div>

        {showPresidentWinner && <WinnerFullScreen winner={meta.patternResult.winner} zIndex={100} />}
      </div>
    </Frame16x9>
  );
}

function JudgeScreen({ meta, judges, writeJudge, judgeId, navigate }) {
  const time = useClock(meta);
  const prevFinishedRef = useRef(false);

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
        <AppButton style={{ ...styles.gray, boxShadow: "0 0 18px rgba(255,255,255,0.16)" }} onClick={() => navigate("/")}>Inicio</AppButton>
        <BrandHeaderSmall />
        <h1>Juez {judgeId}</h1>
        <div style={styles.panel}>Este juez no está activo en la configuración actual.</div>
      </div>
    );
  }

  const judge = judges.find((j) => j.id === judgeId) || makeJudge(judgeId);
  const [localPattern, setLocalPattern] = useState(() => clone(judge.pattern));

  useEffect(() => {
    setLocalPattern(clone(judge.pattern));
  }, [judgeId, JSON.stringify(judge.pattern)]);

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
    const patternToSave = {
      hong: { ...localPattern.hong },
      chong: { ...localPattern.chong },
      sent: true,
    };

    await writeJudge(judgeId, (j) => {
      j.pattern = patternToSave;
      return j;
    });

    setLocalPattern(patternToSave);
  };

  const judgeWinner = meta.patternResult?.winner;
  const showJudgeWinner = !!meta.patternResult?.completed;
  const judgePreview = { ...judge, pattern: localPattern };

  return (
    <div style={{ ...styles.page, background: "#06101c", minHeight: "100vh" }}>
      <AppButton style={{ ...styles.gray, boxShadow: "0 0 18px rgba(255,255,255,0.16)" }} onClick={() => navigate("/")}>Inicio</AppButton>

      <BrandHeaderSmall />

      <h1>Juez {judgeId}</h1>

      <div style={styles.row}>
        <div style={styles.stat}>Tiempo: <strong>{formatTime(time)}</strong></div>
        <div style={styles.stat}>Modalidad: <strong>FORMAS GUP</strong></div>
      </div>

      <div style={{ marginTop: 16 }}>
        <JudgePatternColorPanel judge={judgePreview} onSelectValue={selectPatternValue} onSave={savePattern} onToggleZeroSide={togglePatternZeroSide} />
      </div>

      {showJudgeWinner && <WinnerFullScreen winner={judgeWinner} />}
    </div>
  );
}

export default function App() {
  const { meta, judges, writeMeta, writeJudge, resetAll } = useFightData();
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
        writeJudge={writeJudge}
        resetAll={resetAll}
        navigate={navigate}
      /></>
    );
  }

  if (path === "/public") {
    return <><GlobalAppStyle /><PublicScreen meta={meta} navigate={navigate} /></>;
  }

  if (path.startsWith("/judge/")) {
    const n = Number(path.split("/")[2]);
    if (n >= 1 && n <= MAX_JUDGES) {
      return (
        <><GlobalAppStyle /><JudgeScreen
          meta={meta}
          judges={judges}
          writeJudge={writeJudge}
          judgeId={n}
          navigate={navigate}
        /></>
      );
    }
  }

  return <><GlobalAppStyle /><Home navigate={navigate} meta={meta} /></>;
}
