import { browserSessionPersistence, setPersistence, signInWithEmailAndPassword, getIdTokenResult, signOut } from 'firebase/auth';
import { parseAppRoute, roomBasePath } from './roomRoutes.js';

function emulatorOnly(auth) {
  if (auth.app.options.projectId !== 'demo-patterns-gups' || !auth.emulatorConfig) throw new Error('EMULATOR_REQUIRED');
}
export function presidentPathFromClaims(claims) {
  if (claims.role !== 'president' || typeof claims.roomId !== 'string' || claims.judgeId !== undefined) throw new Error('PRESIDENT_CLAIMS_REQUIRED');
  const route = parseAppRoute(roomBasePath(claims.roomId) + '/president');
  if (!route.valid || route.roomId !== claims.roomId) throw new Error('INVALID_ROOM_CLAIM');
  return roomBasePath(claims.roomId) + '/president';
}
export async function loginPresident(auth, email, password, persistence = browserSessionPersistence) {
  emulatorOnly(auth);
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
  emulatorOnly(auth);
  await signOut(auth);
}
