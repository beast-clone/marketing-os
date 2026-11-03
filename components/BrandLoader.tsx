import type { CSSProperties } from "react";

// The dashboard's loader (Praveen picked "A · Orbit ring", 3 Nov 2026 — prototype
// docs/loader-prototype/v1.html): the Marketing OS "M" with a blue arc running round
// it. Styles + keyframes live in app/globals.css (.brand-loader).
export function BrandLoader({
  size = 30,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  const style = { "--bl": `${size}px` } as CSSProperties;
  return (
    <span className={`brand-loader ${className}`} style={style} role="status" aria-label="Loading">
      <i />
    </span>
  );
}
