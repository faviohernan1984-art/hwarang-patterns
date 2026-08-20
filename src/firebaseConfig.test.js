import test from "node:test";
import assert from "node:assert/strict";
import { RUNTIME_ENVIRONMENTS } from "./domain/runtimeContext.js";
import { PRODUCTION_FIREBASE_PROJECT_ID, resolveFirebaseEnvironment } from "./firebaseConfig.js";

const variables = (overrides = {}) => ({
  VITE_APP_ENV: RUNTIME_ENVIRONMENTS.DEVELOPMENT,
  VITE_FIREBASE_API_KEY: "test-api-key",
  VITE_FIREBASE_AUTH_DOMAIN: "demo-hwarang-scoring.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "demo-hwarang-scoring",
  VITE_FIREBASE_STORAGE_BUCKET: "demo-hwarang-scoring.firebasestorage.app",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "123456789",
  VITE_FIREBASE_APP_ID: "1:123456789:web:test",
  VITE_FIREBASE_USE_EMULATOR: "true",
  VITE_FIREBASE_EMULATOR_HOST: "127.0.0.1",
  VITE_FIRESTORE_EMULATOR_PORT: "8080",
  VITE_AUTH_EMULATOR_PORT: "9099",
  ...overrides,
});

test("development resolves explicitly against a demo Emulator project", () => {
  const result = resolveFirebaseEnvironment(variables());
  assert.equal(result.environment, RUNTIME_ENVIRONMENTS.DEVELOPMENT);
  assert.equal(result.firebaseConfig.projectId, "demo-hwarang-scoring");
  assert.deepEqual(result.emulator, { host: "127.0.0.1", firestorePort: 8080, authPort: 9099 });
});

test("training resolves against a separate non-production project", () => {
  const result = resolveFirebaseEnvironment(variables({
    VITE_APP_ENV: RUNTIME_ENVIRONMENTS.TRAINING,
    VITE_FIREBASE_PROJECT_ID: "hwarang-scoring-training",
    VITE_FIREBASE_USE_EMULATOR: "false",
  }));
  assert.equal(result.environment, RUNTIME_ENVIRONMENTS.TRAINING);
  assert.equal(result.useEmulator, false);
});

test("tournament production requires an explicit production opt-in", () => {
  const result = resolveFirebaseEnvironment(variables({
    VITE_APP_ENV: RUNTIME_ENVIRONMENTS.TOURNAMENT,
    VITE_FIREBASE_PROJECT_ID: PRODUCTION_FIREBASE_PROJECT_ID,
    VITE_FIREBASE_USE_EMULATOR: "false",
    VITE_FIREBASE_ALLOW_PRODUCTION: "true",
  }));
  assert.equal(result.environment, RUNTIME_ENVIRONMENTS.TOURNAMENT);
  assert.equal(result.firebaseConfig.projectId, PRODUCTION_FIREBASE_PROJECT_ID);
});

test("invalid environment is rejected", () => {
  assert.throws(() => resolveFirebaseEnvironment(variables({ VITE_APP_ENV: "qa" })), /Unsupported VITE_APP_ENV/);
});

test("every mandatory Firebase variable is required", () => {
  for (const name of [
    "VITE_FIREBASE_API_KEY",
    "VITE_FIREBASE_AUTH_DOMAIN",
    "VITE_FIREBASE_PROJECT_ID",
    "VITE_FIREBASE_STORAGE_BUCKET",
    "VITE_FIREBASE_MESSAGING_SENDER_ID",
    "VITE_FIREBASE_APP_ID",
  ]) {
    assert.throws(() => resolveFirebaseEnvironment(variables({ [name]: "" })), new RegExp(name));
  }
});

test("development and training cannot target hwarang-scoring", () => {
  for (const environment of [RUNTIME_ENVIRONMENTS.DEVELOPMENT, RUNTIME_ENVIRONMENTS.TRAINING]) {
    assert.throws(() => resolveFirebaseEnvironment(variables({
      VITE_APP_ENV: environment,
      VITE_FIREBASE_PROJECT_ID: PRODUCTION_FIREBASE_PROJECT_ID,
      VITE_FIREBASE_USE_EMULATOR: "false",
      VITE_FIREBASE_ALLOW_PRODUCTION: "true",
    })), /cannot use production project/);
  }
});

test("tournament cannot enable Emulator", () => {
  assert.throws(() => resolveFirebaseEnvironment(variables({
    VITE_APP_ENV: RUNTIME_ENVIRONMENTS.TOURNAMENT,
    VITE_FIREBASE_PROJECT_ID: "hwarang-scoring-staging",
  })), /Emulator is not allowed/);
});

test("Emulator is limited to development, loopback and a demo project", () => {
  assert.doesNotThrow(() => resolveFirebaseEnvironment(variables()));
  assert.throws(() => resolveFirebaseEnvironment(variables({
    VITE_FIREBASE_PROJECT_ID: "hwarang-scoring-development",
  })), /demo-\*/);
  assert.throws(() => resolveFirebaseEnvironment(variables({
    VITE_FIREBASE_EMULATOR_HOST: "192.168.1.10",
  })), /localhost or 127\.0\.0\.1/);
});

test("ambiguous production flags and malformed Emulator settings are rejected", () => {
  assert.throws(() => resolveFirebaseEnvironment(variables({
    VITE_FIREBASE_USE_EMULATOR: "false",
    VITE_FIREBASE_ALLOW_PRODUCTION: "true",
  })), /ambiguous/);
  assert.throws(() => resolveFirebaseEnvironment(variables({
    VITE_FIRESTORE_EMULATOR_PORT: "0",
  })), /valid TCP port/);
  assert.throws(() => resolveFirebaseEnvironment(variables({
    VITE_FIREBASE_USE_EMULATOR: "sometimes",
  })), /must be "true" or "false"/);
});

test("Firebase environments reuse the exact Stage 1 environment values", () => {
  for (const environment of Object.values(RUNTIME_ENVIRONMENTS)) {
    const useEmulator = environment === RUNTIME_ENVIRONMENTS.DEVELOPMENT;
    const result = resolveFirebaseEnvironment(variables({
      VITE_APP_ENV: environment,
      VITE_FIREBASE_PROJECT_ID: useEmulator ? "demo-hwarang-scoring" : `hwarang-scoring-${environment}`,
      VITE_FIREBASE_USE_EMULATOR: String(useEmulator),
    }));
    assert.equal(result.environment, environment);
  }
});
