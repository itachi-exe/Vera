import Link from "next/link";
import DeviceMock from "./DeviceMock";

const STATS = [
  { k: "Up to 90% LTV", v: "Borrowing power scored on trust" },
  { k: "Non-custodial", v: "Your keys, your collateral, always" },
  { k: "CVI verified", v: "Identity proven, never disclosed" },
  { k: "CVA gated", v: "Compliance checked on every draw" },
];

/**
 * Section 1 — the reference's centred hero: display headline, subcopy, two
 * buttons, then four stat cards in a 2x2 flanking a centred device.
 *
 * Headline is an h2, not an h1. FilmHero renders above this one and is the
 * page's real title; two h1s gave screen-reader users navigating by heading two
 * competing answers to "what is this page". Styling is class-driven, so the
 * demotion is invisible.
 */
export default function Hero() {
  return (
    <section className="hero">
      <div className="container">
        <h2 className="serif hero-title reveal">
          Your reputation
          <br />
          <em className="hero-em">is collateral</em>.
        </h2>

        <p className="hero-lede reveal">
          Undercollateralized lending for wallets that can prove themselves.
        </p>

        <div className="hero-actions reveal">
          <Link href="/app" className="btn btn-primary">
            Start borrowing
            <span aria-hidden="true">→</span>
          </Link>
          <a href="#how" className="btn btn-secondary">
            See the trust score
          </a>
        </div>

        <div className="hero-grid">
          <div className="hero-col">
            {STATS.slice(0, 2).map((s) => (
              <div className="hero-stat reveal" key={s.k}>
                <h2 className="serif hero-stat-k">{s.k}</h2>
                <p className="hero-stat-v">{s.v}</p>
              </div>
            ))}
          </div>

          <div className="hero-device reveal">
            <DeviceMock variant="dashboard" />
          </div>

          <div className="hero-col">
            {STATS.slice(2).map((s) => (
              <div className="hero-stat reveal" key={s.k}>
                <h2 className="serif hero-stat-k">{s.k}</h2>
                <p className="hero-stat-v">{s.v}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
