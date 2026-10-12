/* global process */
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithCustomToken, inMemoryPersistence, setPersistence, getIdTokenResult } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, getDocFromServer, updateDoc, terminate } from 'firebase/firestore';
import { deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { localAdmin, validateAdminEnvironment } from './localAdmin.js';
import { readLocalDemoAccess, issueLocalDemoToken } from './localDemoIdentities.js';
import { revokeLocalDemoAuthorization } from './localDemoAuthorization.js';

const fail = () => { throw new Error('REVOCATION_CHECK_FAILED'); };
const check = value => { if (!value) fail(); };
const version = value => Number.isSafeInteger(value) && value >= 1;
async function denied(action) {
  try { await action(); } catch (error) { if (error?.code === 'permission-denied') return; fail(); }
  fail();
}

// All diagnostics are fixed labels. Snapshots, credentials and SDK errors stay in memory.
export async function checkPresidentRevocation({ roomId, env, execute = false, adapter }) {
  validateAdminEnvironment(env);
  check(/^demo-patterns-[a-f0-9]{24}$/.test(roomId ?? ''));
  check(typeof execute === 'boolean');
  const before = await adapter.snapshot();
  const authorization = before.authorization;
  const control = before.documents['rooms/' + roomId + '/control/current'];
  const meta = before.documents['rooms/' + roomId + '/meta/current'];
  check(control && meta && /^[A-Za-z0-9_-]{1,64}$/.test(meta.demoSessionId ?? ''));
  check([3, 5].includes(control.config?.patternJudges));
  const keys = ['president', 'public', ...Array.from({ length: control.config.patternJudges }, (_, i) => 'judge/' + (i + 1))];
  check(authorization?.version === 1 && version(authorization.roomAccessVersion));
  check(isDeepStrictEqual(Object.keys(authorization.roles ?? {}).sort(), [...keys].sort()));
  for (const key of keys) {
    const grant = authorization.roles[key];
    check(grant.active === true && version(grant.accessVersion) && /^[a-f0-9]{64}$/.test(grant.hash ?? ''));
  }
  check(authorization.roles.president.accessVersion < Number.MAX_SAFE_INTEGER);
  const paths = key => key === 'president'
    ? ['control/current', 'meta/current', 'publicState/current', 'demoSessions/' + meta.demoSessionId,
      ...keys.filter(k => k.startsWith('judge/')).flatMap(k => ['judges/' + k.slice(6), 'submissions/' + k.slice(6)])]
    : key === 'public' ? ['control/current', 'publicState/current'] : ['control/current', 'meta/current', 'submissions/' + key.slice(6)];
  for (const key of keys) {
    const claims = await adapter.login(key);
    check(claims.roomId === roomId && claims.role === (key.startsWith('judge/') ? 'judge' : key));
    check(key.startsWith('judge/') ? claims.judgeId === Number(key.slice(6)) : claims.judgeId === undefined);
    check(claims.roomAccessVersion === authorization.roomAccessVersion && claims.accessVersion === authorization.roles[key].accessVersion);
    for (const path of paths(key)) await adapter.read(key, path);
  }
  // A stale President token must already fail: verifies version enforcement before mutation.
  await adapter.checkStalePresident(authorization);
  await denied(() => adapter.writeControl('public', control.pausedRemaining));
  await denied(() => adapter.read('public', 'meta/current'));
  for (const key of keys.filter(k => k.startsWith('judge/'))) {
    await denied(() => adapter.writeControl(key, control.pausedRemaining));
  }
  check(isDeepStrictEqual(before, await adapter.snapshot()));
  if (!execute) return { status: 'PREFLIGHT_OK_NO_REVOCATION' };
  // Adapter checks the baseline again inside the revocation transaction.
  await adapter.revoke(before);
  for (const path of paths('president')) await denied(() => adapter.read('president', path));
  await denied(() => adapter.writeControl('president', control.pausedRemaining));
  check(await adapter.presidentStillAuthenticated());
  await adapter.checkPresidentTokenDenied();
  for (const key of keys.filter(k => k !== 'president')) {
    for (const path of paths(key)) await adapter.read(key, path);
  }
  const expected = { ...before, authorization: { ...authorization, roles: { ...authorization.roles,
    president: { ...authorization.roles.president, active: false, accessVersion: authorization.roles.president.accessVersion + 1 } } } };
  check(isDeepStrictEqual(expected, await adapter.snapshot()));
  return { status: 'PRESIDENT_ONLY_REVOCATION_VERIFIED' };
}

async function realAdapter(roomId, credentials, env) {
  const admin = localAdmin();
  const clients = new Map();
  const authorizationRef = admin.db.doc('localDemoAuthorization/' + roomId);
  async function snapshot() {
    const documents = {};
    async function visit(ref) {
      const value = await ref.get();
      documents[ref.path] = value.exists ? value.data() : null;
      for (const collection of await ref.listCollections()) {
        for (const child of await collection.listDocuments()) await visit(child);
      }
    }
    await visit(admin.db.doc('rooms/' + roomId));
    const authorization = await authorizationRef.get();
    const journal = await admin.db.doc('localDemoIdentityProvisioning/' + roomId).get();
    const users = {};
    for (const key of Object.keys(authorization.data()?.roles ?? {})) {
      const user = await admin.auth.getUser('dev-' + roomId + '-' + key.replace('/', '-'));
      // Login legitimately updates lastSignInTime/lastRefreshTime; assignments must not change.
      users[key] = { uid: user.uid, disabled: user.disabled, customClaims: user.customClaims,
        displayName: user.displayName, email: user.email, phoneNumber: user.phoneNumber,
        providerData: user.providerData, tokensValidAfterTime: user.tokensValidAfterTime,
        creationTime: user.metadata.creationTime };
    }
    return { authorization: authorization.data(), documents, journal: journal.data() ?? null, users };
  }
  async function login(key, staleVersions) {
    const authorization = (await authorizationRef.get()).data();
    check(isDeepStrictEqual(Object.keys(credentials).sort(), Object.keys(authorization?.roles ?? {}).sort()));
    const identity = await readLocalDemoAccess(admin, roomId, key, { env });
    const token = staleVersions
      ? await admin.auth.createCustomToken(identity.uid, { ...identity.claims, ...staleVersions })
      : await issueLocalDemoToken(admin, roomId, key, { env, credential: credentials[key] });
    const app = initializeApp({ projectId: env.GCLOUD_PROJECT, apiKey: 'demo-patterns-gups-key' }, 'revocation-' + randomUUID());
    const auth = getAuth(app);
    const db = getFirestore(app);
    const clientKey = staleVersions ? 'stale' : key;
    clients.set(clientKey, { app, auth, db });
    connectAuthEmulator(auth, 'http://' + env.FIREBASE_AUTH_EMULATOR_HOST, { disableWarnings: true });
    const [host, port] = env.FIRESTORE_EMULATOR_HOST.split(':');
    connectFirestoreEmulator(db, host, Number(port));
    await setPersistence(auth, inMemoryPersistence);
    const { user } = await signInWithCustomToken(auth, token);
    return (await getIdTokenResult(user)).claims;
  }
  return {
    snapshot, login,
    read: (key, path) => getDocFromServer(doc(clients.get(key).db, 'rooms/' + roomId + '/' + path)),
    writeControl: (key, value) => updateDoc(doc(clients.get(key).db, 'rooms/' + roomId + '/control/current'), { pausedRemaining: value }),
    async checkStalePresident(authorization) {
      await login('president', { roomAccessVersion: authorization.roomAccessVersion, accessVersion: authorization.roles.president.accessVersion + 1 });
      await denied(() => getDocFromServer(doc(clients.get('stale').db, 'rooms/' + roomId + '/control/current')));
    },
    presidentStillAuthenticated: async () => clients.get('president').auth.currentUser !== null,
    async checkPresidentTokenDenied() {
      try { await issueLocalDemoToken(admin, roomId, 'president', { env, credential: credentials.president }); }
      catch (error) { if (error?.code === 'DEMO_AUTHORIZATION_DENIED') return; fail(); }
      fail();
    },
    async revoke(before) {
      const guardedDb = { projectId: admin.db.projectId, doc: path => admin.db.doc(path),
        runTransaction: callback => admin.db.runTransaction(async tx => {
          const refs = Object.keys(before.documents).map(path => admin.db.doc(path));
          refs.push(admin.db.doc('localDemoIdentityProvisioning/' + roomId), authorizationRef);
          const values = await tx.getAll(...refs);
          const expected = [...Object.values(before.documents), before.journal, before.authorization];
          check(values.every((value, i) => isDeepStrictEqual(value.exists ? value.data() : null, expected[i])));
          return callback(tx);
        }) };
      await revokeLocalDemoAuthorization(guardedDb, roomId, 'president', { env });
    },
    async close() {
      for (const { app, db } of clients.values()) {
        try { await terminate(db); } finally { await deleteApp(app); }
      }
      try { await admin.db.terminate(); } finally { await deleteAdminApp(admin.app); }
    },
  };
}

export function parseRevocationArgs(args) {
  check(args.length === 2 || args.length === 3);
  check(args[0] === '--room' && /^demo-patterns-[a-f0-9]{24}$/.test(args[1] ?? ''));
  check(args.length === 2 || args[2] === '--execute');
  return { roomId: args[1], execute: args.length === 3 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let adapter;
  let stage = 'preflight';
  try {
    const options = parseRevocationArgs(process.argv.slice(2));
    validateAdminEnvironment(process.env);
    // Credentials are supplied as JSON on stdin, never arguments or output.
    let input = '';
    for await (const chunk of process.stdin) { input += chunk; check(input.length <= 4096); }
    const credentials = JSON.parse(input);
    check(credentials && typeof credentials === 'object' && !Array.isArray(credentials));
    check(Object.values(credentials).every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)));
    adapter = await realAdapter(options.roomId, credentials, process.env);
    stage = options.execute ? 'controlled_execution' : 'preflight';
    const result = await checkPresidentRevocation({ ...options, env: process.env, adapter });
    console.log(result.status);
  } catch {
    console.error('LOCAL_PRESIDENT_REVOCATION_CHECK_FAILED', { stage });
    process.exitCode = 1;
  } finally {
    if (adapter) {
      try { await adapter.close(); }
      catch { console.error('LOCAL_PRESIDENT_REVOCATION_CLEANUP_FAILED'); process.exitCode = 1; }
    }
  }
}
