import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { PRODUCTION_PROJECT_ID } from './productionAdmin.js';
import { validateProvisionInput } from './presidentProvisioning.js';

const keysFor = count => ['public', ...Array.from({ length: count }, (_, i) => 'judge/' + (i + 1))];
const hash = value => createHash('sha256').update(value).digest('hex');
const reject = code => { throw new Error(code); };
const requireValue = (value, code) => { if (!value) reject(code); };
const claimsFor = key => key === 'public' ? { roomId: 'A', role: 'public' }
  : { roomId: 'A', role: 'judge', judgeId: Number(key.slice(6)) };
const marker = key => 'Patterns HTI A ' + key;
const uidFor = (key, email) => 'patterns-hti-A-' + key.replace('/', '-') + '-' + hash(email).slice(0, 32);

export function validateProductionRoleInput(input) {
  requireValue(input && Object.keys(input).every(key => ['projectId', 'roomId', 'roles'].includes(key)), 'INVALID_ROLE_INPUT');
  requireValue(input.projectId === PRODUCTION_PROJECT_ID, 'PRODUCTION_PROJECT_NOT_APPROVED');
  requireValue(input.roomId === 'A', 'HTI_ROOM_A_REQUIRED');
  requireValue(input.roles && typeof input.roles === 'object' && !Array.isArray(input.roles), 'EXACT_HTI_ROLES_REQUIRED');
  const KEYS = keysFor(Object.keys(input.roles).length - 1);
  requireValue([4, 6].includes(KEYS.length)
    && isDeepStrictEqual(Object.keys(input.roles).sort(), [...KEYS].sort()), 'EXACT_HTI_ROLES_REQUIRED');
  const roles = Object.fromEntries(KEYS.map(key => [key, validateProvisionInput({ roomId: 'A', email: input.roles[key] }).email]));
  requireValue(new Set(Object.values(roles)).size === KEYS.length, 'DUPLICATE_ROLE_EMAIL');
  return { projectId: input.projectId, roomId: 'A', roles };
}

async function optionalUser(action) {
  try { return await action(); }
  catch (error) { if (error.code === 'auth/user-not-found') return null; throw error; }
}

function checkUser(user, entry, key, allowPending) {
  requireValue(user.uid === entry.uid && user.email?.toLowerCase() === entry.email && !user.disabled, 'ROLE_USER_CONFLICT');
  const claims = user.customClaims ?? {};
  if (isDeepStrictEqual(claims, claimsFor(key))) return true;
  requireValue(allowPending && Object.keys(claims).length === 0
    && user.uid === uidFor(key, entry.email) && user.displayName === marker(key)
    && !user.phoneNumber && !(user.providerData ?? []).some(provider => provider.providerId !== 'password'), 'ROLE_CLAIMS_CONFLICT');
  return false;
}

