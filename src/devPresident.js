import { signInWithCustomToken, getIdTokenResult, signOut } from 'firebase/auth';
import { auth } from './firebase.js';

// Separate DEV entry; never imported by the operational app or production build.
if (!import.meta.env.DEV) throw new Error('DEV entry is unavailable');
const button = document.getElementById('login');
const status = document.getElementById('status');
button.addEventListener('click', async () => {
  button.disabled = true;
  status.textContent = 'Iniciando sesión DEV…';
  try {
    const response = await fetch('/__dev/president/token', { method: 'POST' });
    if (!response.ok) throw new Error('Provisioná Room A y verificá los emuladores.');
    const { token } = await response.json();
    const session = await signInWithCustomToken(auth, token);
    const { claims } = await getIdTokenResult(session.user, true);
    if (claims.roomId !== 'A' || claims.role !== 'president') {
      await signOut(auth);
      throw new Error('Identidad DEV incorrecta.');
    }
    window.location.assign('/rooms/A/president');
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  }
});
