/* global process */
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { validateAdminEnvironment } from './localAdmin.js';

const ROOM = /^demo-patterns-[a-f0-9]{24}$/;
const KEY = /^(president|public|judge\/[1-5])$/;
const SECRET = /^[a-f0-9]{64}$/;
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
  if (!keys.includes('president') || keys.some(key => !KEY.test(key)) || new Set(keys).size !== keys.length) throw authorizationDenied();
  const credentials = Object.fromEntries(keys.map(key => [key, randomBytes(32).toString('hex')]));
  await db.runTransaction(async tx => {
    if ((await tx.get(ref)).exists) throw authorizationDenied();
    tx.create(ref, { version: 1, roles: Object.fromEntries(keys.map(key => [key, { hash: digest(credentials[key]), active: true }])) });
  });
  return credentials;
}

export async function authorizeLocalDemo(db, roomId, key, credential, { env = process.env } = {}) {
  const ref = refFor(db, roomId, env);
  if (!KEY.test(key) || typeof credential !== 'string' || !SECRET.test(credential)) throw authorizationDenied();
  const snapshot = await ref.get();
  const data = snapshot.exists ? snapshot.data() : null;
  const grant = data?.version === 1 ? data.roles?.[key] : null;
  if (!grant?.active || typeof grant.hash !== 'string' || !SECRET.test(grant.hash)
    || !timingSafeEqual(Buffer.from(grant.hash, 'hex'), Buffer.from(digest(credential), 'hex'))) throw authorizationDenied();
}

export function demoCredential(req) {
  const value = req.headers.authorization;
  return typeof value === 'string' ? /^Bearer ([a-f0-9]{64})$/.exec(value)?.[1] : undefined;
}
