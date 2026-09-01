const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function validJudgeId(value) {
  const judgeId = Number(value);
  return Number.isInteger(judgeId) && judgeId >= 1 && judgeId <= 5
    ? judgeId
    : null;
}

export function roomBasePath(roomId) {
  return `/rooms/${encodeURIComponent(roomId)}`;
}

export function parseAppRoute(pathname = "/") {
  const segments = String(pathname).split("/").filter(Boolean);
  const roomPrefix = segments[0];

  if (roomPrefix === "room" || roomPrefix === "rooms") {
    if (!ROOM_ID_PATTERN.test(segments[1] || "")) {
      return { valid: false, roomId: null, role: null, judgeId: null, reason: "INVALID_ROOM_ID" };
    }
    const roomId = segments[1];
    if (segments.length === 2) return { valid: true, roomId, role: "home", judgeId: null };
    if (segments.length === 3 && (segments[2] === "president" || segments[2] === "public")) {
      return { valid: true, roomId, role: segments[2], judgeId: null };
    }
    if (segments.length === 4 && segments[2] === "judge") {
      const judgeId = validJudgeId(segments[3]);
      if (judgeId) return { valid: true, roomId, role: "judge", judgeId };
      return { valid: false, roomId, role: null, judgeId: null, reason: "INVALID_JUDGE_ID" };
    }
    return { valid: false, roomId, role: null, judgeId: null, reason: "INVALID_ROOM_ROUTE" };
  }

  return { valid: false, roomId: null, role: null, judgeId: null, reason: "INVALID_ROUTE" };
}
