import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, runTransaction, setDoc, setLogLevel, updateDoc } from "firebase/firestore";

setLogLevel("silent");

const projectId = "demo-hwarang-scoring";
let env;

const freshJudge = (id, evaluationId = 7) => ({
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
});

function claims(role, matchId, judgeId = null) {
  return { role, matchId, judgeId, arenaId: null };
}

function dbFor(uid, token) {
  return env.authenticatedContext(uid, token).firestore();
}

async function seed() {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const matchId of ["match-a", "match-b"]) {
      await setDoc(doc(db, "matches", matchId), {
        evaluationId: 7,
        status: "paused",
        patternResult: { completed: false, winner: "en_curso" },
      });
      await setDoc(doc(db, "matches", matchId, "judges", "1"), freshJudge(1));
      await setDoc(doc(db, "matches", matchId, "judges", "2"), freshJudge(2));
      await setDoc(doc(db, "matches", matchId, "public", "state"), {
        status: "PENDING",
        evaluationId: 7,
        result: null,
      });
      await setDoc(doc(db, "matches", matchId, "clock", "state"), {
        evaluationId: 7,
        startedAt: null,
        endsAt: null,
        timeExpired: false,
      });
    }
  });
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await seed();
});

after(async () => {
  await env?.cleanup();
});

test("unauthenticated clients cannot read private judges or write match meta", async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, "matches", "match-a", "judges", "1")));
  await assertFails(updateDoc(doc(db, "matches", "match-a"), { status: "running" }));
});

test("Public reads only its own public projection and cannot write", async () => {
  const db = dbFor("public-a", claims("public", "match-a"));
  await assertSucceeds(getDoc(doc(db, "matches", "match-a", "public", "state")));
  await assertFails(getDoc(doc(db, "matches", "match-a", "judges", "1")));
  await assertFails(getDoc(doc(db, "matches", "match-a")));
  await assertFails(getDoc(doc(db, "matches", "match-b", "public", "state")));
  await assertFails(updateDoc(doc(db, "matches", "match-a", "public", "state"), { status: "SENT" }));
  await assertFails(updateDoc(doc(db, "matches", "match-a"), { status: "running" }));
});

test("Judge 1 can make one valid POINTS submission only on Judge 1", async () => {
  const db = dbFor("judge-1-a", claims("judge", "match-a", "1"));
  const own = doc(db, "matches", "match-a", "judges", "1");
  const points = {
    evaluationId: 7,
    hong: { tech: 5, power: 3, rhythm: 3, zero: false },
    chong: { tech: 1, power: 1, rhythm: 1, zero: false },
    sent: true,
  };
  await assertSucceeds(updateDoc(own, {
    "pattern.evaluationId": points.evaluationId,
    "pattern.hong": points.hong,
    "pattern.chong": points.chong,
    "pattern.sent": points.sent,
  }));
  await assertFails(updateDoc(own, { "pattern.hong.tech": 4 }));
  await assertFails(updateDoc(doc(db, "matches", "match-a", "judges", "2"), { "pattern.sent": true }));
  await assertFails(updateDoc(doc(db, "matches", "match-a"), { status: "running" }));
  await assertFails(updateDoc(doc(db, "matches", "match-a", "public", "state"), { status: "SENT" }));
});

test("Judge 1 can make one valid BINARY submission and cannot change the result", async () => {
  const db = dbFor("judge-1-a", claims("judge", "match-a", "1"));
  const own = doc(db, "matches", "match-a", "judges", "1");
  await assertSucceeds(updateDoc(own, {
    "pattern.binary": { evaluationId: 7, vote: "hong", sent: true },
  }));
  await assertFails(updateDoc(own, {
    "pattern.binary": { evaluationId: 7, vote: "chong", sent: true },
  }));
  await assertFails(updateDoc(doc(db, "matches", "match-a"), {
    patternResult: { completed: true, winner: "hong" },
  }));
});

test("Judge identity is isolated from another match", async () => {
  const db = dbFor("judge-1-a", claims("judge", "match-a", "1"));
  await assertFails(getDoc(doc(db, "matches", "match-b", "judges", "1")));
  await assertFails(updateDoc(doc(db, "matches", "match-b", "judges", "1"), {
    "pattern.binary": { evaluationId: 7, vote: "hong", sent: true },
  }));
});

