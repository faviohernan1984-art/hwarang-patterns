/* global process */
import { isDeepStrictEqual } from 'node:util';
import { localAdmin, validateAdminEnvironment } from './localAdmin.js';
import { ensureLocalDemoRoom } from './localDemoProvisioning.js';
import { authorizeLocalDemo } from './localDemoAuthorization.js';

const ROOM_ID = /^demo-patterns-[a-f0-9]{24}$/;
const JOURNAL_COLLECTION = 'localDemoIdentityProvisioning';

export function demoIdentities(roomId, judgeCount) {
  if (typeof roomId !== 'string' || !ROOM_ID.test(roomId)) throw new Error('INVALID_DEMO_ROOM_ID');
  if (![3, 5].includes(judgeCount)) throw new Error('INVALID_DEMO_JUDGE_COUNT');
  return Object.fromEntries([
    ['president', { roomId, role: 'president' }],
    ['public', { roomId, role: 'public' }],
    ...Array.from({ length: judgeCount }, (_, index) => ['judge/' + (index + 1), { roomId, role: 'judge', judgeId: index + 1 }]),
  ].map(([key, claims]) => [key, {
    uid: 'dev-' + roomId + '-' + key.replace('/', '-'),
    claims, displayName: 'Patterns local DEMO ' + roomId + ' ' + key,
    path: '/rooms/' + roomId + '/' + key,
    devPath: '/__dev/demo/' + roomId + '/' + key,
  }]));
}

function validateAdmin({ auth, db }, env) {
  const projectId = validateAdminEnvironment(env);
  if (db.projectId !== projectId || auth.app?.options?.projectId !== projectId) throw new Error('UNVERIFIED_LOCAL_ADMIN');
}

function verifyJournal(data, sessionId) {
  if (data && (data.version !== 1 || data.demoSessionId !== sessionId
    || ![3, 5].includes(data.judgeCount) || !['pending', 'complete'].includes(data.status))) {
    throw new Error('DEMO_IDENTITY_JOURNAL_CONFLICT');
  }
}

function roomRefs(db, roomId) {
  return [db.doc('rooms/' + roomId + '/control/current'), db.doc('rooms/' + roomId + '/meta/current'), db.doc(JOURNAL_COLLECTION + '/' + roomId)];
}

async function planFor(admin, roomId, env) {
  validateAdmin(admin, env);
  const room = await ensureLocalDemoRoom(admin.db, roomId, { env });
  if (!room.compatible) throw new Error('DEMO_ROOM_NOT_FOUND_OR_INCOMPATIBLE');
  return admin.db.runTransaction(async tx => {
    const [control, meta, journal] = await tx.getAll(...roomRefs(admin.db, roomId));
    if (!control.exists || !meta.exists || meta.data().demoSessionId !== room.demoSessionId) throw new Error('DEMO_PROVISIONING_CHANGED');
    const judgeCount = control.data().config?.patternJudges;
    const identities = demoIdentities(roomId, judgeCount);
    const previous = journal.exists ? journal.data() : null;
    verifyJournal(previous, room.demoSessionId);
    return { roomId, demoSessionId: room.demoSessionId, judgeCount, identities, previous };
  });
}

async function findUser(auth, uid) {
  try { return await auth.getUser(uid); }
  catch (error) { if (error.code === 'auth/user-not-found') return null; throw error; }
}

function checkUser(user, identity, allowPending = false) {
  if (user.uid !== identity.uid || user.disabled) throw new Error('DEMO_IDENTITY_DISABLED_OR_CONFLICT');
  const claims = user.customClaims ?? {};
  if (isDeepStrictEqual(claims, identity.claims)) return true;
  // Only recover a user created by this local flow, covered by its pending journal.
  if (allowPending && Object.keys(claims).length === 0 && user.displayName === identity.displayName
    && !user.email && !user.phoneNumber && !user.providerData?.length) return false;
  throw new Error('DEMO_IDENTITY_ASSIGNMENT_CONFLICT');
}

async function markPlan(admin, plan, status) {
  await admin.db.runTransaction(async tx => {
    const refs = roomRefs(admin.db, plan.roomId);
    const [control, meta, journal] = await tx.getAll(...refs);
    if (!control.exists || !meta.exists || control.data().config?.patternJudges !== plan.judgeCount
      || meta.data().demoSessionId !== plan.demoSessionId) throw new Error('DEMO_PROVISIONING_CHANGED');
    const existing = journal.exists ? journal.data() : null;
    verifyJournal(existing, plan.demoSessionId);
    if (status === 'complete' && (!existing || existing.judgeCount !== plan.judgeCount)) throw new Error('DEMO_PROVISIONING_CHANGED');
    const data = { version: 1, demoSessionId: plan.demoSessionId, judgeCount: plan.judgeCount, status };
    if (!isDeepStrictEqual(existing, data)) tx.set(refs[2], data);
  });
}

export async function provisionLocalDemoIdentities(admin, roomId, { env = process.env } = {}) {
  const plan = await planFor(admin, roomId, env);
  const recoverable = plan.previous ? demoIdentities(roomId, plan.previous.judgeCount) : {};
  let complete = true;
  // Preflight every existing identity before granting any new claims.
  for (const [key, identity] of Object.entries(plan.identities)) {
    const user = await findUser(admin.auth, identity.uid);
    if (!user) { complete = false; continue; }
    const allowPending = plan.previous?.status === 'pending' && Object.hasOwn(recoverable, key);
    if (!checkUser(user, identity, allowPending)) complete = false;
  }
  if (complete && plan.previous?.status === 'complete' && plan.previous.judgeCount === plan.judgeCount) {
    return { roomId, identities: plan.identities };
  }
  await markPlan(admin, plan, 'pending');
  for (const identity of Object.values(plan.identities)) {
    let user = await findUser(admin.auth, identity.uid);
    if (!user) {
      try { user = await admin.auth.createUser({ uid: identity.uid, displayName: identity.displayName }); }
      catch (error) {
        if (error.code !== 'auth/uid-already-exists') throw error;
        user = await admin.auth.getUser(identity.uid);
      }
    }
    if (!checkUser(user, identity, true)) await admin.auth.setCustomUserClaims(identity.uid, identity.claims);
  }
  for (const identity of Object.values(plan.identities)) checkUser(await admin.auth.getUser(identity.uid), identity);
  await markPlan(admin, plan, 'complete');
  return { roomId, identities: plan.identities };
}

export async function readLocalDemoAccess(admin, roomId, key, { env = process.env } = {}) {
  const plan = await planFor(admin, roomId, env);
  if (!Object.hasOwn(plan.identities, key)) throw new Error('UNSUPPORTED_DEMO_IDENTITY');
  if (plan.previous?.status !== 'complete' || plan.previous.judgeCount !== plan.judgeCount) throw new Error('DEMO_IDENTITIES_NOT_READY');
  const identity = plan.identities[key];
  checkUser(await admin.auth.getUser(identity.uid), identity);
  return identity;
}

export async function issueLocalDemoToken(admin, roomId, key, options) {
  await authorizeLocalDemo(admin.db, roomId, key, options?.credential, options);
  const identity = await readLocalDemoAccess(admin, roomId, key, options);
  return admin.auth.createCustomToken(identity.uid);
}

// Shared DEV server Admin instance; requests never provision or mutate identities.
export const demoAccess = (roomId, key) => readLocalDemoAccess(localAdmin(), roomId, key);
export const demoToken = (roomId, key, credential) => issueLocalDemoToken(localAdmin(), roomId, key, { credential });
