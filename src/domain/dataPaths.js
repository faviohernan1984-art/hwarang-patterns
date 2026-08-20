import { isValidDocumentId, isValidEvaluationId } from "./runtimeContext.js";

function requireDocumentId(name, value) {
  if (!isValidDocumentId(value)) {
    throw new TypeError(`${name} must be a non-empty Firestore document ID`);
  }
  return value;
}

function requireEvaluationId(value) {
  if (!isValidEvaluationId(value)) {
    throw new TypeError("evaluationId must be a positive safe integer");
  }
  return String(value);
}

export const tournamentPath = (tournamentId) =>
  `tournaments/${requireDocumentId("tournamentId", tournamentId)}`;

export const arenaPath = (arenaId) =>
  `arenas/${requireDocumentId("arenaId", arenaId)}`;

export const arenaJudgeSlotPath = (arenaId, slotId) =>
  `${arenaPath(arenaId)}/judgeSlots/${requireDocumentId("slotId", slotId)}`;

export const arenaPrivateControlPath = (arenaId) =>
  `${arenaPath(arenaId)}/private/control`;

export const arenaPublicStatePath = (arenaId) =>
  `${arenaPath(arenaId)}/public/state`;

export const arenaClockStatePath = (arenaId) =>
  `${arenaPath(arenaId)}/clock/state`;

export const arenaMetricsPath = (arenaId) =>
  `${arenaPath(arenaId)}/metrics/current`;

export const matchPath = (matchId) =>
  `matches/${requireDocumentId("matchId", matchId)}`;

export const evaluationPath = (matchId, evaluationId) =>
  `${matchPath(matchId)}/evaluations/${requireEvaluationId(evaluationId)}`;

export const evaluationSubmissionPath = (matchId, evaluationId, judgeSlotId) =>
  `${evaluationPath(matchId, evaluationId)}/submissions/${requireDocumentId("judgeSlotId", judgeSlotId)}`;

export function runtimePaths(context) {
  return Object.freeze({
    tournament: tournamentPath(context.tournamentId),
    arena: arenaPath(context.arenaId),
    match: matchPath(context.matchId),
    evaluation: evaluationPath(context.matchId, context.evaluationId),
    publicState: arenaPublicStatePath(context.arenaId),
    clockState: arenaClockStatePath(context.arenaId),
  });
}
