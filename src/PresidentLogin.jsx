import { useState } from 'react';
import { auth } from './firebase.js';
import { loginPresident, logoutPresident } from './presidentSession.js';

export default function PresidentLogin({ logoutOnly = false }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function login(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const path = await loginPresident(auth, email, password);
      window.location.replace(path);
    } catch {
      setMessage('Acceso rechazado: verificá las credenciales y la asignación President.');
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
  return <main style={{ padding: 24 }}>
    <h1>{logoutOnly ? 'Cerrar sesión' : 'Acceso President'}</h1>
    {!logoutOnly && <form onSubmit={login}>
      <p><label>Email <input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} disabled={busy} /></label></p>
      <p><label>Contraseña <input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /></label></p>
      <button type="submit" disabled={busy}>Entrar</button>
    </form>}
    <p><button type="button" onClick={logout} disabled={busy}>Cerrar sesión</button></p>
    {logoutOnly && <a href="/login">Ir al login</a>}
    <p role="status">{message}</p>
  </main>;
}
