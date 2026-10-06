// This microstage enables local development only. No cloud fallback is allowed.
export const LOCAL_PROJECT_ID = "demo-patterns-gups";
export function resolveFirebaseEnvironment(source = {}) {
  const fail = (message) => { throw new Error('[Firebase config] ' + message); };
  if (source.VITE_APP_ENV !== 'development') fail('VITE_APP_ENV must be development');
  if (source.VITE_FIREBASE_USE_EMULATOR !== 'true') fail('Both emulators are required');
  if (source.VITE_FIREBASE_PROJECT_ID !== LOCAL_PROJECT_ID) fail('Project must be demo-patterns-gups');
  if (source.VITE_FIREBASE_ALLOW_PRODUCTION !== undefined && source.VITE_FIREBASE_ALLOW_PRODUCTION !== 'false') fail('Production is disabled');
  // Reject legacy cloud settings rather than silently ignoring ambiguous configuration.
  for (const key of ['API_KEY', 'AUTH_DOMAIN', 'STORAGE_BUCKET', 'MESSAGING_SENDER_ID', 'APP_ID']) {
    if (source['VITE_FIREBASE_' + key] !== undefined) fail('Cloud configuration is not allowed: ' + key);
  }
  const host = source.VITE_FIREBASE_EMULATOR_HOST;
  const lan = source.VITE_FIREBASE_ALLOW_LAN;
  if (lan !== 'true' && lan !== 'false') fail('VITE_FIREBASE_ALLOW_LAN must be true or false');
  const loopback = host === 'localhost' || host === '127.0.0.1';
  const parts = typeof host === 'string' ? host.split('.') : [];
  const ipv4 = parts.length === 4 && parts.every(p => /^(0|[1-9][0-9]{0,2})$/.test(p) && Number(p) <= 255);
  const privateHost = ipv4 && (parts[0] === '10' || (parts[0] === '192' && parts[1] === '168') || (parts[0] === '172' && Number(parts[1]) >= 16 && Number(parts[1]) <= 31));
  if (!loopback && !(lan === 'true' && privateHost)) fail('Host requires loopback or an explicitly allowed private LAN IPv4');
  if (loopback && lan === 'true') fail('LAN opt-in requires a private LAN address');
  const port = name => {
    const raw = source[name];
    if (typeof raw !== 'string' || !/^[1-9][0-9]{0,4}$/.test(raw) || Number(raw) > 65535) fail('Invalid port: ' + name);
    return Number(raw);
  };
  const firestorePort = port('VITE_FIRESTORE_EMULATOR_PORT');
  const authPort = port('VITE_AUTH_EMULATOR_PORT');
  if (firestorePort === authPort) fail('Emulator ports must differ');
  return Object.freeze({
    firebaseConfig: Object.freeze({ projectId: LOCAL_PROJECT_ID, apiKey: 'demo-patterns-gups-key', authDomain: LOCAL_PROJECT_ID + '.firebaseapp.com', appId: 'demo-patterns-gups-app' }),
    emulator: Object.freeze({ host, firestorePort, authPort }),
  });
}
