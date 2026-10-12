import { sendPasswordResetEmail } from 'firebase/auth';
import { resolveFirebaseEnvironment } from './firebaseConfig.js';
import { validatePresidentAuthEnvironment } from './presidentSession.js';

export const PASSWORD_RESET_CONFIRMATION = 'Si corresponde, recibirás un correo con instrucciones para restablecer tu contraseña.';

export async function requestProductionPasswordReset(auth, email, {
  source = import.meta.env ?? globalThis.process?.env,
  sdk = { sendPasswordResetEmail },
} = {}) {
  validatePresidentAuthEnvironment(auth, source);
  if (resolveFirebaseEnvironment(source).environment !== 'production') throw new Error('PRODUCTION_AUTH_REQUIRED');
  const normalized = typeof email === 'string' ? email.trim() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) throw new Error('INVALID_RESET_EMAIL');
  try {
    // No account lookup, custom redirect or user-supplied action URL.
    await sdk.sendPasswordResetEmail(auth, normalized);
  } catch {
    // Identical public result for missing accounts and all other SDK failures.
    // This acknowledgement does not certify email delivery.
  }
  return PASSWORD_RESET_CONFIRMATION;
}
