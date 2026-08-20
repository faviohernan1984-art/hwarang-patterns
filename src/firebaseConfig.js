import { RUNTIME_ENVIRONMENTS } from "./domain/runtimeContext.js";

export const PRODUCTION_FIREBASE_PROJECT_ID = "hwarang-scoring";

const REQUIRED_FIREBASE_VARIABLES = Object.freeze([
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
]);

const ALLOWED_ENVIRONMENTS = new Set(Object.values(RUNTIME_ENVIRONMENTS));

function requiredValue(source, name) {
  const value = source[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`[Firebase config] Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function parseBoolean(source, name, fallback = false) {
  const value = source[name];
  if (value === undefined || value === "") return fallback;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error(`[Firebase config] ${name} must be "true" or "false"`);
}

function parsePort(source, name) {
  const raw = requiredValue(source, name);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`[Firebase config] ${name} must be a valid TCP port`);
  }
  return port;
}

function requireLoopbackHost(source) {
  const host = requiredValue(source, "VITE_FIREBASE_EMULATOR_HOST");
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("[Firebase config] Emulator host must be localhost or 127.0.0.1");
  }
  return host;
}

export function resolveFirebaseEnvironment(source) {
  const environment = requiredValue(source, "VITE_APP_ENV");
  if (!ALLOWED_ENVIRONMENTS.has(environment)) {
    throw new Error(`[Firebase config] Unsupported VITE_APP_ENV: ${environment}`);
  }

  const firebaseConfig = Object.fromEntries(
    REQUIRED_FIREBASE_VARIABLES.map((name) => [name, requiredValue(source, name)]),
  );
  const projectId = firebaseConfig.VITE_FIREBASE_PROJECT_ID;
  const useEmulator = parseBoolean(source, "VITE_FIREBASE_USE_EMULATOR");
  const allowProduction = parseBoolean(source, "VITE_FIREBASE_ALLOW_PRODUCTION");
  const isProductionProject = projectId === PRODUCTION_FIREBASE_PROJECT_ID;

  if (isProductionProject && environment !== RUNTIME_ENVIRONMENTS.TOURNAMENT) {
    throw new Error(`[Firebase config] ${environment} cannot use production project ${projectId}`);
  }
  if (isProductionProject && !allowProduction) {
    throw new Error("[Firebase config] Production requires VITE_FIREBASE_ALLOW_PRODUCTION=true");
  }
  if (allowProduction && !isProductionProject) {
    throw new Error("[Firebase config] Production opt-in is ambiguous for a non-production project");
  }
  if (useEmulator && environment !== RUNTIME_ENVIRONMENTS.DEVELOPMENT) {
    throw new Error(`[Firebase config] Emulator is not allowed in ${environment}`);
  }
  if (useEmulator && isProductionProject) {
    throw new Error("[Firebase config] Emulator cannot use the production project ID");
  }
  if (useEmulator && !projectId.startsWith("demo-")) {
    throw new Error("[Firebase config] Emulator requires a demo-* project ID");
  }

  const emulator = useEmulator
    ? Object.freeze({
        host: requireLoopbackHost(source),
        firestorePort: parsePort(source, "VITE_FIRESTORE_EMULATOR_PORT"),
        authPort: parsePort(source, "VITE_AUTH_EMULATOR_PORT"),
      })
    : null;

  return Object.freeze({
    environment,
    useEmulator,
    emulator,
    firebaseConfig: Object.freeze({
      apiKey: firebaseConfig.VITE_FIREBASE_API_KEY,
      authDomain: firebaseConfig.VITE_FIREBASE_AUTH_DOMAIN,
      projectId,
      storageBucket: firebaseConfig.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: firebaseConfig.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: firebaseConfig.VITE_FIREBASE_APP_ID,
    }),
  });
}
