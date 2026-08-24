import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

test("Rooms rules are limited to valid room control, meta and judge documents", () => {
  assert.match(rules, /roomId\.matches\('\^\[A-Za-z0-9_-\]\{1,64\}\$'\)/);
  assert.match(rules, /match \/rooms\/\{roomId\}/);
  assert.match(rules, /match \/meta\/current/);
  assert.match(rules, /match \/control\/current/);
  assert.match(rules, /match \/submissions\/\{judgeId\}/);
  assert.match(rules, /validPatternsSubmissionJudge\(judgeId\)/);
  assert.match(rules, /request\.resource\.data\.judgeId == 5/);
  assert.match(rules, /hasOnly\(\[\s*"evaluationId", "judgeId", "mode", "scores", "sent", "submittedAt"/);
  assert.match(rules, /judgeId in \["1", "2", "3", "4", "5"\]/);
  assert.match(rules, /allow delete: if false;/);
  assert.doesNotMatch(rules, /match \/rooms\/\{document=\*\*\}/);
});

test("the existing global deny-all remains in place", () => {
  assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
  assert.doesNotMatch(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if true;/);
});