test("President operates the assigned match but not another match or backend projections", async () => {
  const db = dbFor("president-a", claims("president", "match-a"));
  await assertSucceeds(updateDoc(doc(db, "matches", "match-a"), { status: "running" }));
  await assertSucceeds(setDoc(doc(db, "matches", "match-a", "judges", "3"), freshJudge(3)));
  await assertFails(updateDoc(doc(db, "matches", "match-b"), { status: "running" }));
  await assertFails(getDoc(doc(db, "matches", "match-b", "judges", "1")));
  await assertFails(updateDoc(doc(db, "matches", "match-a", "clock", "state"), { timeExpired: true }));
  await assertFails(updateDoc(doc(db, "matches", "match-a", "public", "state"), { status: "SENT" }));
});

test("President cannot mutate Match Credits fields from the client", async () => {
  const db = dbFor("president-a", claims("president", "match-a"));
  await assertFails(updateDoc(doc(db, "matches", "match-a"), { creditsUsed: 1 }));
  assert.ok(true);
});

test("POINTS x100 from two clients accepts exactly one immutable card", async (t) => {
  const clients = [
    dbFor("judge-1-device-a", claims("judge", "match-a", "1")),
    dbFor("judge-1-device-b", claims("judge", "match-a", "1")),
  ];
  const started = performance.now();
  const attempts = Array.from({ length: 100 }, (_, index) => {
    const payload = index === 0
      ? { tech: 5, power: 3, rhythm: 3, zero: false }
      : { tech: 1, power: 1, rhythm: 1, zero: false };
    return updateDoc(doc(clients[index % 2], "matches", "match-a", "judges", "1"), {
      "pattern.evaluationId": 7,
      "pattern.hong": payload,
      "pattern.chong": payload,
      "pattern.sent": true,
    });
  });
  const settled = await Promise.allSettled(attempts);
  const accepted = settled.filter(({ status }) => status === "fulfilled").length;
  const persisted = await getDoc(doc(clients[0], "matches", "match-a", "judges", "1"));
  t.diagnostic(`durationMs=${(performance.now() - started).toFixed(1)} accepted=${accepted} rejected=${100 - accepted}`);
  assert.equal(accepted, 1);
  assert.equal(persisted.data().pattern.sent, true);
  assert.deepEqual(persisted.data().pattern.hong, persisted.data().pattern.chong);
});

test("BINARY x100 from two clients accepts one alternating decision and never DRAW", async (t) => {
  const clients = [
    dbFor("judge-1-device-a", claims("judge", "match-a", "1")),
    dbFor("judge-1-device-b", claims("judge", "match-a", "1")),
  ];
  const started = performance.now();
  const attempts = Array.from({ length: 100 }, (_, index) => updateDoc(
    doc(clients[index % 2], "matches", "match-a", "judges", "1"),
    { "pattern.binary": { evaluationId: 7, vote: index % 2 === 0 ? "hong" : "chong", sent: true } },
  ));
  const settled = await Promise.allSettled(attempts);
  const accepted = settled.filter(({ status }) => status === "fulfilled").length;
  const persisted = await getDoc(doc(clients[0], "matches", "match-a", "judges", "1"));
  t.diagnostic(`durationMs=${(performance.now() - started).toFixed(1)} accepted=${accepted} rejected=${100 - accepted}`);
  assert.equal(accepted, 1);
  assert.ok(["hong", "chong"].includes(persisted.data().pattern.binary.vote));
});

async function guardedPresidentTransition(db, expectedEvaluationId, mutate) {
  return runTransaction(db, async (transaction) => {
    const ref = doc(db, "matches", "match-a");
    const snapshot = await transaction.get(ref);
    const current = snapshot.data();
    if (current.evaluationId !== expectedEvaluationId) return "stale_generation";
    const next = mutate(current);
    if (!next) return "rejected";
    transaction.set(ref, next);
    return "accepted";
  });
}

