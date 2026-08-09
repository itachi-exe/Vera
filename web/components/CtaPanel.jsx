import Link from "next/link";
/** Section 10 — the reference's full-width mint panel with dark type. */
export default function CtaPanel() {
  return (
    <section id="demo" className="cta">
      <div className="container">
        <div className="cta-panel reveal">
          <h2 className="serif cta-title">
            Your credit line is
            <br />
            <em>one proof</em> away.
          </h2>

          <p className="cta-lede">
            Connect a wallet, verify once, and see what your reputation is worth. Testnet
            assets, real contracts.
          </p>

          <div className="cta-actions">
            <Link href="/app" className="btn btn-on-accent">
              Open the app
            </Link>
            <a href="#how" className="btn btn-on-accent ghost">
              How it works
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
