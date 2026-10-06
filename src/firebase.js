import { initializeApp, getApps } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, doc, collection, documentId, query, where } from "firebase/firestore";
import { resolveFirebaseEnvironment } from "./firebaseConfig.js";

// Validate before initialization; Node tests supply the same explicit variables.
const settings = resolveFirebaseEnvironment(import.meta.env ?? globalThis.process?.env);
const appName = "patterns-local";
let app = getApps().find(candidate => candidate.name === appName);
// HMR reuses only an app initialized and connected by this module.
if (app && !app.__patternsEmulatorSettings) throw new Error("Unverified Firebase app reuse");
if (app && app.__patternsEmulatorSettings !== JSON.stringify(settings)) throw new Error("Firebase configuration changed: reload required");
if (!app) {
  app = initializeApp(settings.firebaseConfig, appName);
  const localAuth = getAuth(app);
  connectAuthEmulator(localAuth, `http://${settings.emulator.host}:${settings.emulator.authPort}`);
  connectFirestoreEmulator(getFirestore(app), settings.emulator.host, settings.emulator.firestorePort);
  app.__patternsEmulatorSettings = JSON.stringify(settings);
}
export const db = getFirestore(app);
export const auth = getAuth(app);

export const roomMetaRef = (roomId) =>
  doc(db, "rooms", roomId, "meta", "current");
export const roomControlRef = (roomId) =>
  doc(db, "rooms", roomId, "control", "current");
export const roomPublicStateRef = (roomId) =>
  doc(db, "rooms", roomId, "publicState", "current");
export const roomJudgesColRef = (roomId) =>
  collection(db, "rooms", roomId, "judges");
export const roomJudgesQuery = (roomId) =>
  query(roomJudgesColRef(roomId), where(documentId(), "in", ["1", "2", "3", "4", "5"]));
export const roomJudgeRef = (roomId, id) =>
  doc(db, "rooms", roomId, "judges", String(id));
export const roomSubmissionsColRef = (roomId) =>
  collection(db, "rooms", roomId, "submissions");
export const roomSubmissionsQuery = (roomId) =>
  query(roomSubmissionsColRef(roomId), where(documentId(), "in", ["1", "2", "3", "4", "5"]));
export const roomSubmissionRef = (roomId, id) =>
  doc(db, "rooms", roomId, "submissions", String(id));
