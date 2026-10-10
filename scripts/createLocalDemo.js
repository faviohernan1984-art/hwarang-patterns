/* global process */
import { pathToFileURL } from 'node:url';
import { deleteApp } from 'firebase-admin/app';
import { localAdmin } from './localAdmin.js';
import { allocateLocalDemo } from './localDemoProvisioning.js';
import { provisionLocalDemoIdentities } from './localDemoIdentities.js';
import { authorizeLocalDemo, createLocalDemoAuthorization } from './localDemoAuthorization.js';

// Local API entry: recovery requires the President credential before any provisioning.
export async function createLocalDemo(requestedRoomId = null, {
  dispose = true, credential, env = process.env,
  adminFactory = localAdmin, allocate = allocateLocalDemo, provision = provisionLocalDemoIdentities,
} = {}) {
  const { app, auth, db } = adminFactory();
  try {
    if (requestedRoomId != null) await authorizeLocalDemo(db, requestedRoomId, 'president', credential, { env });
    const room = await allocate(db, requestedRoomId, { env });
    try {
      const { identities } = await provision({ auth, db }, room.roomId, { env });
      const credentials = room.created ? await createLocalDemoAuthorization(db, room.roomId, Object.keys(identities), { env }) : undefined;
      return { projectId: app.options.projectId, ...room, identities, ...(credentials ? { credentials } : {}) };
    } catch (error) {
      throw new Error(error.message + '; retry: node scripts/createLocalDemo.js ' + room.roomId, { cause: error });
    }
  } finally {
    if (dispose) {
      try { await db.terminate(); }
      finally { await deleteApp(app); }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // stdout must never contain credentials; the no-store HTTP response owns delivery.
  console.error('Use the loopback POST /api/create-demo endpoint; credential delivery through CLI is disabled.');
  process.exitCode = 1;
}
