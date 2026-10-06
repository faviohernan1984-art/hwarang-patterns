
// Separate DEV entry; never imported by the operational app or production build.
if (!import.meta.env.DEV) throw new Error('DEV entry is unavailable');
const button = document.getElementById('login');
const status = document.getElementById('status');
button.addEventListener('click', async () => {
  button.disabled = true;
  status.textContent = 'Iniciando sesión DEV…';
  try {
    // Bind the button before loading Firebase so import/init failures are visible.
    const { setPersistence, browserSessionPersistence, signInWithCustomToken, getIdTokenResult, signOut } = await import('firebase/auth');
    const { auth } = await import('./firebase.js');
    await setPersistence(auth, browserSessionPersistence);
    const response = await fetch('/__dev/' + button.dataset.key + '/token', { method: 'POST' });
    if (!response.ok) throw new Error(await response.text() || 'DEV login unavailable.');
    const { token } = await response.json();
    const session = await signInWithCustomToken(auth, token);
    const { claims } = await getIdTokenResult(session.user, true);
    if (claims.roomId !== 'A' || claims.role !== button.dataset.role || (button.dataset.role === 'judge' && claims.judgeId !== Number(button.dataset.judgeId))) {
      await signOut(auth);
      throw new Error('Identidad DEV incorrecta.');
    }
    window.location.assign('/rooms/A/' + button.dataset.key);
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  }
});

button.disabled = false;
status.textContent = '';
