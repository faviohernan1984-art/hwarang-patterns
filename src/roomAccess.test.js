import test from "node:test";
import assert from "node:assert/strict";
import { authorizeRoomRoute, identityFromClaims } from "./roomAccess.js";

const route = (role, judgeId = null, roomId = "A") => ({ valid: true, roomId, role, judgeId });

test("claims define room and role authority independently from the URL", () => {
  const president = identityFromClaims({ uid: "president-a" }, { roomId: "A", role: "president" });
  assert.equal(authorizeRoomRoute(president, route("president")).allowed, true);
  assert.equal(authorizeRoomRoute(president, route("president", null, "B")).reason, "ROOM_FORBIDDEN");
  assert.equal(authorizeRoomRoute(president, route("judge", 1)).reason, "ROLE_FORBIDDEN");
});

test("Judge identity is restricted to its assigned Judge number", () => {
  const judge2 = identityFromClaims({ uid: "judge-a-2" }, { roomId: "A", role: "judge", judgeId: 2 });
  assert.equal(authorizeRoomRoute(judge2, route("judge", 2)).allowed, true);
  assert.equal(authorizeRoomRoute(judge2, route("judge", 3)).reason, "JUDGE_FORBIDDEN");
});

test("anonymous and malformed identities fail closed", () => {
  assert.equal(authorizeRoomRoute(null, route("public")).reason, "AUTH_REQUIRED");
  assert.equal(identityFromClaims({ uid: "bad" }, { roomId: "A", role: "judge", judgeId: 9 }), null);
  assert.equal(authorizeRoomRoute(null, { valid: false, reason: "INVALID_ROUTE" }).reason, "INVALID_ROUTE");
});
