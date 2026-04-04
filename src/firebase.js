import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, doc, collection } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCARTpTfP6_BCCIzQmWJDNCtUs5ATt1Y-8",
  authDomain: "hwarang-scoring.firebaseapp.com",
  projectId: "hwarang-scoring",
  storageBucket: "hwarang-scoring.firebasestorage.app",
  messagingSenderId: "309913008618",
  appId: "1:309913008618:web:ae3277153f88a054641a93"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const db = getFirestore(app);

// PATTERNS separado
export const matchMetaRef = doc(db, "matches", "patterns");
export const judgesColRef = collection(db, "matches", "patterns", "judges");
export const judgeRef = (id) =>
  doc(db, "matches", "patterns", "judges", String(id));