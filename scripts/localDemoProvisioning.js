/* global process */
import { randomBytes } from 'node:crypto';
import { initialRoomDocuments } from './roomDefaults.js';
import { validateAdminEnvironment } from './localAdmin.js';
import { validDemoSessionId, mergeEvaluationIds } from '../src/demoMatchCredits.js';

const ROOM_ID_PATTERN = /^demo-patterns-[a-f0-9]{24}$/;

export function makeLocalDemoRoomId() {
  return 'demo-patterns-' + randomBytes(12).toString('hex');
}

function validateLocalDatabase(db, env) {
  const projectId = validateAdminEnvironment(env);
  if (db.projectId !== projectId) throw new Error('UNVERIFIED_LOCAL_DATABASE');
}

function sessionFor(roomId) {
  // One exclusive ID per room: reusing a room cannot allocate fresh credits.
  return 'patterns-session-' + roomId.slice('demo-patterns-'.length);
}

function compatibleRoom(control, meta, publicState, ledger, sessionId) {
  const ids = ledger?.consumedEvaluationIds;
  return Number.isSafeInteger(control?.evaluationId) && control.evaluationId > 0
    && ['binary', 'points'].includes(control?.config?.scoringMode)
    && [3, 5].includes(control?.config?.patternJudges)
    && typeof meta?.presidentSwapSides === 'boolean'
    && meta?.demoProvisioningVersion === 1
    && validDemoSessionId(meta?.demoSessionId) === sessionId
    && Number.isSafeInteger(publicState?.evaluationId) && publicState.evaluationId > 0
    && ledger?.sessionId === sessionId
    && Array.isArray(ids) && mergeEvaluationIds(ids).length === ids.length
    && Number.isSafeInteger(ledger?.confirmedCount) && ledger.confirmedCount === ids.length;
}

export async function ensureLocalDemoRoom(db, roomId, { allowCreate = false, env = process.env } = {}) {
  validateLocalDatabase(db, env);
  if (typeof roomId !== 'string' || !ROOM_ID_PATTERN.test(roomId)) throw new Error('INVALID_DEMO_ROOM_ID');
  const base = 'rooms/' + roomId;
  const refs = ['control', 'meta', 'publicState'].map(name => db.doc(base + '/' + name + '/current'));
  const sessionId = sessionFor(roomId);
  const ledgerRef = db.doc(base + '/demoSessions/' + sessionId);
  const rootRef = db.doc(base);
  return db.runTransaction(async tx => {
    const [control, meta, publicState, ledger, root] = await tx.getAll(...refs, ledgerRef, rootRef);
    const snapshots = [control, meta, publicState, ledger];
    if (root.exists) return { created: false, compatible: false };
    if (snapshots.some(snapshot => snapshot.exists)) {
      if (!snapshots.every(snapshot => snapshot.exists)
        || !compatibleRoom(...snapshots.map(snapshot => snapshot.data()), sessionId)) {
        return { created: false, compatible: false };
      }
      // No writes on reuse, even after all 25 decisions have been consumed.
      return { created: false, compatible: true, roomId, demoSessionId: sessionId };
    }
    if (!allowCreate) return { created: false, compatible: false };
    // A missing parent document does not imply that its subcollections are empty.
    // Reject orphan ledgers/judge data instead of attaching a fresh demo to them.
    for (const name of ['demoSessions', 'judges', 'submissions']) {
      const existing = await tx.get(db.collection(base + '/' + name).limit(1));
      if (!existing.empty) return { created: false, compatible: false };
    }
    const initial = initialRoomDocuments();
    initial[1] = { ...initial[1], demoSessionId: sessionId, demoProvisioningVersion: 1 };
    initial.forEach((data, index) => tx.create(refs[index], data));
    tx.create(ledgerRef, { sessionId, consumedEvaluationIds: [], confirmedCount: 0 });
    return { created: true, compatible: true, roomId, demoSessionId: sessionId };
  });
}

// Same create/reuse and bounded collision retry circuit as Combat's create-demo.
// An explicit incompatible reuse request fails instead of replacing its session.
export async function allocateLocalDemo(db, requestedRoomId = null, {
  env = process.env, generateRoomId = makeLocalDemoRoomId,
} = {}) {
  validateLocalDatabase(db, env);
  if (requestedRoomId !== null && requestedRoomId !== undefined) {
    const result = await ensureLocalDemoRoom(db, requestedRoomId, { env });
    if (!result.compatible) throw new Error('DEMO_ROOM_NOT_FOUND_OR_INCOMPATIBLE');
    return { ok: true, roomId: result.roomId, demoSessionId: result.demoSessionId, created: false };
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await ensureLocalDemoRoom(db, generateRoomId(), { allowCreate: true, env });
    if (result.created) return { ok: true, roomId: result.roomId, demoSessionId: result.demoSessionId, created: true };
  }
  throw new Error('DEMO_PROVISIONING_FAILED');
}
