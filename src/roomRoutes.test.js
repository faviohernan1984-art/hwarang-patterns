import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ROOM_ID, parseAppRoute, roomBasePath } from "./roomRoutes.js";

test("room routes expose room, role and judge identity", () => {
  assert.deepEqual(parseAppRoute("/room/A/president"), { roomId: "A", role: "president", judgeId: null });
  assert.deepEqual(parseAppRoute("/room/B/public"), { roomId: "B", role: "public", judgeId: null });
  assert.deepEqual(parseAppRoute("/room/final-2/judge/5"), { roomId: "final-2", role: "judge", judgeId: 5 });
  assert.deepEqual(parseAppRoute("/room/A"), { roomId: "A", role: "home", judgeId: null });
});

test("legacy routes use an isolated default room", () => {
  assert.deepEqual(parseAppRoute("/president"), { roomId: DEFAULT_ROOM_ID, role: "president", judgeId: null });
  assert.deepEqual(parseAppRoute("/public"), { roomId: DEFAULT_ROOM_ID, role: "public", judgeId: null });
  assert.deepEqual(parseAppRoute("/judge/1"), { roomId: DEFAULT_ROOM_ID, role: "judge", judgeId: 1 });
});

test("invalid room roles and judge ids do not open a scoring screen", () => {
  assert.deepEqual(parseAppRoute("/room/A/judge/6"), { roomId: "A", role: "home", judgeId: null });
  assert.deepEqual(parseAppRoute("/room/A/unknown"), { roomId: "A", role: "home", judgeId: null });
  assert.deepEqual(parseAppRoute("/room/invalid.room/public"), { roomId: DEFAULT_ROOM_ID, role: "home", judgeId: null });
});

test("room home paths encode the room identity", () => {
  assert.equal(roomBasePath("A"), "/room/A");
  assert.equal(roomBasePath("final-2"), "/room/final-2");
});
