import test from "node:test";
import assert from "node:assert/strict";
import { binarySummary } from "./binarySummary.js";

const vote = (value, sent = true, evaluationId = 1) => ({ pattern: { binary: { evaluationId, vote: value, sent } } });
const pending = () => vote(null, false);
const meta = (patternJudges, evaluationId = 1) => ({ evaluationId, config: { patternJudges } });

const cases = [
  ["A", 3, [vote("hong"), vote("hong"), vote("chong")], { sent: 3, hong: 2, chong: 1, majorityRequired: 2, allSent: true, winner: "hong" }],
  ["B", 3, [vote("chong"), vote("hong"), vote("chong")], { sent: 3, hong: 1, chong: 2, majorityRequired: 2, allSent: true, winner: "chong" }],
  ["C", 3, [vote("hong"), pending(), pending()], { sent: 1, hong: 1, chong: 0, majorityRequired: 2, allSent: false, winner: null }],
  ["D", 3, [vote("hong"), vote("hong"), pending()], { sent: 2, hong: 2, chong: 0, majorityRequired: 2, allSent: false, winner: null }],
  ["E", 5, [vote("hong"), vote("hong"), vote("hong"), vote("chong"), vote("chong")], { sent: 5, hong: 3, chong: 2, majorityRequired: 3, allSent: true, winner: "hong" }],
  ["F", 5, [vote("chong"), vote("chong"), vote("chong"), vote("hong"), vote("hong")], { sent: 5, hong: 2, chong: 3, majorityRequired: 3, allSent: true, winner: "chong" }],
  ["G", 5, [vote("hong"), vote("hong"), vote("hong"), pending(), pending()], { sent: 3, hong: 3, chong: 0, majorityRequired: 3, allSent: false, winner: null }],
];

cases.forEach(([name, judgeCount, judges, expected]) => {
  test(`binarySummary case ${name}`, () => {
    assert.deepEqual(binarySummary(meta(judgeCount), judges), expected);
  });
});

test("sent with an invalid vote is not a valid Binary submission", () => {
  const judges = [vote(null), vote("invalid"), vote("hong")];
  assert.deepEqual(binarySummary(meta(3), judges), {
    sent: 1,
    hong: 1,
    chong: 0,
    majorityRequired: 2,
    allSent: false,
    winner: null,
  });
});

test("inactive judges do not affect the summary", () => {
  const judges = [vote("hong"), vote("hong"), vote("chong"), vote("chong"), vote("chong")];
  assert.equal(binarySummary(meta(3), judges).winner, "hong");
});

test("historical Points submissions do not count as Binary", () => {
  const judges = Array.from({ length: 3 }, () => ({
    pattern: { sent: true, binary: { vote: null, sent: false } },
  }));
  assert.equal(binarySummary(meta(3), judges).sent, 0);
  assert.equal(binarySummary(meta(3), judges).allSent, false);
});

test("Binary ignores a sent submission from an old evaluation", () => {
  const judges = [vote("hong", true, 1), vote("chong", true, 2), vote("hong", true, 2)];
  assert.deepEqual(binarySummary(meta(3, 2), judges), {
    sent: 2, hong: 1, chong: 1, majorityRequired: 2, allSent: false, winner: null,
  });
});

test("Binary keeps its existing result for the current evaluation", () => {
  const judges = [vote("hong", true, 3), vote("chong", true, 3), vote("hong", true, 3)];
  assert.equal(binarySummary(meta(3, 3), judges).winner, "hong");
});
