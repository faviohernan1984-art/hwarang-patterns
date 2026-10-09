/* global process */
import { pathToFileURL } from 'node:url';
import { deleteApp } from 'firebase-admin/app';
import { localAdmin, validateAdminEnvironment } from './localAdmin.js';
import { validDemoSessionId } from '../src/demoMatchCredits.js';

const SESSION_ID = 'local-room-A-demo';

// Fixed local ID: repeating the command can never grant a new set of credits.
export async function assignLocalDemoSession(db, env = process.env) {
  validateAdminEnvironment(env);
  const refs = ['control', 'meta', 'publicState'].map(name => db.doc('rooms/A/' + name + '/current'));
  const ledger = db.doc('rooms/A/demoSessions/' + SESSION_ID);
  return db.runTransaction(async transaction => {
    const [control, meta, publicState, credits] = await transaction.getAll(...refs, ledger);
    if (![control, meta, publicState].every(snapshot => snapshot.exists)) {
      throw new Error('Provision complete Room A first; no data was changed');
    }
    const data = meta.data();
    if (Object.hasOwn(data, 'demoSessionId')) {
      const sessionId = validDemoSessionId(data.demoSessionId);
      if (!sessionId) throw new Error('Existing DEMO assignment is invalid; inspect it without resetting credits');
      return { roomId: 'A', sessionId, created: false };
    }
    if (credits.exists) throw new Error('Unassigned local DEMO ledger already exists; inspect it without resetting credits');
    transaction.create(ledger, { sessionId: SESSION_ID, consumedEvaluationIds: [], confirmedCount: 0 });
    transaction.update(refs[1], { demoSessionId: SESSION_ID });
    return { roomId: 'A', sessionId: SESSION_ID, created: true };
  });
}

export async function activateLocalDemo() {
  const { app, db } = localAdmin();
  try {
    const result = await assignLocalDemoSession(db);
    return { projectId: app.options.projectId, ...result };
  } finally {
    await db.terminate();
    await deleteApp(app);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  activateLocalDemo().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
