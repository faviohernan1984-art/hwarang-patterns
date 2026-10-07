/* global process */
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { deleteApp } from 'firebase-admin/app';
import { localAdmin, validateAdminEnvironment } from './localAdmin.js';
import { validateProvisionInput } from './provisionPresident.js';

export async function initializePresidentPassword(email, password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128 || /[\r\n\0]/.test(password)) throw new Error('PASSWORD_LENGTH_12_TO_128_REQUIRED');
  const { app, auth, db } = localAdmin();
  try {
    const user = await auth.getUserByEmail(email);
    const claims = user.customClaims ?? {};
    validateProvisionInput({ roomId: claims.roomId, email });
    if (user.disabled || claims.role !== 'president' || Object.keys(claims).length !== 2) throw new Error('INVALID_PRESIDENT_ASSIGNMENT');
    const journal = db.doc('_localRoomProvisioning/' + claims.roomId);
    const planned = await journal.get();
    if (!planned.exists || planned.data().uid !== user.uid || planned.data().status !== 'complete') throw new Error('PROVISION_PRESIDENT_FIRST');
    if (planned.data().credentialInitialized) throw new Error('CREDENTIAL_ALREADY_INITIALIZED');
    const docs = await db.getAll(...['control','meta','publicState'].map(name => db.doc('rooms/' + claims.roomId + '/' + name + '/current')));
    if (docs.some(d => !d.exists)) throw new Error('INCOMPLETE_ROOM');
    // Trusted local operator only. No password, tokens or email are logged.
    await auth.updateUser(user.uid, { password });
    await journal.update({ credentialInitialized: true });
    return { roomId: claims.roomId, initialized: true };
  } finally { await db.terminate(); await deleteApp(app); }
}

async function secretPrompt(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('INTERACTIVE_TERMINAL_REQUIRED');
  const output = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  process.stdout.write(label);
  try {
    return await new Promise((resolve, reject) => {
      rl.once('SIGINT', () => reject(new Error('CANCELLED')));
      rl.question('', resolve);
    });
  } finally { rl.close(); process.stdout.write('\n'); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  (async () => {
    validateAdminEnvironment(process.env);
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--email') throw new Error('Usage: --email PRESIDENT_EMAIL');
    const email = args[1];
    // Check syntax before asking for a secret; Room authority is resolved from claims later.
    validateProvisionInput({ roomId: 'validation', email });
    const password = await secretPrompt('Contrase?a local (12-128 caracteres, entrada oculta): ');
    if (password !== await secretPrompt('Repetir contrase?a: ')) throw new Error('PASSWORD_MISMATCH');
    console.log(JSON.stringify(await initializePresidentPassword(email, password)));
  })().catch(error => { console.error(error.code ?? error.message); process.exitCode = 1; });
}
