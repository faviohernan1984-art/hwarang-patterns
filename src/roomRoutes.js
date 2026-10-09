const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function validJudgeId(value) {
  const judgeId = Number(value);
  return Number.isInteger(judgeId) && judgeId >= 1 && judgeId <= 5
    ? judgeId
    : null;
}

export function isDemoRoomId(roomId) {
  return typeof roomId === 'string' && /^demo-patterns-[a-f0-9]{24}$/.test(roomId);
}

export function roomRolePath(roomId, role, judgeId = null) {
  if (!ROOM_ID_PATTERN.test(roomId) || !['president', 'public', 'judge'].includes(role)) throw new Error('INVALID_ACCESS_ROUTE');
  if (role === 'judge' && !validJudgeId(judgeId)) throw new Error('INVALID_JUDGE_ID');
  return '/' + role + '/' + encodeURIComponent(roomId) + (role === 'judge' ? '/' + judgeId : '');
}

export function roomAccessLinks(roomId, judgeCount) {
  if (![3, 5].includes(judgeCount)) throw new Error('INVALID_JUDGE_COUNT');
  return ['president', 'public', ...Array.from({ length: judgeCount }, (_, i) => 'judge/' + (i + 1))].map(key => {
    const [role, id] = key.split('/');
    const judgeId = role === 'judge' ? Number(id) : null;
    return { key, role, judgeId, path: roomRolePath(roomId, role, judgeId) };
  });
}

export function roomBasePath(roomId) {
  return isDemoRoomId(roomId) ? `/${roomId}` : `/rooms/${encodeURIComponent(roomId)}`;
}

export function parseAppRoute(pathname = "/") {
  const segments = String(pathname).split("/").filter(Boolean);
  const roomPrefix = segments[0];
  if (segments.length === 1 && isDemoRoomId(segments[0])) return { valid: true, roomId: segments[0], role: 'home', judgeId: null };
  if (['president', 'public', 'judge'].includes(roomPrefix) && segments.length >= 2) {
    const roomId = segments[1];
    if (!ROOM_ID_PATTERN.test(roomId)) return { valid: false, roomId: null, role: null, judgeId: null, reason: 'INVALID_ROOM_ID' };
    if (roomPrefix !== 'judge' && segments.length === 2) return { valid: true, roomId, role: roomPrefix, judgeId: null };
    if (roomPrefix === 'judge' && segments.length === 3) {
      const judgeId = /^[1-5]$/.test(segments[2]) ? validJudgeId(segments[2]) : null;
      if (judgeId) return { valid: true, roomId, role: 'judge', judgeId };
      return { valid: false, roomId, role: null, judgeId: null, reason: 'INVALID_JUDGE_ID' };
    }
    return { valid: false, roomId, role: null, judgeId: null, reason: 'INVALID_ROOM_ROUTE' };
  }

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