test("NEXT x20 with two Presidents advances one generation exactly once", async (t) => {
  await env.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), "matches", "match-a"), { patternResult: { completed: true, winner: "hong" } });
  });
  const clients = [
    dbFor("president-device-a", claims("president", "match-a")),
    dbFor("president-device-b", claims("president", "match-a")),
  ];
  const started = performance.now();
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => guardedPresidentTransition(
    clients[index % 2],
    7,
    (current) => current.patternResult.completed ? {
      ...current,
      evaluationId: 8,
      evaluationStarted: false,
      patternResult: { completed: false, winner: "en_curso" },
    } : null,
  )));
  const final = await getDoc(doc(clients[0], "matches", "match-a"));
  t.diagnostic(`durationMs=${(performance.now() - started).toFixed(1)} accepted=${results.filter((value) => value === "accepted").length}`);
  assert.equal(results.filter((value) => value === "accepted").length, 1);
  assert.equal(final.data().evaluationId, 8);
});

test("RESET x20 with two Presidents advances once and clears old votes", async () => {
  const clients = [
    dbFor("president-device-a", claims("president", "match-a")),
    dbFor("president-device-b", claims("president", "match-a")),
  ];
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => runTransaction(clients[index % 2], async (transaction) => {
    const db = clients[index % 2];
    const metaRef = doc(db, "matches", "match-a");
    const judgeRef = doc(db, "matches", "match-a", "judges", "1");
    const current = (await transaction.get(metaRef)).data();
    if (current.evaluationId !== 7) return "stale_generation";
    transaction.update(metaRef, { evaluationId: 8, status: "paused", patternResult: { completed: false, winner: "en_curso" } });
    transaction.set(judgeRef, freshJudge(1, 8));
    return "accepted";
  })));
  const finalMeta = await getDoc(doc(clients[0], "matches", "match-a"));
  const finalJudge = await getDoc(doc(clients[0], "matches", "match-a", "judges", "1"));
  assert.equal(results.filter((value) => value === "accepted").length, 1);
  assert.equal(finalMeta.data().evaluationId, 8);
  assert.equal(finalJudge.data().pattern.sent, false);
  assert.equal(finalJudge.data().pattern.binary.sent, false);
});

test("CLOSE x20 with two Presidents creates one official completion", async (t) => {
  await env.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), "matches", "match-a"), { time: 0, allSent: true });
  });
  const clients = [
    dbFor("president-device-a", claims("president", "match-a")),
    dbFor("president-device-b", claims("president", "match-a")),
  ];
  const started = performance.now();
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => guardedPresidentTransition(
    clients[index % 2],
    7,
    (current) => current.time === 0 && current.allSent && !current.patternResult.completed ? {
      ...current,
      patternResult: { completed: true, winner: "hong" },
    } : null,
  )));
  const final = await getDoc(doc(clients[0], "matches", "match-a"));
  t.diagnostic(`durationMs=${(performance.now() - started).toFixed(1)} accepted=${results.filter((value) => value === "accepted").length}`);
  assert.equal(results.filter((value) => value === "accepted").length, 1);
  assert.equal(final.data().patternResult.completed, true);
});

test("START/PAUSE x40 with two Presidents preserves a coherent timer state", async (t) => {
  await env.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), "matches", "match-a"), {
      evaluationStarted: false,
      phase: "fight",
      status: "paused",
      pausedRemaining: 120,
      phaseStartedAt: null,
    });
  });
  const clients = [
    dbFor("president-device-a", claims("president", "match-a")),
    dbFor("president-device-b", claims("president", "match-a")),
  ];
  const started = performance.now();
  const results = await Promise.all(Array.from({ length: 40 }, (_, index) => runTransaction(clients[index % 2], async (transaction) => {
    const db = clients[index % 2];
    const ref = doc(db, "matches", "match-a");
    const current = (await transaction.get(ref)).data();
    if (current.evaluationId !== 7 || current.patternResult.completed) return "rejected";
    if (index % 2 === 0) {
      if (current.status === "running") return "noop";
      transaction.update(ref, { evaluationStarted: true, status: "running", phaseStartedAt: 1_000 + index });
    } else {
      if (current.status !== "running") return "noop";
      transaction.update(ref, { status: "paused", phaseStartedAt: null, pausedRemaining: Math.max(0, current.pausedRemaining - 1) });
    }
    return "accepted";
  })));
  const final = (await getDoc(doc(clients[0], "matches", "match-a"))).data();
  t.diagnostic(`durationMs=${(performance.now() - started).toFixed(1)} writes=${results.filter((value) => value === "accepted").length}`);
  assert.equal(final.evaluationId, 7);
  assert.ok(final.status === "running" || final.status === "paused");
  assert.equal(final.status === "running", final.phaseStartedAt !== null);
  assert.ok(final.pausedRemaining >= 0);
});

