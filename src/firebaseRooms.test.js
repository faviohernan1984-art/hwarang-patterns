import test from "node:test";
import assert from "node:assert/strict";
import { roomMetaRef, roomJudgesColRef, roomJudgesQuery, roomJudgeRef } from "./firebase.js";

test("Firebase references are scoped to exactly one room", () => {
  assert.equal(roomMetaRef("A").path, "rooms/A/meta/current");
  assert.equal(roomJudgesColRef("A").path, "rooms/A/judges");
  assert.equal(roomJudgesQuery("A").type, "query");
  assert.equal(roomJudgeRef("A", 1).path, "rooms/A/judges/1");

  assert.equal(roomMetaRef("B").path, "rooms/B/meta/current");
  assert.equal(roomJudgesColRef("B").path, "rooms/B/judges");
  assert.equal(roomJudgeRef("B", 1).path, "rooms/B/judges/1");
});
