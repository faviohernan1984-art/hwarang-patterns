import "./HwarangAnimatedIsotype.css";

export default function HwarangAnimatedIsotype({
  size = 52,
  label = "Hwarang Scoring Universe",
  showLabel = false,
}) {
  return (
    <div className="hwarang-animated-isotype" style={{ "--hwarang-isotype-size": `${size}px` }} aria-label={label}>
      <span className="hwarang-animated-isotype__symbol" aria-hidden="true">
        <span className="hwarang-animated-isotype__ring" />
        <span className="hwarang-animated-isotype__letter">H</span>
      </span>
      {showLabel && <span className="hwarang-animated-isotype__label">HWARANG SCORING UNIVERSE™</span>}
    </div>
  );
}
