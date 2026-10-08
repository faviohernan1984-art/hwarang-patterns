/* global process */
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { deleteApp } from 'firebase-admin/app';
import { productionAdmin, validateProductionEnvironment, PRODUCTION_PROJECT_ID } from './productionAdmin.js';
import { validateProvisionInput } from './presidentProvisioning.js';

export function parseProductionPasswordArgs(args) {
  if (args.length !== 5 || args[0] !== '--apply' || args[1] !== '--project' || args[3] !== '--email') throw new Error('INVALID_PASSWORD_ARGUMENTS');
  const { email } = validateProvisionInput({ roomId: 'validation', email: args[4] });
  return { apply: true, projectId: args[2], email };
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128 || [...password].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new Error('INVALID_PASSWORD');
}

function presidentRoom(user, email) {
  const claims = user.customClaims ?? {};
  if (user.disabled || user.email?.toLowerCase() !== email || claims.role !== 'president' || Object.keys(claims).length !== 2) throw new Error('INVALID_PRESIDENT_ASSIGNMENT');
  return validateProvisionInput({ roomId: claims.roomId, email }).roomId;
}

// This core accepts trusted Admin stubs for offline tests; it performs no initialization.
export async function updateProvisionedPresidentPassword(email, password, { auth, db, projectId }) {
  if (projectId !== PRODUCTION_PROJECT_ID) throw new Error('PRODUCTION_PROJECT_NOT_APPROVED');
  const normalized = validateProvisionInput({ roomId: 'validation', email }).email;
  validatePassword(password);
  const user = await auth.getUserByEmail(normalized);
  const roomId = presidentRoom(user, normalized);
  const paths = ['control', 'meta', 'publicState'].map(name => 'rooms/' + roomId + '/' + name + '/current');
  const assignment = '_presidentAssignments/' + createHash('sha256').update(user.uid).digest('hex');
  const [journal, assigned, ...roomDocs] = await db.getAll(db.doc('_roomProvisioning/' + roomId), db.doc(assignment), ...paths.map(path => db.doc(path)));
  if (!journal.exists || journal.data().uid !== user.uid || journal.data().version !== 1 || journal.data().status !== 'complete') throw new Error('PROVISION_PRESIDENT_FIRST');
  if (!assigned.exists || assigned.data().roomId !== roomId || assigned.data().role !== 'president') throw new Error('INVALID_PRESIDENT_ASSIGNMENT');
  if (roomDocs.some(document => !document.exists)) throw new Error('INCOMPLETE_ROOM');
  // Recheck identity immediately before updating Auth; never create users or edit claims.
  const current = await auth.getUser(user.uid);
  if (current.uid !== user.uid || presidentRoom(current, normalized) !== roomId) throw new Error('PRESIDENT_ASSIGNMENT_CHANGED');
  await auth.updateUser(user.uid, { password });
  return { projectId, roomId, passwordUpdated: true };
}

export async function updateProductionPresidentPassword(input, password) {
  if (!input || Object.keys(input).some(key => !['projectId', 'apply', 'email'].includes(key))) throw new Error('INVALID_PASSWORD_ARGUMENTS');
  validateProductionEnvironment(input.projectId, input.apply, process.env);
  const { email } = validateProvisionInput({ roomId: 'validation', email: input.email });
  validatePassword(password);
  const { app, auth, db } = productionAdmin(input.projectId, input.apply);
  try {
    return await updateProvisionedPresidentPassword(email, password, { auth, db, projectId: app.options.projectId });
  } finally {
    try { await db.terminate(); } finally { await deleteApp(app); }
  }
}

export async function hiddenPasswordPrompt(label, input = process.stdin, output = process.stdout) {
  if (!input.isTTY || !output.isTTY) throw new Error('INTERACTIVE_TERMINAL_REQUIRED');
  const sink = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const rl = createInterface({ input, output: sink, terminal: true });
  output.write(label);
  try {
    return await new Promise((resolve, reject) => {
      rl.once('SIGINT', () => reject(new Error('CANCELLED')));
      rl.once('close', () => reject(new Error('CANCELLED')));
      rl.question('', resolve);
    });
  } finally { rl.close(); sink.end(); output.write('\n'); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  (async () => {
    const input = parseProductionPasswordArgs(process.argv.slice(2));
    validateProductionEnvironment(input.projectId, input.apply, process.env);
    let password = await hiddenPasswordPrompt('Nueva contrasena (12-128 caracteres, entrada oculta): ');
    try {
      validatePassword(password);
      let confirmation = await hiddenPasswordPrompt('Repetir contrasena: ');
      const matches = password === confirmation;
      confirmation = undefined;
      if (!matches) throw new Error('PASSWORD_MISMATCH');
      console.log(JSON.stringify(await updateProductionPresidentPassword(input, password)));
    } finally { password = undefined; }
  })().catch(() => { console.error('PRODUCTION_PASSWORD_UPDATE_FAILED'); process.exitCode = 1; });
}
