import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ROOM_ID, parseAppRoute, roomBasePath } from "./roomRoutes.js";

test("canonical rooms routes expose room, role and judge identity", () => {
  assert.deepEqual(parseAppRoute("/rooms/A/president"), { roomId: "A", role: "president", judgeId: null });
  assert.deepEqual(parseAppRoute("/rooms/B/public"), { roomId: "B", role: "public", judgeId: null });
  assert.deepEqual(parseAppRoute("/rooms/final-2/judge/5"), { roomId: "final-2", role: "judge", judgeId: 5 });
  assert.deepEqual(parseAppRoute("/rooms/A"), { roomId: "A", role: "home", judgeId: null });
});

test("singular room routes remain compatible aliases", () => {
  assert.deepEqual(parseAppRoute("/room/A/president"), { roomId: "A", role: "president", judgeId: null });
  assert.deepEqual(parseAppRoute("/room/B/public"), { roomId: "B", role: "public", judgeId: null });
  assert.deepEqual(parseAppRoute("/room/final-2/judge/5"), { roomId: "final-2", role: "judge", judgeId: 5 });
  assert.deepEqual(parseAppRoute("/room/A"), { roomId: "A", role: "home", judgeId: null });
});

test("legacy routes use an isolated default room", () => {
  assert.deepEqual(parseAppRoute("/"), { roomId: DEFAULT_ROOM_ID, role: "home", judgeId: null });
  assert.deepEqual(parseAppRoute("/president"), { roomId: DEFAULT_ROOM_ID, role: "president", judgeId: null });
  assert.deepEqual(parseAppRoute("/public"), { roomId: DEFAULT_ROOM_ID, role: "public", judgeId: null });
  assert.deepEqual(parseAppRoute("/judge/1"), { roomId: DEFAULT_ROOM_ID, role: "judge", judgeId: 1 });
});

test("invalid rooms routes never fall back to default", () => {
  assert.deepEqual(parseAppRoute("/rooms/A/judge/6"), { roomId: "A", role: "invalid", judgeId: null });
  assert.deepEqual(parseAppRoute("/rooms/A/unknown"), { roomId: "A", role: "invalid", judgeId: null });
  assert.deepEqual(parseAppRoute("/rooms/invalid.room/public"), { roomId: null, role: "invalid", judgeId: null });
  assert.deepEqual(parseAppRoute("/room/invalid.room/public"), { roomId: null, role: "invalid", judgeId: null });
  assert.deepEqual(parseAppRoute("/unknown"), { roomId: null, role: "invalid", judgeId: null });
  assert.notEqual(parseAppRoute("/rooms/A/unknown").roomId, DEFAULT_ROOM_ID);
});

test("room home paths encode the room identity", () => {
  assert.equal(roomBasePath("A"), "/rooms/A");
  assert.equal(roomBasePath("final-2"), "/rooms/final-2");
});
