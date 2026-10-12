import { browserSessionPersistence, setPersistence, signInWithEmailAndPassword, getIdTokenResult, signOut } from 'firebase/auth';
import { resolveFirebaseEnvironment } from './firebaseConfig.js';
import { validatePresidentAuthEnvironment } from './presidentSession.js';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';

const sdkDefaults = { setPersistence, signInWithEmailAndPassword, getIdTokenResult, signOut,
  async getRoomJudgeCount(auth, roomId) {
    const snapshot = await getDocFromServer(doc(getFirestore(auth.app), 'rooms', roomId, 'control', 'current'));
    if (!snapshot.exists()) throw new Error('PRODUCTION_ROOM_REQUIRED');
    return snapshot.data().config?.patternJudges;
  } };
// Firebase's standard verified token fields plus the only supported assignment claims.
const CLAIM_KEYS = new Set(['iss', 'aud', 'auth_time', 'user_id', 'sub', 'iat', 'exp',
  'email', 'email_verified', 'phone_number', 'name', 'picture', 'firebase', 'roomId', 'role', 'judgeId']);

export function productionRolePathFromClaims(claims, judgeCount = 3) {
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)
    || !Object.hasOwn(claims, 'roomId') || !Object.hasOwn(claims, 'role')
    || Object.keys(claims).some(key => !CLAIM_KEYS.has(key))
    || typeof claims.roomId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(claims.roomId)
    || claims.roomId.startsWith('demo-patterns-')
    || !['president', 'public', 'judge'].includes(claims.role)
    || (claims.role === 'judge'
      ? !Object.hasOwn(claims, 'judgeId') || !Number.isInteger(claims.judgeId)
        || ![3, 5].includes(judgeCount) || claims.judgeId < 1 || claims.judgeId > judgeCount
      : Object.hasOwn(claims, 'judgeId'))) {
    throw new Error('PRODUCTION_ROLE_CLAIMS_REQUIRED');
  }
  return '/rooms/' + claims.roomId + '/' + claims.role
    + (claims.role === 'judge' ? '/' + claims.judgeId : '');
}

export async function loginProductionRole(auth, email, password, {
  source = import.meta.env ?? globalThis.process?.env,
  persistence = browserSessionPersistence,
  sdk = sdkDefaults,
} = {}) {
  try {
    validatePresidentAuthEnvironment(auth, source);
    if (resolveFirebaseEnvironment(source).environment !== 'production') throw new Error('PRODUCTION_AUTH_REQUIRED');
    await sdk.setPersistence(auth, persistence);
    await sdk.signOut(auth);
    const { user } = await sdk.signInWithEmailAndPassword(auth, email, password);
    // Force Firebase Auth to retrieve the verified claims; never decode input or URL tokens.
    const { claims } = await sdk.getIdTokenResult(user, true);
    // Validate shape before using any claim in a Firestore path, then read current
    // configuration from the server. Cached data and caller options cannot activate a judge.
    const path = productionRolePathFromClaims(claims, 5);
    if (claims.role !== 'judge') return path;
    const judgeCount = await sdk.getRoomJudgeCount(auth, claims.roomId);
    if (![3, 5].includes(judgeCount)) throw new Error('PRODUCTION_ROOM_CONFIGURATION_REQUIRED');
    return productionRolePathFromClaims(claims, judgeCount);
  } catch (error) {
    await sdk.signOut(auth);
    throw error;
  }
}
