export const RUNTIME_ENVIRONMENTS = Object.freeze({
  DEVELOPMENT: "development",
  TRAINING: "training",
  TOURNAMENT: "tournament",
});

export const HSU_PRODUCTS = Object.freeze({
  PATTERNS_GUP_PRO: "patterns-gup-pro",
  COMBAT_PRO: "combat-pro",
});

const ENVIRONMENT_VALUES = new Set(Object.values(RUNTIME_ENVIRONMENTS));
const PRODUCT_VALUES = new Set(Object.values(HSU_PRODUCTS));

export function isValidDocumentId(value) {
  return typeof value === "string"
    && value.trim() === value
    && value.length > 0
    && !value.includes("/");
}

export function isValidEvaluationId(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

function requireDocumentId(name, value) {
  if (!isValidDocumentId(value)) {
    throw new TypeError(`${name} must be a non-empty Firestore document ID`);
  }
}

export function createRuntimeContext({
  environment,
  product,
  tournamentId,
  arenaId,
  matchId,
  evaluationId,
}) {
  if (!ENVIRONMENT_VALUES.has(environment)) {
    throw new TypeError("environment is not supported");
  }
  if (!PRODUCT_VALUES.has(product)) {
    throw new TypeError("product is not supported");
  }

  requireDocumentId("tournamentId", tournamentId);
  requireDocumentId("arenaId", arenaId);
  requireDocumentId("matchId", matchId);

  if (!isValidEvaluationId(evaluationId)) {
    throw new TypeError("evaluationId must be a positive safe integer");
  }

  return Object.freeze({
    environment,
    product,
    tournamentId,
    arenaId,
    matchId,
    evaluationId,
  });
}

export function isSameArena(left, right) {
  return Boolean(left && right)
    && left.environment === right.environment
    && left.product === right.product
    && left.tournamentId === right.tournamentId
    && left.arenaId === right.arenaId;
}

export function isSameMatch(left, right) {
  return isSameArena(left, right) && left.matchId === right.matchId;
}

export function isSameEvaluation(left, right) {
  return isSameMatch(left, right) && left.evaluationId === right.evaluationId;
}
