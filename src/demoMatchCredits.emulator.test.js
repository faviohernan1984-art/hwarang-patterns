/* global process */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, deleteDoc, disableNetwork, enableNetwork } from "firebase/firestore";
import { createDemoMatchCredits } from "./demoMatchCredits.js";
import { demoMatchCreditsRemote, demoSessionRef } from "./demoMatchCreditsFirebase.js";

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (host && host !== "127.0.0.1:8080") throw Error("Demo credits tests require the local emulator");
if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== "demo-patterns-gups") throw Error("Demo project only");

test("DEMO credit transactions preserve consumption and enforce room/role/session rules", { skip: !host }, async t => {
  const environment = await initializeTestEnvironment({
    projectId: "demo-patterns-gups",
    firestore: { host: "127.0.0.1", port: 8080, rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") },
  });
  const roomId = "CREDIT_TEST";
  const sessionId = "session-1";
  const metaPath = `rooms/${roomId}/meta/current`;
  try {
    await environment.withSecurityRulesDisabled(async context => {
      await deleteDoc(demoSessionRef(context.firestore(), roomId, sessionId));
      await setDoc(doc(context.firestore(), metaPath), { demoSessionId: sessionId, presidentSwapSides: false, patternResult: { forcedDecisionToken: "old", completed: true } });
      await setDoc(doc(context.firestore(), "rooms/CREDIT_PRO/meta/current"), { presidentSwapSides: false });
    });
    const president = environment.authenticatedContext("credits-president", { roomId, role: "president" }).firestore();
    const anotherPresident = environment.authenticatedContext("credits-president-2", { roomId, role: "president" }).firestore();
    const remote = demoMatchCreditsRemote(president, roomId, sessionId);
    const ledger = demoSessionRef(president, roomId, sessionId);

    await t.test("concurrent overlapping CLOSE transactions deduplicate and do not overwrite remote IDs", async () => {
      await remote.merge([1, 2]);
      await Promise.all([
        remote.merge([2, 3]),
        demoMatchCreditsRemote(anotherPresident, roomId, sessionId).merge([3, 4]),
      ]);
      const snapshot = await getDoc(ledger);
      assert.deepEqual(snapshot.data().consumedEvaluationIds, [1, 2, 3, 4]);
      assert.equal(snapshot.data().confirmedCount, 4);
      await remote.merge([1, 4]);
      assert.equal((await getDoc(ledger)).data().confirmedCount, 4);
    });

    await t.test("offline CLOSE persists immediately and syncs once after reconnect", async () => {
      const values = new Map();
      const storage = {
        get length() { return values.size; },
        key: index => [...values.keys()][index] ?? null,
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
      };
      const options = { storage, projectId: "demo-patterns-gups", roomId, sessionId, remote };
      const credits = createDemoMatchCredits(options);
      await disableNetwork(president);
      assert.equal(credits.consume(5), true);
      assert.equal(credits.getCount(), 1);
      await credits.sync();
      assert.equal(createDemoMatchCredits(options).consume(5), false);
      await enableNetwork(president);
      await new Promise(resolve => setTimeout(resolve, 100));
      await credits.sync();
      assert.deepEqual((await getDoc(ledger)).data().consumedEvaluationIds, [1, 2, 3, 4, 5]);
      assert.equal(credits.getCount(), 5);
    });

    await t.test("only the assigned President can write; previous consumption cannot shrink", async () => {
      const judge = environment.authenticatedContext("credits-judge", { roomId, role: "judge", judgeId: 1 }).firestore();
      const publicDb = environment.authenticatedContext("credits-public", { roomId, role: "public" }).firestore();
      const outsider = environment.authenticatedContext("credits-other", { roomId: "OTHER", role: "president" }).firestore();
      const data = { sessionId, consumedEvaluationIds: [1], confirmedCount: 1 };
      for (const db of [judge, publicDb, outsider, environment.unauthenticatedContext().firestore()]) {
        await assertFails(setDoc(demoSessionRef(db, roomId, sessionId), data));
        await assertFails(getDoc(demoSessionRef(db, roomId, sessionId)));
      }
      await assertFails(setDoc(ledger, data));
      await assertFails(deleteDoc(ledger));
      await assertFails(setDoc(ledger, { sessionId, consumedEvaluationIds: [1, 2, 3, 4, 5], confirmedCount: 99 }));
      await assertFails(setDoc(ledger, { sessionId, consumedEvaluationIds: [1, 2, 3, 4, 5, 5], confirmedCount: 6 }));
      await assertFails(setDoc(demoSessionRef(president, roomId, "wrong-session"), { ...data, sessionId: "wrong-session" }));
    });

    await t.test("sports metadata merges preserve the session and cannot activate/restart a DEMO from the browser", async () => {
      const meta = doc(president, metaPath);
      await assertSucceeds(setDoc(meta, { presidentSwapSides: true, patternResult: { completed: false } }, { mergeFields: ["presidentSwapSides", "patternResult"] }));
      assert.equal((await getDoc(meta)).data().patternResult.forcedDecisionToken, undefined);
      assert.equal((await getDoc(meta)).data().demoSessionId, sessionId);
      await assertFails(setDoc(meta, { demoSessionId: "restarted" }, { merge: true }));
      await assertFails(setDoc(meta, { presidentSwapSides: false }));
      const professional = environment.authenticatedContext("credits-pro", { roomId: "CREDIT_PRO", role: "president" }).firestore();
      await assertFails(setDoc(doc(professional, "rooms/CREDIT_PRO/meta/current"), { demoSessionId: "new" }, { merge: true }));
      await assertFails(setDoc(demoSessionRef(professional, "CREDIT_PRO", sessionId), { sessionId, consumedEvaluationIds: [1], confirmedCount: 1 }));
    });
  } finally {
    await environment.cleanup();
  }
});

