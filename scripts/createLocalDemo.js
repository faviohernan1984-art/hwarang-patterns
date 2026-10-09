/* global process */
import { pathToFileURL } from 'node:url';
import { deleteApp } from 'firebase-admin/app';
import { localAdmin } from './localAdmin.js';
import { allocateLocalDemo } from './localDemoProvisioning.js';
import { provisionLocalDemoIdentities } from './localDemoIdentities.js';

// Administrative local entry only. Room and Auth provisioning can be retried by room ID.
export async function createLocalDemo(requestedRoomId = null, { dispose = true } = {}) {
  const { app, auth, db } = localAdmin();
  try {
    const room = await allocateLocalDemo(db, requestedRoomId);
    try {
      const { identities } = await provisionLocalDemoIdentities({ auth, db }, room.roomId);
      return { projectId: app.options.projectId, ...room, identities };
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
  if (process.argv.length > 3) {
    console.error('Usage: node scripts/createLocalDemo.js [existing-demo-room-id]');
    process.exitCode = 1;
  } else {
    createLocalDemo(process.argv[2] ?? null)
      .then(result => console.log(JSON.stringify(result, null, 2)))
      .catch(error => { console.error(error.message); process.exitCode = 1; });
  }
}
