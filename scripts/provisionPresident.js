/* global process */
import { pathToFileURL } from 'node:url';
import { deleteApp } from 'firebase-admin/app';
import { localAdmin } from './localAdmin.js';
import { validateProvisionInput, provisionPresidentWithAdmin } from './presidentProvisioning.js';
export { validateProvisionInput } from './presidentProvisioning.js';

export async function provisionPresident(input) {
  const validated = validateProvisionInput(input);
  const { app, auth, db } = localAdmin();
  try {
    return await provisionPresidentWithAdmin(validated, {
      auth, db, projectId: app.options.projectId,
      assignmentCollection: '_localPresidentAssignments', journalCollection: '_localRoomProvisioning',
    });
  } finally {
    try { await db.terminate(); } finally { await deleteApp(app); }
  }
}

export function parseProvisionArgs(args) {
  if (args.length !== 4 || args[0] !== '--room' || args[2] !== '--email') throw new Error('Usage: --room ROOM_ID --email PRESIDENT_EMAIL');
  return validateProvisionInput({ roomId: args[1], email: args[3] });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(() => provisionPresident(parseProvisionArgs(process.argv.slice(2))))
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error.code ?? error.message); process.exitCode = 1; });
}
