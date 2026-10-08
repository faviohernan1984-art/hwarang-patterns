/* global process */
import { pathToFileURL } from 'node:url';
import { deleteApp } from 'firebase-admin/app';
import { productionAdmin, validateProductionEnvironment } from './productionAdmin.js';
import { validateProvisionInput, provisionPresidentWithAdmin } from './presidentProvisioning.js';

export function parseProductionProvisionArgs(args) {
  if (args.length !== 7 || args[0] !== '--apply' || args[1] !== '--project' || args[3] !== '--room' || args[5] !== '--email') throw new Error('INVALID_PRODUCTION_ARGUMENTS');
  return { projectId: args[2], apply: true, ...validateProvisionInput({ roomId: args[4], email: args[6] }) };
}

export async function provisionProductionPresident(input, env = process.env) {
  if (!input || Object.keys(input).some(key => !['projectId', 'apply', 'roomId', 'email'].includes(key))) throw new Error('INVALID_PRODUCTION_ARGUMENTS');
  validateProductionEnvironment(input.projectId, input.apply, env);
  const validated = validateProvisionInput({ roomId: input.roomId, email: input.email });
  const { app, auth, db } = productionAdmin(input.projectId, input.apply);
  try {
    return await provisionPresidentWithAdmin(validated, {
      auth, db, projectId: app.options.projectId,
      assignmentCollection: '_presidentAssignments', journalCollection: '_roomProvisioning',
    });
  } finally {
    try { await db.terminate(); } finally { await deleteApp(app); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(() => provisionProductionPresident(parseProductionProvisionArgs(process.argv.slice(2))))
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => {
      // Never log SDK messages, stacks, credential paths or secret contents.
      const code = error.code ?? error.message;
      console.error(typeof code === 'string' && /^(?:[A-Z][A-Z_]+|auth\/[a-z-]+)$/.test(code) ? code : 'PRODUCTION_PROVISION_FAILED');
      process.exitCode = 1;
    });
}
