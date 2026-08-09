import { ImageResponse } from "next/og";

/*
 * The card that renders when a Vera link is pasted into Slack, Discord, or X.
 *
 * Generated rather than shipped as a bitmap so it stays in step with the brand
 * tokens instead of becoming a stale export nobody remembers to redo. `next/og`
 * is part of Next itself, so this adds no dependency.
 *
 * Serves as the Twitter card too — `twitter.images` in layout.js points here
 * rather than duplicating the file.
 */

export const alt = "Vera — trust-based lending. Verified identity sets your borrowing power.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Duplicated from globals.css. The satori renderer behind ImageResponse resolves
// no cascade and no custom properties, so a `var(--bg)` here would render as
// nothing; these four have to be literals.
const BG = "#0c0f0a";
const TEXT = "#eef2ea";
const MUTED = "#a8b0a2";
const ACCENT = "#6cc09c";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: BG,
          padding: "72px 80px",
          // No webfont is loaded: fetching Fraunces at render time would make
          // the card fail closed on a network blip, and the fallback stack is
          // close enough at this size. Better a plain card than no card.
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg width="52" height="46" viewBox="0 0 229 202" fill={ACCENT}>
            <path d="M0 0 L84 0 L113 51.5 L88 51.5 L144.5 150 L116.5 202 Z" />
            <path d="M173 0 L228 0 L174 98.5 L117 98.5 Z" />
          </svg>
          <div style={{ fontSize: 34, color: TEXT, letterSpacing: "-0.02em" }}>Vera</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontSize: 82,
              lineHeight: 1.04,
              color: TEXT,
              letterSpacing: "-0.035em",
              maxWidth: 900,
            }}
          >
            Borrow against who you are
          </div>
          <div style={{ fontSize: 32, color: MUTED, maxWidth: 820, lineHeight: 1.35 }}>
            Verified identity and on-chain compliance set your borrowing power, not collateral
            alone.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 24, color: MUTED }}>
          <div style={{ color: ACCENT }}>Monad</div>
          <div>·</div>
          <div>Cleanverse CVI + CVA</div>
        </div>
      </div>
    ),
    size
  );
}
