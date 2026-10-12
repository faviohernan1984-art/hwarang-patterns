/* global process */
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { validateAdminEnvironment } from './localAdmin.js';

const ROOM = /^demo-patterns-[a-f0-9]{24}$/;
const KEY = /^(president|public|judge\/[1-5])$/;
const SECRET = /^[a-f0-9]{64}$/;
const validVersion = value => Number.isSafeInteger(value) && value >= 1;
const digest = value => createHash('sha256').update(value).digest('hex');
export const authorizationDenied = () => Object.assign(new Error('DEMO_AUTHORIZATION_DENIED'), { code: 'DEMO_AUTHORIZATION_DENIED' });

function refFor(db, roomId, env) {
  if (db.projectId !== validateAdminEnvironment(env)) throw new Error('UNVERIFIED_LOCAL_DATABASE');
  if (!ROOM.test(roomId)) throw authorizationDenied();
  return db.doc('localDemoAuthorization/' + roomId);
}

// Called only for a newly allocated room. Existing records are never replaced.
export async function createLocalDemoAuthorization(db, roomId, keys, { env = process.env } = {}) {
  const ref = refFor(db, roomId, env);
  if (!Array.isArray(keys) || !keys.includes('president') || keys.some(key => !KEY.test(key)) || new Set(keys).size !== keys.length) throw authorizationDenied();
  const credentials = Object.fromEntries(keys.map(key => [key, randomBytes(32).toString('hex')]));
  await db.runTransaction(async tx => {
    if ((await tx.get(ref)).exists) throw authorizationDenied();
    tx.create(ref, { version: 1, roomAccessVersion: 1, roles: Object.fromEntries(keys.map(key => [key, { hash: digest(credentials[key]), active: true, accessVersion: 1 }])) });
  });
  return credentials;
}

export async function authorizeLocalDemo(db, roomId, key, credential, { env = process.env } = {}) {
  const ref = refFor(db, roomId, env);
  if (!KEY.test(key) || typeof credential !== 'string' || !SECRET.test(credential)) throw authorizationDenied();
  const snapshot = await ref.get();
  const data = snapshot.exists ? snapshot.data() : null;
  const grant = data?.version === 1 ? data.roles?.[key] : null;
  if (!validVersion(data?.roomAccessVersion) || !validVersion(grant?.accessVersion) || grant?.active !== true || typeof grant.hash !== 'string' || !SECRET.test(grant.hash)
    || !timingSafeEqual(Buffer.from(grant.hash, 'hex'), Buffer.from(digest(credential), 'hex'))) throw authorizationDenied();
  return { roomAccessVersion: data.roomAccessVersion, accessVersion: grant.accessVersion };
}

export function demoCredential(req) {
  const value = req.headers.authorization;
  return typeof value === 'string' ? /^Bearer ([a-f0-9]{64})$/.exec(value)?.[1] : undefined;
}

function validateRecord(data, allowMissingVersions = false) {
  if (!data || data.version !== 1 || !data.roles || typeof data.roles !== 'object'
    || Array.isArray(data.roles) || !Object.hasOwn(data.roles, 'president')
    || !((allowMissingVersions && !Object.hasOwn(data, 'roomAccessVersion')) || validVersion(data.roomAccessVersion))) throw authorizationDenied();
  for (const [key, grant] of Object.entries(data.roles)) {
    if (!KEY.test(key) || !grant || typeof grant !== 'object' || Array.isArray(grant)
      || typeof grant.hash !== 'string' || !SECRET.test(grant.hash) || typeof grant.active !== 'boolean'
      || !((allowMissingVersions && !Object.hasOwn(grant, 'accessVersion')) || validVersion(grant.accessVersion))) throw authorizationDenied();
  }
}

// Explicit migration: never reset existing versions or replace credentials.
export async function initializeLocalDemoAuthorizationVersions(db, roomId, { env = process.env } = {}) {
  const ref = refFor(db, roomId, env);
  return db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    const data = snapshot.exists ? snapshot.data() : null;
    validateRecord(data, true);
    let changed = !Object.hasOwn(data, 'roomAccessVersion');
    const roles = Object.fromEntries(Object.entries(data.roles).map(([key, grant]) => {
      if (Object.hasOwn(grant, 'accessVersion')) return [key, grant];
      changed = true;
      return [key, { ...grant, accessVersion: 1 }];
    }));
    const roomAccessVersion = data.roomAccessVersion ?? 1;
    if (changed) tx.update(ref, { roomAccessVersion, roles });
    return { roomAccessVersion };
  });
}

// Admin-only primitive: null revokes the room; a key revokes one role.
export async function revokeLocalDemoAuthorization(db, roomId, key = null, { env = process.env } = {}) {
  const ref = refFor(db, roomId, env);
  if (key !== null && (typeof key !== 'string' || !KEY.test(key))) throw authorizationDenied();
  return db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    const data = snapshot.exists ? snapshot.data() : null;
    validateRecord(data);
    if (key !== null && !Object.hasOwn(data.roles, key)) throw authorizationDenied();
    const current = key === null ? data.roomAccessVersion : data.roles[key].accessVersion;
    if (current === Number.MAX_SAFE_INTEGER) throw authorizationDenied();
    const roles = { ...data.roles };
    if (key === null) {
      for (const [role, grant] of Object.entries(roles)) roles[role] = { ...grant, active: false };
      tx.update(ref, { roomAccessVersion: current + 1, roles });
      return { roomAccessVersion: current + 1 };
    }
    roles[key] = { ...roles[key], active: false, accessVersion: current + 1 };
    tx.update(ref, { roles });
    return { roomAccessVersion: data.roomAccessVersion, accessVersion: current + 1 };
  });
}
