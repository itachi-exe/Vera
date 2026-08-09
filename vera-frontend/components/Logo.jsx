/**
 * Vera mark — traced from the supplied logo bitmap. Vertices were recovered
 * from the source raster, not estimated. Inherits colour via currentColor.
 */
export function Mark({ size = 22, className }) {
  return (
    <svg
      viewBox="0 0 229 202"
      width={size}
      height={(size * 202) / 229}
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path d="M0 0 L84 0 L113 51.5 L88 51.5 L144.5 150 L116.5 202 Z" fill="currentColor" />
      <path d="M173 0 L228 0 L174 98.5 L117 98.5 Z" fill="currentColor" />
    </svg>
  );
}

export default function Logo({ size = 22 }) {
  return (
    <span className="logo">
      <Mark size={size} />
      <span className="logo-word">Vera</span>
    </span>
  );
}
