import './DemoWatermark.css';

// Combat renders the same institutional ticker for President, Public and Judges.
export default function DemoWatermark({ role }) {
  const brand = 'HWARANG SCORING UNIVERSE';
  const message = ' · DEMO MODE · THIS SPACE IS RESERVED FOR SPONSORS & EVENT ADVERTISING · PROFESSIONAL LICENSE REQUIRED · WWW.HWARANGSCORING.ORG';
  const text = role === 'judge'
    ? <>{brand}<sup style={{ fontSize: '0.42em', lineHeight: 0, marginLeft: '0.08em' }}>®</sup>{message}</>
    : brand + '®' + message;
  return <aside className="patterns-demo-watermark" aria-label="DEMO MODE">
    <div className="patterns-demo-watermark__ticker"><span>{text}</span></div>
  </aside>;
}
