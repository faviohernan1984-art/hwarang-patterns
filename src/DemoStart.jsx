import { useState } from 'react';
import { requestLocalDemo } from './localDemoAccess.js';

export default function DemoStart() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function start() {
    setBusy(true); setError('');
    try { window.location.assign(await requestLocalDemo({ storage: window.localStorage })); }
    catch { setError('DEMO temporarily unavailable. Please try again.'); setBusy(false); }
  }
  return <main style={{ minHeight: '100vh', background: '#020617', color: '#e2e8f0', display: 'grid', placeContent: 'center', textAlign: 'center', padding: 24 }}>
    <p style={{ color: '#60a5fa' }}>HWARANG SCORING UNIVERSE®</p>
    <h1>PATTERNS GUP PRO</h1><p>DEMO · 25 decisions</p>
    <button disabled={busy} onClick={start} style={{ background: '#2563eb', color: 'white', border: 0, borderRadius: 10, padding: '16px 32px', fontWeight: 800 }}>{busy ? 'Preparing DEMO…' : 'START DEMO'}</button>
    {error && <p role="alert">{error}</p>}
  </main>;
}