// Strict reservations cover this tool's concurrent runs. Other Admin writers must serialize.
export async function provisionProductionRolesWithAdmin(rawInput, { auth, db, projectId }) {
  const input = validateProductionRoleInput(rawInput);
  const KEYS = Object.keys(input.roles);
  const judgeCount = KEYS.length - 1;
  requireValue(projectId === input.projectId && db.projectId === projectId && auth.app?.options?.projectId === projectId, 'UNVERIFIED_PRODUCTION_ADMIN');
  const roomRefs = ['control', 'meta', 'publicState'].map(name => db.doc('rooms/A/' + name + '/current'));
  const ownerRef = db.doc('_roomProvisioning/A');
  const planRef = db.doc('_roomRoleProvisioning/A');
  const [owner, plan, ...room] = await db.getAll(ownerRef, planRef, ...roomRefs);
  requireValue(owner.exists && owner.data().version === 1 && owner.data().status === 'complete'
    && typeof owner.data().uid === 'string' && room.every(value => value.exists)
    && room[0].data().config?.patternJudges === judgeCount, 'UNVERIFIED_HTI_ROOM');
  const presidentUid = owner.data().uid;
  const president = await auth.getUser(presidentUid);
  const presidentClaims = { roomId: 'A', role: 'president' };
  requireValue(!president.disabled && isDeepStrictEqual(president.customClaims, presidentClaims), 'PRESIDENT_ASSIGNMENT_CONFLICT');
  const presidentAssignmentRef = db.doc('_presidentAssignments/' + hash(presidentUid));
  const presidentAssignment = await presidentAssignmentRef.get();
  requireValue(presidentAssignment.exists && isDeepStrictEqual(presidentAssignment.data(), presidentClaims), 'PRESIDENT_ASSIGNMENT_CONFLICT');
  const previous = plan.exists ? plan.data() : null;
  if (previous) {
    const reservedCount = Object.keys(previous.roles ?? {}).length - 1;
    requireValue([1, 2].includes(previous.version) && previous.roomId === 'A' && previous.presidentUid === presidentUid
      && ['pending', 'complete'].includes(previous.status)
      && [3, 5].includes(reservedCount)
      && isDeepStrictEqual(Object.keys(previous.roles).sort(), keysFor(reservedCount).sort())
      && (previous.version === 1 ? reservedCount === 3 : [3, 5].includes(previous.judgeCount) && previous.judgeCount <= reservedCount)
      && (previous.status !== 'pending' || (previous.judgeCount ?? 3) === judgeCount), 'ROLE_PLAN_CONFLICT');
    requireValue(Object.values(previous.roles).every(entry => entry && typeof entry.uid === 'string'
      && /^[a-f0-9]{64}$/.test(entry.emailHash)), 'ROLE_PLAN_CONFLICT');
  }
  const entries = {};
  for (const key of KEYS) {
    const email = input.roles[key];
    const byEmail = await optionalUser(() => auth.getUserByEmail(email));
    const reserved = previous?.roles[key];
    if (reserved) requireValue(reserved.emailHash === hash(email), 'ROLE_PLAN_CONFLICT');
    const uid = reserved?.uid ?? byEmail?.uid ?? uidFor(key, email);
    requireValue(uid !== presidentUid && (!byEmail || byEmail.uid === uid), 'ROLE_USER_CONFLICT');
    const user = await optionalUser(() => auth.getUser(uid));
    // A completed plan never recreates a deleted account. Pending plans may resume creation.
    requireValue(user || !reserved || previous?.status !== 'complete', 'ROLE_USER_MISSING');
    entries[key] = { uid, email };
    if (user) checkUser(user, entries[key], key, !!reserved && previous?.status === 'pending');
  }
  // Downgrades retain reservations and identities for judges 4/5, never erase claims.
  for (const [key, reserved] of Object.entries(previous?.roles ?? {})) {
    if (entries[key]) continue;
    const user = await auth.getUser(reserved.uid);
    requireValue(typeof user.email === 'string' && hash(user.email.toLowerCase()) === reserved.emailHash, 'ROLE_USER_CONFLICT');
    entries[key] = { uid: reserved.uid, email: user.email.toLowerCase() };
    checkUser(user, entries[key], key, false);
  }
  const allKeys = Object.keys(entries);
  requireValue(Object.values(entries).every(entry => entry.uid !== presidentUid)
    && new Set(Object.values(entries).map(entry => entry.uid)).size === allKeys.length, 'DUPLICATE_ROLE_UID');

  async function checkAssignments() {
    let pageToken;
    do {
      const page = await auth.listUsers(1000, pageToken);
      for (const user of page.users) {
        const claims = user.customClaims ?? {};
        if (claims.roomId !== 'A') continue;
        if (user.uid === presidentUid) {
          requireValue(!user.disabled && isDeepStrictEqual(claims, presidentClaims), 'PRESIDENT_ASSIGNMENT_CONFLICT');
          continue;
        }
        // Reject disabled or malformed existing assignments too; never silently reclaim a slot.
        const key = claims.role === 'public' ? 'public'
          : claims.role === 'judge' && Number.isInteger(claims.judgeId) ? 'judge/' + claims.judgeId : null;
        requireValue(key && entries[key]?.uid === user.uid && !user.disabled
          && isDeepStrictEqual(claims, claimsFor(key)), 'DUPLICATE_OR_INVALID_ROOM_ROLE');
      }
      pageToken = page.pageToken;
    } while (pageToken);
  }
  await checkAssignments();
  const assignmentRefs = allKeys.map(key => db.doc('_roleAssignments/' + hash(entries[key].uid)));
  const priorPresidentRefs = allKeys.map(key => db.doc('_presidentAssignments/' + hash(entries[key].uid)));
  const proposed = { version: 2, roomId: 'A', presidentUid, judgeCount, status: 'pending',
    roles: Object.fromEntries(allKeys.map(key => [key, { uid: entries[key].uid, emailHash: hash(entries[key].email) }])) };
  const matchesPlan = current => current && ['pending', 'complete'].includes(current.status)
    && isDeepStrictEqual({ ...current, status: 'pending' }, proposed);
  function checkRoom(values) {
    requireValue(isDeepStrictEqual(values[0].data(), owner.data()) && values[0].exists
      && values.slice(1, 4).every(value => value.exists)
      && values[1].data().config?.patternJudges === judgeCount
      && values[4].exists && isDeepStrictEqual(values[4].data(), presidentClaims), 'ROOM_CHANGED');
  }
  await db.runTransaction(async tx => {
    const values = await tx.getAll(ownerRef, ...roomRefs, presidentAssignmentRef, planRef, ...assignmentRefs, ...priorPresidentRefs);
    checkRoom(values);
    const current = values[5].exists ? values[5].data() : null;
    requireValue((!current && !previous) || (current && isDeepStrictEqual(current, previous)) || matchesPlan(current), 'ROLE_PLAN_CONFLICT');
    requireValue(values.slice(6 + allKeys.length).every(value => !value.exists), 'ROLE_RESERVATION_CONFLICT');
    // Validate every reservation before scheduling any writes.
    allKeys.forEach((key, i) => requireValue((!current?.roles[key] && !values[6 + i].exists)
      || (values[6 + i].exists && isDeepStrictEqual(values[6 + i].data(), claimsFor(key))), 'ROLE_RESERVATION_CONFLICT'));
    if (!values[5].exists) tx.create(planRef, proposed);
    else if (!matchesPlan(current)) tx.update(planRef, proposed);
    allKeys.forEach((key, i) => { if (!values[6 + i].exists) tx.create(assignmentRefs[i], claimsFor(key)); });
  });
  let created = 0;
  let assigned = 0;
  for (const key of KEYS) {
    await checkAssignments();
    const ownerNow = await auth.getUser(presidentUid);
    requireValue(!ownerNow.disabled && isDeepStrictEqual(ownerNow.customClaims, presidentClaims), 'PRESIDENT_ASSIGNMENT_CONFLICT');
    let user = await optionalUser(() => auth.getUser(entries[key].uid));
    if (!user) {
      requireValue(!previous?.roles[key] || previous.status !== 'complete', 'ROLE_USER_MISSING');
      try {
        user = await auth.createUser({ uid: entries[key].uid, email: entries[key].email, displayName: marker(key) });
        created++;
      } catch (error) {
        if (!['auth/uid-already-exists', 'auth/email-already-exists'].includes(error.code)) throw error;
        user = await auth.getUser(entries[key].uid);
      }
    }
    if (!checkUser(user, entries[key], key, !previous?.roles[key] || previous.status !== 'complete')) {
      // Revalidate Room ownership and reservations immediately before granting authority.
      await db.runTransaction(async tx => {
        const values = await tx.getAll(ownerRef, ...roomRefs, presidentAssignmentRef, planRef, ...assignmentRefs, ...priorPresidentRefs);
        checkRoom(values);
        requireValue(values[5].exists && matchesPlan(values[5].data()), 'ROLE_PLAN_CONFLICT');
        requireValue(values.slice(6 + allKeys.length).every(value => !value.exists), 'ROLE_RESERVATION_CONFLICT');
        allKeys.forEach((key, i) => requireValue(values[6 + i].exists
          && isDeepStrictEqual(values[6 + i].data(), claimsFor(key)), 'ROLE_RESERVATION_CONFLICT'));
      });
      await auth.setCustomUserClaims(user.uid, claimsFor(key));
      assigned++;
    }
    checkUser(await auth.getUser(entries[key].uid), entries[key], key, false);
  }
  await checkAssignments();
  const finalPresident = await auth.getUser(presidentUid);
  requireValue(!finalPresident.disabled && isDeepStrictEqual(finalPresident.customClaims, presidentClaims), 'PRESIDENT_ASSIGNMENT_CONFLICT');
  await db.runTransaction(async tx => {
    const values = await tx.getAll(ownerRef, ...roomRefs, presidentAssignmentRef, planRef, ...assignmentRefs, ...priorPresidentRefs);
    checkRoom(values);
    requireValue(values[5].exists && matchesPlan(values[5].data()), 'ROLE_PLAN_CONFLICT');
    requireValue(values.slice(6 + allKeys.length).every(value => !value.exists), 'ROLE_RESERVATION_CONFLICT');
    allKeys.forEach((key, i) => requireValue(values[6 + i].exists
      && isDeepStrictEqual(values[6 + i].data(), claimsFor(key)), 'ROLE_RESERVATION_CONFLICT'));
    if (values[5].data().status !== 'complete') tx.update(planRef, { status: 'complete' });
  });
  // No identities, emails, claims or credential values are returned to CLI output.
  return { ok: true, roomId: 'A', roleCount: KEYS.length, created, assigned };
}
