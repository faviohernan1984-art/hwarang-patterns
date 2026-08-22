import test from "node:test";
import assert from "node:assert/strict";
import { connectFirestoreEmulator, getDoc, getDocs, setDoc, terminate } from "firebase/firestore";
import { db, roomControlRef, roomJudgeRef, roomJudgesQuery, roomMetaRef } from "./firebase.js";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

test("Rooms rules allow the baseline paths and reject Judge 6", { skip: !emulatorHost }, async () => {
  const [host, port] = emulatorHost.split(":");
  connectFirestoreEmulator(db, host, Number(port));

  try {
    await setDoc(roomMetaRef("A"), { status: "paused" });
    await setDoc(roomControlRef("A"), { evaluationId: 1, status: "paused" });
    await setDoc(roomControlRef("B"), { evaluationId: 7, status: "running" });
    assert.deepEqual((await getDoc(roomControlRef("A"))).data(), { evaluationId: 1, status: "paused" });
    assert.deepEqual((await getDoc(roomControlRef("B"))).data(), { evaluationId: 7, status: "running" });
    await setDoc(roomJudgeRef("A", 1), { id: 1 });

    const judges = await getDocs(roomJudgesQuery("A"));
    assert.deepEqual(judges.docs.map((document) => document.id), ["1"]);

    await assert.rejects(
      setDoc(roomJudgeRef("A", 6), { id: 6 }),
      (error) => error?.code === "permission-denied"
    );
  } finally {
    await terminate(db);
  }
});
