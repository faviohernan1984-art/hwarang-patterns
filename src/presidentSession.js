import { browserSessionPersistence, setPersistence, signInWithEmailAndPassword, getIdTokenResult, signOut } from 'firebase/auth';
import { resolveFirebaseEnvironment } from "./firebaseConfig.js";
import { parseAppRoute, roomBasePath } from './roomRoutes.js';

export function validatePresidentAuthEnvironment(auth, source = import.meta.env ?? globalThis.process?.env) {
  const settings = resolveFirebaseEnvironment(source);
  const options = auth?.app?.options;
  if (options?.projectId !== settings.firebaseConfig.projectId) throw new Error('AUTH_PROJECT_MISMATCH');
  if (settings.environment === 'development') {
    if (!auth.emulatorConfig) throw new Error('EMULATOR_REQUIRED');
  } else {
    if (options.appId !== settings.firebaseConfig.appId) throw new Error('AUTH_APP_MISMATCH');
    if (auth.emulatorConfig) throw new Error('PRODUCTION_EMULATOR_FORBIDDEN');
  }
}
export function presidentPathFromClaims(claims) {
  if (claims.role !== 'president' || typeof claims.roomId !== 'string' || claims.judgeId !== undefined) throw new Error('PRESIDENT_CLAIMS_REQUIRED');
  const route = parseAppRoute(roomBasePath(claims.roomId) + '/president');
  if (!route.valid || route.roomId !== claims.roomId) throw new Error('INVALID_ROOM_CLAIM');
  return roomBasePath(claims.roomId) + '/president';
}
export async function loginPresident(auth, email, password, persistence = browserSessionPersistence) {
  validatePresidentAuthEnvironment(auth);
  await setPersistence(auth, persistence);
  await signOut(auth);
  try {
    const { user } = await signInWithEmailAndPassword(auth, email, password);
    const { claims } = await getIdTokenResult(user, true);
    return presidentPathFromClaims(claims);
  } catch (error) {
    await signOut(auth);
    throw error;
  }
}
export async function logoutPresident(auth) {
  validatePresidentAuthEnvironment(auth);
  await signOut(auth);
}
