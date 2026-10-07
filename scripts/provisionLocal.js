/* global process */
import { pathToFileURL } from 'node:url';
import { deleteApp } from 'firebase-admin/app';
import { localAdmin, PRESIDENT_UID, PRESIDENT_CLAIMS, DEV_IDENTITIES } from './localAdmin.js';
import { initialRoomDocuments } from './roomDefaults.js';

export async function provisionLocalRoom() {
  const { app, auth, db } = localAdmin();
  try {
    const initial = initialRoomDocuments();
    const refs = ['control', 'meta', 'publicState'].map(name => db.doc('rooms/A/' + name + '/current'));
    // Idempotent: preserve an existing session; reject partial provisioning instead of resetting it.
    const created = await db.runTransaction(async transaction => {
      const docs = await transaction.getAll(...refs);
      if (docs.every(doc => doc.exists)) return false;
      if (docs.some(doc => doc.exists)) throw new Error('Room A is partially provisioned; inspect it before retrying');
      initial.forEach((data, index) => transaction.create(refs[index], data));
      return true;
    });
    for (const [key, identity] of Object.entries(DEV_IDENTITIES)) {
      try {
        await auth.getUser(identity.uid);
      } catch (error) {
        if (error.code !== 'auth/user-not-found') throw error;
        await auth.createUser({ uid: identity.uid, displayName: 'DEV ' + key + ' Room A' });
      }
      await auth.setCustomUserClaims(identity.uid, identity.claims);
    }
    return { projectId: app.options.projectId, roomId: 'A', uid: PRESIDENT_UID, claims: PRESIDENT_CLAIMS, identities: DEV_IDENTITIES, created };
  } finally {
    await db.terminate();
    await deleteApp(app);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  provisionLocalRoom().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
