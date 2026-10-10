import { useEffect, useState } from 'react';
import { authenticateLocalDemoRoute, demoRouteKey } from './localDemoAccess.js';

export default function DemoAccessGate({ auth, route, children }) {
  const [state, setState] = useState('checking');
  const [credential, setCredential] = useState('');
  const key = demoRouteKey(route);
  const { roomId, role, judgeId } = route;
  useEffect(() => {
    let cancelled = false;
    authenticateLocalDemoRoute(auth, { valid: true, roomId, role, judgeId }, { storage: window.sessionStorage })
      .then(() => { if (!cancelled) setState('allowed'); })
      .catch(() => { if (!cancelled) setState('denied'); });
    return () => { cancelled = true; };
  }, [auth, roomId, role, judgeId]);

  async function enter(event) {
    event.preventDefault();
    setState('checking');
    const submitted = credential.trim();
    setCredential('');
    try {
      await authenticateLocalDemoRoute(auth, route, { storage: window.sessionStorage, credential: submitted });
      setState('allowed');
    } catch { setState('denied'); }
  }
  if (state === 'allowed') return children;
  return <main style={{ minHeight: '100vh', background: '#020617', color: '#e2e8f0', display: 'grid', placeContent: 'center', padding: 24 }}>
    <h1>{state === 'checking' ? 'VERIFYING ACCESS' : 'ACCESS DENIED'}</h1>
    {state !== 'checking' && <form onSubmit={enter}>
      <p role="alert">Enter the credential provided separately for {key.toUpperCase()}.</p>
      <label htmlFor="demo-credential">DEMO credential</label>
      <input id="demo-credential" type="password" autoComplete="off" value={credential} onChange={event => setCredential(event.target.value)} required />
      <button type="submit">ENTER</button>
    </form>}
  </main>;
}
