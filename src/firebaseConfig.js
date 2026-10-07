// Production stays blocked until real Project ID / App ID pairs are approved in code.
const APPROVED_PRODUCTION_APPS = Object.freeze([]);
const EMULATOR_KEYS = ['VITE_FIREBASE_EMULATOR_HOST', 'VITE_FIREBASE_ALLOW_LAN',
  'VITE_FIRESTORE_EMULATOR_PORT', 'VITE_AUTH_EMULATOR_PORT',
  'FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST'];
export const LOCAL_PROJECT_ID = "demo-patterns-gups";
export function resolveFirebaseEnvironment(source = {}) {
  const fail = (message) => { throw new Error('[Firebase config] ' + message); };
  if (source.VITE_APP_ENV === 'production') {
    if (source.VITE_FIREBASE_USE_EMULATOR !== 'false' || source.VITE_FIREBASE_ALLOW_PRODUCTION !== 'true') fail('Contradictory production selectors');
    for (const key of EMULATOR_KEYS) {
      if (source[key] !== undefined) fail('Emulator configuration is forbidden in production: ' + key);
    }
    const firebaseConfig = {};
    for (const [key, field] of Object.entries({ PROJECT_ID: 'projectId', API_KEY: 'apiKey', AUTH_DOMAIN: 'authDomain', APP_ID: 'appId' })) {
      const value = source['VITE_FIREBASE_' + key];
      if (typeof value !== 'string' || !value.length || value.trim() !== value || /\s/.test(value)) fail('Missing or invalid production configuration: ' + key);
      firebaseConfig[field] = value;
    }
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(firebaseConfig.projectId) || firebaseConfig.projectId.startsWith('demo-')) fail('Invalid production project');
    if (!/^1:[0-9]+:web:[a-f0-9]+$/.test(firebaseConfig.appId)) fail('Invalid production App ID');
    if (!APPROVED_PRODUCTION_APPS.some(app => app.projectId === firebaseConfig.projectId && app.appId === firebaseConfig.appId)) fail('Production Project ID / App ID pair is not approved');
    return Object.freeze({ environment: 'production', firebaseConfig: Object.freeze(firebaseConfig), emulator: null });
  }
  if (source.VITE_APP_ENV !== 'development') fail('Unknown or missing VITE_APP_ENV');
  if (source.VITE_FIREBASE_USE_EMULATOR !== 'true') fail('Both emulators are required');
  if (source.VITE_FIREBASE_PROJECT_ID !== LOCAL_PROJECT_ID) fail('Project must be demo-patterns-gups');
  if (source.VITE_FIREBASE_ALLOW_PRODUCTION !== 'false') fail('Production is disabled');
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
    environment: 'development',
    firebaseConfig: Object.freeze({ projectId: LOCAL_PROJECT_ID, apiKey: 'demo-patterns-gups-key', authDomain: LOCAL_PROJECT_ID + '.firebaseapp.com', appId: 'demo-patterns-gups-app' }),
    emulator: Object.freeze({ host, firestorePort, authPort }),
  });
}
