/* global process */
import { pathToFileURL } from 'node:url';
import { deleteApp } from 'firebase-admin/app';
import { productionAdmin, validateProductionEnvironment } from './productionAdmin.js';
import { validateProductionRoleInput, provisionProductionRolesWithAdmin } from './productionRoleProvisioning.js';

export function parseProductionRoleArgs(args) {
  if (args.length !== 5 || args[0] !== '--apply' || args[1] !== '--project' || args[3] !== '--room') throw new Error('INVALID_ROLE_ARGUMENTS');
  return { projectId: args[2], apply: true, roomId: args[4] };
}

export async function provisionProductionRoles(input, env = process.env) {
  if (!input || Object.keys(input).some(key => !['projectId', 'apply', 'roomId', 'roles'].includes(key))) throw new Error('INVALID_ROLE_ARGUMENTS');
  validateProductionEnvironment(input.projectId, input.apply, env);
  const validated = validateProductionRoleInput({ projectId: input.projectId, roomId: input.roomId, roles: input.roles });
  const { app, auth, db } = productionAdmin(input.projectId, input.apply);
  try { return await provisionProductionRolesWithAdmin(validated, { auth, db, projectId: app.options.projectId }); }
  finally { try { await db.terminate(); } finally { await deleteApp(app); } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(async () => {
    const args = parseProductionRoleArgs(process.argv.slice(2));
    validateProductionEnvironment(args.projectId, args.apply, process.env);
    let text = '';
    for await (const chunk of process.stdin) { text += chunk; if (text.length > 4096) throw new Error('INVALID_ROLE_INPUT'); }
    const roles = JSON.parse(text);
    return provisionProductionRoles({ ...args, roles });
  }).then(result => console.log(JSON.stringify(result)))
    .catch(() => { console.error('PRODUCTION_ROLE_PROVISION_FAILED'); process.exitCode = 1; });
}
