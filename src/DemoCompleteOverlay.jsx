import { createPortal } from "react-dom";
import "./DemoCompleteOverlay.css";

export default function DemoCompleteOverlay({ onClose }) {
  return createPortal(
    <div className="patterns-demo-complete" role="dialog" aria-modal="true" aria-labelledby="patterns-demo-complete-title">
      <div className="patterns-demo-complete__card">
        <p>HWARANG SCORING UNIVERSE®</p>
        <h2 id="patterns-demo-complete-title">DEMO COMPLETE</h2>
        <p>Your 25 demo match credits have been used.</p>
        <a href="https://www.hwarangscoring.org/license-patterns">ACCESS LICENSE</a>
        <button type="button" onClick={onClose}>CLOSE</button>
      </div>
    </div>,
    document.body
  );
}

