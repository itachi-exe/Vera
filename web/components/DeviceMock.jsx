/**
 * The phone mockups on the landing page.
 *
 * These used to be hand-written HTML approximations of the product — a fake
 * balance, fake positions, fake hashes. They are now real screenshots of the app
 * running in demo mode, captured at a 390x711 phone viewport, so what the
 * landing page shows is exactly what /app renders.
 *
 * The device chrome is still drawn in CSS — frame, notch, and the 9:41 status
 * row — so only the app screen itself is an image. Recapture with
 * `node scripts/shots.mjs` against a local build after any app UI change, or
 * these drift out of date with the product they are advertising.
 */
const SHOTS = {
  dashboard: {
    src: "/shots/app-home.png",
    alt: "The Vera app on a phone: net position, borrowing power against a credit line, collateral, and the amount available to draw.",
  },
  record: {
    src: "/shots/app-record.png",
    alt: "The Vera app on a phone: liquidation terms above an on-chain record of every draw, supply, and attestation.",
  },
  ask: {
    src: "/shots/app-borrow.png",
    alt: "The Vera app on a phone: a draw being priced, with health factor, debt, and credit line used shown before and after.",
  },
};

export default function DeviceMock({ variant = "dashboard" }) {
  const shot = SHOTS[variant] || SHOTS.dashboard;

  return (
    <div className={`device device-${variant}`}>
      <div className="device-frame">
        <div className="device-notch" aria-hidden="true" />
        <div className="device-screen">
          <div className="device-status" aria-hidden="true">
            <span>9:41</span>
            <span className="device-status-r">
              <i />
              <i />
              <i />
            </span>
          </div>

          <img
            className="dev-shot"
            src={shot.src}
            alt={shot.alt}
            width={780}
            height={1422}
            loading="lazy"
            decoding="async"
          />
        </div>
      </div>
    </div>
  );
}
