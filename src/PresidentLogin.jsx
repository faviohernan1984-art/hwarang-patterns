import { useRef, useState } from 'react';
import { auth } from './firebase.js';
import { loginPresident, logoutPresident } from './presidentSession.js';
import { loginProductionRole } from './productionRoleSession.js';
import { requestProductionPasswordReset } from './productionPasswordReset.js';

export default function PresidentLogin({ logoutOnly = false }) {
  const production = import.meta.env.VITE_APP_ENV === 'production';
  const emailInput = useRef(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function login(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const path = await (production ? loginProductionRole(auth, email, password) : loginPresident(auth, email, password));
      window.location.replace(path);
    } catch {
      setMessage(production ? 'Acceso rechazado: verificá tus credenciales y la asignación de sala y rol.'
        : 'Acceso rechazado: verificá las credenciales y la asignación President.');
    } finally { setPassword(''); setBusy(false); }
  }
  async function logout() {
    setBusy(true);
    try {
      await logoutPresident(auth);
      setPassword('');
      setMessage('Sesión cerrada.');
    } catch { setMessage('No se pudo cerrar la sesión.'); }
    finally { setBusy(false); }
  }
  async function resetPassword() {
    // Validate only email: requesting a reset never requires the old password.
    if (!emailInput.current?.reportValidity()) return;
    setBusy(true);
    setMessage('');
    setPassword('');
    try {
      setMessage(await requestProductionPasswordReset(auth, email));
    } catch {
      setMessage('No se pudo procesar la solicitud. Verificá el correo e intentá nuevamente.');
    } finally { setBusy(false); }
  }
  return <main style={{ padding: 24 }}>
    <h1>{logoutOnly ? 'Cerrar sesión' : production ? 'Acceso Patterns' : 'Acceso President'}</h1>
    {!logoutOnly && <form onSubmit={login}>
      <p><label>Email <input ref={emailInput} type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} disabled={busy} /></label></p>
      <p><label>Contraseña <input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /></label></p>
      <button type="submit" disabled={busy}>Entrar</button>
      {production && <p><button type="button" onClick={resetPassword} disabled={busy}>Olvidé mi contraseña</button></p>}
    </form>}
    <p><button type="button" onClick={logout} disabled={busy}>Cerrar sesión</button></p>
    {logoutOnly && <a href="/login">Ir al login</a>}
    <p role="status">{message}</p>
  </main>;
}
