import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, doc, collection, documentId, query, where } from "firebase/firestore";

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

export const roomMetaRef = (roomId) =>
  doc(db, "rooms", roomId, "meta", "current");
export const roomJudgesColRef = (roomId) =>
  collection(db, "rooms", roomId, "judges");
export const roomJudgesQuery = (roomId) =>
  query(roomJudgesColRef(roomId), where(documentId(), "in", ["1", "2", "3", "4", "5"]));
export const roomJudgeRef = (roomId, id) =>
  doc(db, "rooms", roomId, "judges", String(id));
