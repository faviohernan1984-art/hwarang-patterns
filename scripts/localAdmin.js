/* global process */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { LOCAL_PROJECT_ID } from '../src/firebaseConfig.js';

export const PRESIDENT_UID = 'dev-president-room-A';
export const PRESIDENT_CLAIMS = Object.freeze({ roomId: 'A', role: 'president' });
export function validateAdminEnvironment(env) {
  if (env.PATTERNS_DEV_PRESIDENT !== 'true') throw new Error('PATTERNS_DEV_PRESIDENT=true is required');
  if (env.GCLOUD_PROJECT !== LOCAL_PROJECT_ID) throw new Error('Only demo-patterns-gups is allowed');
  for (const name of ['GOOGLE_CLOUD_PROJECT', 'FIREBASE_PROJECT_ID']) {
    if (env[name] && env[name] !== LOCAL_PROJECT_ID) throw new Error('Conflicting project: ' + name);
  }
  if (env.GOOGLE_APPLICATION_CREDENTIALS || env.FIREBASE_CONFIG) throw new Error('Cloud credentials/config are forbidden');
  for (const name of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST']) {
    const value = env[name];
    const match = typeof value === 'string' && /^(127\.0\.0\.1|localhost):([1-9][0-9]{0,4})$/.exec(value);
    if (!match || Number(match[2]) > 65535) throw new Error('Explicit loopback emulator endpoint required: ' + name);
  }
  if (env.FIREBASE_AUTH_EMULATOR_HOST.split(':')[1] === env.FIRESTORE_EMULATOR_HOST.split(':')[1]) throw new Error('Emulator ports must differ');
  return LOCAL_PROJECT_ID;
}

export function localAdmin() {
  const projectId = validateAdminEnvironment(process.env);
  // Prevent cloud metadata discovery in this emulator-only process.
  process.env.METADATA_SERVER_DETECTION = 'none';
  const name = 'patterns-admin-local';
  const existing = getApps().find(app => app.name === name);
  if (existing && existing.options.projectId !== projectId) throw new Error('Unverified Admin project');
  // Both emulator endpoints and demo project are validated before SDK initialization.
  // No service account is supplied; emulators require no cloud credentials.
  const app = existing ?? initializeApp({ projectId }, name);
  return { app, auth: getAuth(app), db: getFirestore(app) };
}

export async function presidentToken() {
  const { auth, db } = localAdmin();
  const user = await auth.getUser(PRESIDENT_UID);
  if (user.disabled || user.customClaims?.roomId !== 'A' || user.customClaims?.role !== 'president' || Object.keys(user.customClaims).length !== 2) throw new Error('Provision the DEV President first');
  const refs = ['control', 'meta', 'publicState'].map(name => db.doc('rooms/A/' + name + '/current'));
  const docs = await db.getAll(...refs);
  if (docs.some(doc => !doc.exists)) throw new Error('Provision Room A first');
  return auth.createCustomToken(PRESIDENT_UID);
}
