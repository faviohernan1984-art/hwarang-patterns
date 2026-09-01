const VALID_ROLES = new Set(["president", "public", "judge"]);

export function identityFromClaims(user, claims = {}) {
  if (!user || typeof claims.roomId !== "string" || !VALID_ROLES.has(claims.role)) return null;
  const judgeId = claims.role === "judge" ? Number(claims.judgeId) : null;
  if (claims.role === "judge" && (!Number.isInteger(judgeId) || judgeId < 1 || judgeId > 5)) return null;
  return { uid: user.uid, roomId: claims.roomId, role: claims.role, judgeId };
}

export function authorizeRoomRoute(identity, route) {
  if (!route?.valid) return { allowed: false, reason: route?.reason || "INVALID_ROUTE" };
  if (!identity) return { allowed: false, reason: "AUTH_REQUIRED" };
  if (identity.roomId !== route.roomId) return { allowed: false, reason: "ROOM_FORBIDDEN" };
  if (route.role === "home") return { allowed: true, reason: null };
  if (identity.role !== route.role) return { allowed: false, reason: "ROLE_FORBIDDEN" };
  if (route.role === "judge" && identity.judgeId !== route.judgeId) {
    return { allowed: false, reason: "JUDGE_FORBIDDEN" };
  }
  return { allowed: true, reason: null };
}
