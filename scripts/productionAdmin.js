/* global process */
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, initializeApp, getApps, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

export const PRODUCTION_PROJECT_ID = 'hwarang-patterns-production';
const repositoryRoot = realpathSync(fileURLToPath(new URL('..', import.meta.url)));

export function validateProductionEnvironment(projectId, apply, env = {}) {
  if (projectId !== PRODUCTION_PROJECT_ID) throw new Error('PRODUCTION_PROJECT_NOT_APPROVED');
  if (apply !== true || env.PATTERNS_ADMIN_ENV !== 'production') throw new Error('EXPLICIT_PRODUCTION_INTENT_REQUIRED');
  for (const key of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST', 'PATTERNS_DEV_PRESIDENT', 'FIREBASE_CONFIG']) {
    if (env[key] !== undefined) throw new Error('MIXED_ADMIN_ENVIRONMENT');
  }
  for (const key of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FIREBASE_PROJECT_ID']) {
    if (env[key] !== undefined && env[key] !== projectId) throw new Error('CONFLICTING_ADMIN_PROJECT');
  }
  const path = env.GOOGLE_APPLICATION_CREDENTIALS;
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('EXTERNAL_SERVICE_ACCOUNT_REQUIRED');
  const location = relative(repositoryRoot, resolve(path));
  if (!isAbsolute(location) && location !== '..' && !location.startsWith('..' + sep)) throw new Error('CREDENTIALS_INSIDE_REPOSITORY');
  return { projectId, credentialPath: path };
}

export function readProductionServiceAccount(path) {
  let account;
  try {
    const actual = realpathSync(path);
    const location = relative(repositoryRoot, actual);
    if (!isAbsolute(location) && location !== '..' && !location.startsWith('..' + sep)) throw new Error('CREDENTIALS_INSIDE_REPOSITORY');
    account = JSON.parse(readFileSync(actual, 'utf8'));
  } catch {
    // Never expose JSON parse errors, file contents or credential paths.
    throw new Error('INVALID_EXTERNAL_SERVICE_ACCOUNT');
  }
  if (account?.type !== 'service_account' || account.project_id !== PRODUCTION_PROJECT_ID
      || typeof account.client_email !== 'string' || !account.client_email.endsWith('@' + PRODUCTION_PROJECT_ID + '.iam.gserviceaccount.com')
      || typeof account.private_key !== 'string' || !account.private_key.length) throw new Error('SERVICE_ACCOUNT_PROJECT_MISMATCH');
  // Pass only necessary fields; custom token endpoints in a file are not honored.
  return { projectId: account.project_id, clientEmail: account.client_email, privateKey: account.private_key };
}

export function productionAdmin(projectId, apply) {
  const settings = validateProductionEnvironment(projectId, apply, process.env);
  const account = readProductionServiceAccount(settings.credentialPath);
  let credential;
  try { credential = cert(account); } catch { throw new Error('INVALID_SERVICE_ACCOUNT_KEY'); }
  const name = 'patterns-admin-production';
  if (getApps().some(app => app.name === name)) throw new Error('PRODUCTION_ADMIN_ALREADY_INITIALIZED');
  // No ADC/metadata/CLI credential fallback; both services use the explicit project.
  const app = initializeApp({ projectId: settings.projectId, credential }, name);
  try { return { app, auth: getAuth(app), db: getFirestore(app) }; }
  catch (error) { void deleteApp(app); throw error; }
}
