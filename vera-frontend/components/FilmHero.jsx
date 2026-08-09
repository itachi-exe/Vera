import Link from "next/link";
import { Mark } from "./Logo";
import HeroVideo from "./HeroVideo";

/**
 * Section 0 — the reference's full-bleed film hero (900px). No video asset
 * yet, so the backdrop is a layered gradient standing in for the plate.
 */
export default function FilmHero() {
  return (
    <section id="top" className="film">
      {/* Gradient plate stays as the base layer: it is the mobile treatment,
          and on desktop it is the fallback if the video never paints. */}
      <div className="film-plate" aria-hidden="true">
        <span className="film-sun" />
        <span className="film-horizon" />
        <span className="film-vignette" />
      </div>

      <HeroVideo />

      <div className="container film-inner">
        <p className="eyebrow film-eyebrow reveal">
          <Mark size={12} />
          Trust-based lending, on Monad
        </p>

        <h1 className="serif film-title reveal">
          Borrow on <em>trust</em>,<br />
          not just collateral.
        </h1>

        <p className="film-lede reveal">
          Vera turns verified identity into borrowing power. Prove who you are once,
          get a credit line priced to your reputation, settled on-chain.
        </p>

        <div className="film-actions reveal">
          <Link href="/app" className="btn btn-glass">
            Open the app
            <span aria-hidden="true">→</span>
          </Link>
          <a href="#how" className="btn btn-glass">
            <span aria-hidden="true">▷</span>
            How it works
          </a>
        </div>
      </div>
    </section>
  );
}
