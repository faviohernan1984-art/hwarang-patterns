import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, doc, collection } from "firebase/firestore";
import { resolveFirebaseEnvironment } from "./firebaseConfig.js";

export const firebaseEnvironment = resolveFirebaseEnvironment(import.meta.env);
const app = getApps().length ? getApp() : initializeApp(firebaseEnvironment.firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);

const EMULATOR_CONNECTION_KEY = Symbol.for("hsu.patterns.firebaseEmulatorsConnected");
if (firebaseEnvironment.useEmulator && !globalThis[EMULATOR_CONNECTION_KEY]) {
  const { host, firestorePort, authPort } = firebaseEnvironment.emulator;
  connectFirestoreEmulator(db, host, firestorePort);
  connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
  globalThis[EMULATOR_CONNECTION_KEY] = true;
}

// PATTERNS separado
export const matchMetaRef = doc(db, "matches", "patterns");
export const judgesColRef = collection(db, "matches", "patterns", "judges");
export const judgeRef = (id) =>
  doc(db, "matches", "patterns", "judges", String(id));