test("operations from generation N are rejected after NEXT commits N+1", async () => {
  const president = dbFor("president-device-a", claims("president", "match-a"));
  const judge = dbFor("judge-1-device-a", claims("judge", "match-a", "1"));
  await assertSucceeds(updateDoc(doc(president, "matches", "match-a"), { evaluationId: 8 }));
  assert.equal(await guardedPresidentTransition(president, 7, (current) => ({ ...current, status: "running" })), "stale_generation");
  await assertFails(updateDoc(doc(judge, "matches", "match-a", "judges", "1"), {
    "pattern.binary": { evaluationId: 7, vote: "hong", sent: true },
  }));
});

test("Public abuse matrix rejects every private read and write", async () => {
  const db = dbFor("public-abuse", claims("public", "match-a"));
  const operations = [
    () => getDoc(doc(db, "matches", "match-a", "judges", "1")),
    () => updateDoc(doc(db, "matches", "match-a", "judges", "1"), { "pattern.sent": true }),
    () => updateDoc(doc(db, "matches", "match-a"), { evaluationId: 8 }),
    () => updateDoc(doc(db, "matches", "match-a"), { patternResult: { completed: true, winner: "hong" } }),
    () => updateDoc(doc(db, "matches", "match-a", "public", "state"), { status: "SENT" }),
    () => updateDoc(doc(db, "matches", "match-a", "clock", "state"), { timeExpired: true }),
    () => updateDoc(doc(db, "matches", "match-a"), { matchCredits: 999 }),
  ];
  for (const operation of operations) await assertFails(operation());
});

test("Judge escalation matrix rejects identity, scope, backend and credit changes", async () => {
  const db = dbFor("judge-abuse", claims("judge", "match-a", "1"));
  const operations = [
    () => updateDoc(doc(db, "matches", "match-a", "judges", "2"), { "pattern.sent": true }),
    () => updateDoc(doc(db, "matches", "match-a", "judges", "3"), { "pattern.sent": true }),
    () => updateDoc(doc(db, "matches", "match-a", "judges", "1"), { id: 2 }),
    () => updateDoc(doc(db, "matches", "match-a"), { evaluationId: 8 }),
    () => updateDoc(doc(db, "matches", "match-a"), { patternResult: { completed: true, winner: "hong" } }),
    () => updateDoc(doc(db, "matches", "match-a", "public", "state"), { status: "SENT" }),
    () => updateDoc(doc(db, "matches", "match-a", "clock", "state"), { timeExpired: true }),
    () => updateDoc(doc(db, "matches", "match-a"), { matchCredits: 1 }),
    () => updateDoc(doc(db, "matches", "match-b", "judges", "1"), { "pattern.sent": true }),
  ];
  for (const operation of operations) await assertFails(operation());
});

test("President and unauthenticated abuse remain isolated from private/backend state", async () => {
  const president = dbFor("president-abuse", claims("president", "match-a"));
  const anonymous = env.unauthenticatedContext().firestore();
  for (const operation of [
    () => getDoc(doc(president, "matches", "match-b")),
    () => updateDoc(doc(president, "matches", "match-b"), { status: "running" }),
    () => updateDoc(doc(president, "matches", "match-a", "public", "state"), { status: "SENT" }),
    () => updateDoc(doc(president, "matches", "match-a", "clock", "state"), { timeExpired: true }),
    () => updateDoc(doc(president, "matches", "match-a"), { matchCreditsConsumed: 1 }),
    () => getDoc(doc(anonymous, "matches", "match-a")),
    () => getDoc(doc(anonymous, "matches", "match-a", "judges", "1")),
    () => updateDoc(doc(anonymous, "matches", "match-a", "judges", "1"), { "pattern.sent": true }),
    () => updateDoc(doc(anonymous, "matches", "match-a"), { status: "running" }),
  ]) await assertFails(operation());
});
