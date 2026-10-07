/* global process */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { deleteApp } from 'firebase-admin/app';
import { localAdmin } from './localAdmin.js';
import { initialRoomDocuments } from './roomDefaults.js';

export function validateProvisionInput(input) {
  if (!input || Object.keys(input).some(key => !['roomId', 'email'].includes(key))) throw new Error('INVALID_INPUT');
  const { roomId, email } = input;
  if (typeof roomId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(roomId)) throw new Error('INVALID_ROOM_ID');
  if (typeof email !== 'string' || email.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(email) || email.startsWith('.') || email.split('@')[0].endsWith('.') || email.includes('..')) throw new Error('INVALID_EMAIL');
  return { roomId, email: email.toLowerCase() };
}

function checkUser(user, claims) {
  if (user.disabled) throw new Error('PRESIDENT_DISABLED');
  const existing = user.customClaims ?? {};
  if (Object.keys(existing).length && !isDeepStrictEqual(existing, claims)) throw new Error('PRESIDENT_ASSIGNMENT_CONFLICT');
}

export async function provisionPresident(input) {
  const { roomId, email } = validateProvisionInput(input);
  const { app, auth, db } = localAdmin();
  try {
    let user;
    try { user = await auth.getUserByEmail(email); }
    catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
      try { user = await auth.createUser({ email }); }
      catch (createError) {
        if (createError.code !== 'auth/email-already-exists') throw createError;
        user = await auth.getUserByEmail(email);
      }
    }
    const claims = { roomId, role: 'president' };
    checkUser(user, claims);
    const assignment = db.doc('_localPresidentAssignments/' + createHash('sha256').update(user.uid).digest('hex'));
    const journal = db.doc('_localRoomProvisioning/' + roomId);
    const refs = ['control', 'meta', 'publicState'].map(name => db.doc('rooms/' + roomId + '/' + name + '/current'));
    const initial = initialRoomDocuments();
    // Reserve both UID and Room atomically. Journal collections are denied by existing Rules.
    await db.runTransaction(async tx => {
      const docs = await tx.getAll(assignment, journal, ...refs);
      const [assigned, planned, ...roomDocs] = docs;
      if (assigned.exists && (assigned.data().roomId !== roomId || assigned.data().role !== 'president')) throw new Error('PRESIDENT_ASSIGNMENT_CONFLICT');
      if (planned.exists && (planned.data().uid !== user.uid || planned.data().version !== 1)) throw new Error('ROOM_PRESIDENT_CONFLICT');
      if (!planned.exists && roomDocs.every(d => d.exists) && !isDeepStrictEqual(user.customClaims ?? {}, claims)) throw new Error('ROOM_OWNER_UNVERIFIED');
      const partial = roomDocs.some(d => d.exists) && !roomDocs.every(d => d.exists);
      if (partial && (!planned.exists || roomDocs.some((d, i) => d.exists && !isDeepStrictEqual(d.data(), initial[i])))) throw new Error('UNSAFE_PARTIAL_ROOM');
      if (!assigned.exists) tx.create(assignment, { roomId, role: 'president' });
      if (!planned.exists) tx.create(journal, { uid: user.uid, version: 1, status: 'pending' });
    });
    const created = await db.runTransaction(async tx => {
      const docs = await tx.getAll(...refs);
      if (docs.every(d => d.exists)) return false;
      if (docs.some((d, i) => d.exists && !isDeepStrictEqual(d.data(), initial[i]))) throw new Error('UNSAFE_PARTIAL_ROOM');
      docs.forEach((d, i) => { if (!d.exists) tx.create(refs[i], initial[i]); });
      return true;
    });
    // Claims are the last authority-granting operation; never replace incompatible claims.
    user = await auth.getUser(user.uid);
    checkUser(user, claims);
    if (!isDeepStrictEqual(user.customClaims ?? {}, claims)) await auth.setCustomUserClaims(user.uid, claims);
    await journal.update({ status: 'complete' });
    return { projectId: app.options.projectId, roomId, uid: user.uid, claims, created };
  } finally {
    await db.terminate();
    await deleteApp(app);
  }
}

export function parseProvisionArgs(args) {
  if (args.length !== 4 || args[0] !== '--room' || args[2] !== '--email') throw new Error('Usage: --room ROOM_ID --email PRESIDENT_EMAIL');
  return validateProvisionInput({ roomId: args[1], email: args[3] });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(() => provisionPresident(parseProvisionArgs(process.argv.slice(2))))
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error.code ?? error.message); process.exitCode = 1; });
}
