import { browserSessionPersistence, setPersistence, signInWithCustomToken, getIdTokenResult, signOut } from 'firebase/auth';
import { resolveFirebaseEnvironment } from './firebaseConfig.js';
import { identityFromClaims, authorizeRoomRoute } from './roomAccess.js';
import { isDemoRoomId, roomBasePath } from './roomRoutes.js';
import { validDemoSessionId } from './demoMatchCredits.js';

function localSettings(source, hostname) {
  const settings = resolveFirebaseEnvironment(source);
  if (settings.environment !== 'development' || !['127.0.0.1', 'localhost'].includes(hostname)
    || !['127.0.0.1', 'localhost'].includes(settings.emulator.host)) throw new Error('LOCAL_DEMO_REQUIRED');
  return settings;
}

export async function requestLocalDemo({ storage, fetchImpl = fetch, source = import.meta.env ?? globalThis.process?.env, hostname = globalThis.location?.hostname }) {
  localSettings(source, hostname);
  const existing = storage.getItem('patterns_demo_room_id');
  const response = await fetchImpl('/api/create-demo', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId: isDemoRoomId(existing) ? existing : null }),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    if (isDemoRoomId(result.roomId)) storage.setItem('patterns_demo_room_id', result.roomId);
    throw new Error(result.code || 'DEMO_UNAVAILABLE');
  }
  if (!isDemoRoomId(result.roomId) || !validDemoSessionId(result.demoSessionId)) throw new Error('INVALID_DEMO_RESPONSE');
  storage.setItem('patterns_demo_room_id', result.roomId);
  return roomBasePath(result.roomId);
}

export async function authenticateLocalDemoRoute(auth, route, {
  fetchImpl = fetch, source = import.meta.env ?? globalThis.process?.env, hostname = globalThis.location?.hostname,
  sdk = { setPersistence, signInWithCustomToken, getIdTokenResult, signOut, browserSessionPersistence },
} = {}) {
  const settings = localSettings(source, hostname);
  if (auth.app?.options?.projectId !== settings.firebaseConfig.projectId
    || !['127.0.0.1', 'localhost'].includes(auth.emulatorConfig?.host)
    || auth.emulatorConfig.port !== settings.emulator.authPort) throw new Error('AUTH_EMULATOR_MISMATCH');
  if (!route.valid || !isDemoRoomId(route.roomId)) throw new Error('INVALID_DEMO_ROOM_ID');
  if (auth.currentUser) {
    const { claims } = await sdk.getIdTokenResult(auth.currentUser, true);
    if ((claims.role === 'judge' ? Number.isInteger(claims.judgeId) : claims.judgeId === undefined)
      && authorizeRoomRoute(identityFromClaims(auth.currentUser, claims), route).allowed) return;
  }
  const role = route.role === 'home' ? 'president' : route.role;
  if (!['president', 'public', 'judge'].includes(role)) throw new Error('INVALID_DEMO_ROLE');
  if (role === 'judge' && (!Number.isInteger(route.judgeId) || route.judgeId < 1 || route.judgeId > 5)) throw new Error('INVALID_JUDGE_ID');
  const key = role === 'judge' ? 'judge/' + route.judgeId : role;
  const response = await fetchImpl('/api/demo-access/' + route.roomId + '/' + key, { method: 'POST' });
  const result = await response.json();
  if (!response.ok || typeof result.token !== 'string') throw new Error(result.code || 'DEMO_ACCESS_UNAVAILABLE');
  await sdk.setPersistence(auth, sdk.browserSessionPersistence);
  try {
    const { user } = await sdk.signInWithCustomToken(auth, result.token);
    const { claims } = await sdk.getIdTokenResult(user, true);
    if (claims.roomId !== route.roomId || claims.role !== role
      || (role === 'judge' ? claims.judgeId !== route.judgeId : claims.judgeId !== undefined)
      || !authorizeRoomRoute(identityFromClaims(user, claims), route).allowed) throw new Error('DEMO_CLAIMS_MISMATCH');
  } catch (error) { await sdk.signOut(auth); throw error; }
}
