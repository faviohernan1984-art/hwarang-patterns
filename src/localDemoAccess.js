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

const CREDENTIAL = /^[a-f0-9]{64}$/;
export function demoCredentialStorageKey(roomId, key) {
  if (!isDemoRoomId(roomId) || !/^(president|public|judge\/[1-5])$/.test(key)) throw new Error('INVALID_DEMO_ACCESS');
  return 'patterns_demo_credential:' + roomId + ':' + key;
}

export function storedDemoCredential(storage, roomId, key) {
  const value = storage?.getItem(demoCredentialStorageKey(roomId, key));
  return typeof value === 'string' && CREDENTIAL.test(value) ? value : null;
}

export function demoRouteKey(route) {
  const role = route.role === 'home' ? 'president' : route.role;
  const key = role === 'judge' ? 'judge/' + route.judgeId : role;
  demoCredentialStorageKey(route.roomId, key);
  return key;
}

export async function requestLocalDemo({ storage, fetchImpl = fetch, source = import.meta.env ?? globalThis.process?.env, hostname = globalThis.location?.hostname }) {
  localSettings(source, hostname);
  const existing = storage.getItem('patterns_demo_room_id');
  const credential = isDemoRoomId(existing) ? storedDemoCredential(storage, existing, 'president') : null;
  if (isDemoRoomId(existing) && !credential) throw new Error('DEMO_CREDENTIAL_REQUIRED');
  const response = await fetchImpl('/api/create-demo', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(credential ? { Authorization: 'Bearer ' + credential } : {}) },
    body: JSON.stringify({ roomId: isDemoRoomId(existing) ? existing : null }),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    if (isDemoRoomId(result.roomId)) storage.setItem('patterns_demo_room_id', result.roomId);
    throw new Error(result.code || 'DEMO_UNAVAILABLE');
  }
  if (!isDemoRoomId(result.roomId) || !validDemoSessionId(result.demoSessionId)) throw new Error('INVALID_DEMO_RESPONSE');
  if (isDemoRoomId(existing) && (result.roomId !== existing || result.created !== false)) throw new Error('INVALID_DEMO_RESPONSE');
  if (result.created) {
    const entries = Object.entries(result.credentials ?? {});
    if (!entries.some(([key]) => key === 'president') || !entries.some(([key]) => key === 'public')
      || entries.some(([key, value]) => !/^(president|public|judge\/[1-5])$/.test(key) || typeof value !== 'string' || !CREDENTIAL.test(value))) throw new Error('INVALID_DEMO_RESPONSE');
    for (const [key, value] of entries) storage.setItem(demoCredentialStorageKey(result.roomId, key), value);
  }
  storage.setItem('patterns_demo_room_id', result.roomId);
  return roomBasePath(result.roomId);
}

export async function authenticateLocalDemoRoute(auth, route, {
  fetchImpl = fetch, source = import.meta.env ?? globalThis.process?.env, hostname = globalThis.location?.hostname,
  storage = globalThis.sessionStorage, credential,
  sdk = { setPersistence, signInWithCustomToken, getIdTokenResult, signOut, browserSessionPersistence },
} = {}) {
  const settings = localSettings(source, hostname);
  if (auth.app?.options?.projectId !== settings.firebaseConfig.projectId
    || !['127.0.0.1', 'localhost'].includes(auth.emulatorConfig?.host)
    || auth.emulatorConfig.port !== settings.emulator.authPort) throw new Error('AUTH_EMULATOR_MISMATCH');
  if (!route.valid || !isDemoRoomId(route.roomId)) throw new Error('INVALID_DEMO_ROOM_ID');
  if (auth.currentUser && credential === undefined) {
    const { claims } = await sdk.getIdTokenResult(auth.currentUser, true);
    if ((claims.role === 'judge' ? Number.isInteger(claims.judgeId) : claims.judgeId === undefined)
      && authorizeRoomRoute(identityFromClaims(auth.currentUser, claims), route).allowed) return;
  }
  const role = route.role === 'home' ? 'president' : route.role;
  if (!['president', 'public', 'judge'].includes(role)) throw new Error('INVALID_DEMO_ROLE');
  if (role === 'judge' && (!Number.isInteger(route.judgeId) || route.judgeId < 1 || route.judgeId > 5)) throw new Error('INVALID_JUDGE_ID');
  const key = role === 'judge' ? 'judge/' + route.judgeId : role;
  const secret = credential ?? storedDemoCredential(storage, route.roomId, key);
  if (typeof secret !== 'string' || !CREDENTIAL.test(secret)) throw new Error('DEMO_CREDENTIAL_REQUIRED');
  const response = await fetchImpl('/api/demo-access/' + route.roomId + '/' + key, {
    method: 'POST', headers: { Authorization: 'Bearer ' + secret },
  });
  const result = await response.json();
  if (!response.ok || typeof result.token !== 'string') {
    if (response.status === 403) {
      storage?.removeItem(demoCredentialStorageKey(route.roomId, key));
      throw new Error('DEMO_AUTHORIZATION_DENIED');
    }
    throw new Error('DEMO_ACCESS_UNAVAILABLE');
  }
  await sdk.setPersistence(auth, sdk.browserSessionPersistence);
  try {
    const { user } = await sdk.signInWithCustomToken(auth, result.token);
    const { claims } = await sdk.getIdTokenResult(user, true);
    if (claims.roomId !== route.roomId || claims.role !== role
      || (role === 'judge' ? claims.judgeId !== route.judgeId : claims.judgeId !== undefined)
      || !authorizeRoomRoute(identityFromClaims(user, claims), route).allowed) throw new Error('DEMO_CLAIMS_MISMATCH');
    storage?.setItem(demoCredentialStorageKey(route.roomId, key), secret);
    if (role === 'president') storage?.setItem('patterns_demo_room_id', route.roomId);
  } catch (error) {
    storage?.removeItem(demoCredentialStorageKey(route.roomId, key));
    await sdk.signOut(auth); throw error;
  }
}
