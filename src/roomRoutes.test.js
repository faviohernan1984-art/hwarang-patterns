import test from "node:test";
import assert from "node:assert/strict";
import { parseAppRoute, roomBasePath } from "./roomRoutes.js";

test("canonical room routes expose room, role and judge identity", () => {
  assert.deepEqual(parseAppRoute("/rooms/A/president"), { valid: true, roomId: "A", role: "president", judgeId: null });
  assert.deepEqual(parseAppRoute("/rooms/B/public"), { valid: true, roomId: "B", role: "public", judgeId: null });
  assert.deepEqual(parseAppRoute("/rooms/final-2/judge/5"), { valid: true, roomId: "final-2", role: "judge", judgeId: 5 });
  assert.deepEqual(parseAppRoute("/rooms/A"), { valid: true, roomId: "A", role: "home", judgeId: null });
});

test("singular room routes remain compatible aliases", () => {
  assert.deepEqual(parseAppRoute("/room/A/president"), { valid: true, roomId: "A", role: "president", judgeId: null });
  assert.deepEqual(parseAppRoute("/room/A/public"), { valid: true, roomId: "A", role: "public", judgeId: null });
  assert.deepEqual(parseAppRoute("/room/A/judge/1"), { valid: true, roomId: "A", role: "judge", judgeId: 1 });
});

test("invalid routes are explicit and never fall back to a room", () => {
  assert.equal(parseAppRoute("/rooms/A/judge/6").reason, "INVALID_JUDGE_ID");
  assert.equal(parseAppRoute("/rooms/A/unknown").reason, "INVALID_ROOM_ROUTE");
  assert.equal(parseAppRoute("/rooms/invalid.room/public").reason, "INVALID_ROOM_ID");
  assert.equal(parseAppRoute("/president").reason, "INVALID_ROUTE");
  assert.equal(parseAppRoute("/").valid, false);
});

test("room home paths encode the room identity", () => {
  assert.equal(roomBasePath("A"), "/rooms/A");
  assert.equal(roomBasePath("final-2"), "/rooms/final-2");
});
