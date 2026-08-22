export const DEFAULT_ROOM_ID = "default";

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function validJudgeId(value) {
  const judgeId = Number(value);
  return Number.isInteger(judgeId) && judgeId >= 1 && judgeId <= 5
    ? judgeId
    : null;
}

export function roomBasePath(roomId) {
  return `/room/${encodeURIComponent(roomId)}`;
}

export function parseAppRoute(pathname = "/") {
  const segments = String(pathname).split("/").filter(Boolean);

  if (segments[0] === "room" && ROOM_ID_PATTERN.test(segments[1] || "")) {
    const roomId = segments[1];
    if (segments.length === 2) return { roomId, role: "home", judgeId: null };
    if (segments.length === 3 && (segments[2] === "president" || segments[2] === "public")) {
      return { roomId, role: segments[2], judgeId: null };
    }
    if (segments.length === 4 && segments[2] === "judge") {
      const judgeId = validJudgeId(segments[3]);
      if (judgeId) return { roomId, role: "judge", judgeId };
    }
    return { roomId, role: "home", judgeId: null };
  }

  if (segments.length === 1 && (segments[0] === "president" || segments[0] === "public")) {
    return { roomId: DEFAULT_ROOM_ID, role: segments[0], judgeId: null };
  }
  if (segments.length === 2 && segments[0] === "judge") {
    const judgeId = validJudgeId(segments[1]);
    if (judgeId) return { roomId: DEFAULT_ROOM_ID, role: "judge", judgeId };
  }

  return { roomId: DEFAULT_ROOM_ID, role: "home", judgeId: null };
}
