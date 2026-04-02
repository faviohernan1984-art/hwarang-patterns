import { initializeApp } from "firebase/app";
import { getFirestore, doc, collection } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCARTpTfP6_BCCIzQmWJDNCtUs5ATt1Y-8",
  authDomain: "hwarang-scoring.firebaseapp.com",
  projectId: "hwarang-scoring",
  storageBucket: "hwarang-scoring.firebasestorage.app",
  messagingSenderId: "309913008618",
  appId: "1:309913008618:web:ae3277153f88a054641a93"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);

// referencias principales
export const matchMetaRef = doc(db, "matches", "meta");
export const judgesColRef = collection(db, "judges");
export const judgeRef = (id) => doc(db, "judges", String(id));