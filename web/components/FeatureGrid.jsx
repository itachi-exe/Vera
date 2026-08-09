const WEIGHTS = [
  { k: "Identity (CVI)", v: "30%", tone: "up" },
  { k: "On-chain history", v: "45%", tone: "up" },
  { k: "Repayment record", v: "25%", tone: "up" },
];

/**
 * Section 7 — the reference's 2x2 feature grid. Bottom-right cell holds the
 * oversized mint numeric callout (their "25 bps").
 */
export default function FeatureGrid() {
  return (
    <section id="features" className="sec">
      <div className="container">
        <h2 className="serif lg feat-title reveal">
          Built for your first draw,
          <br />
          and your <em>hundredth</em>.
        </h2>

        <div className="feat-grid">
          <div className="feat-cell reveal">
            <h3>Lending without the jargon</h3>
            <p>
              Say what you need. Vera answers with a number, a rate, and the liquidation
              price, in plain words.
            </p>
            <span className="feat-pill">Trust 812 · LTV 78% · 5.2% APR</span>
          </div>

          <div className="feat-cell reveal">
            <h3>Trust you can check</h3>
            <p>Every input to your score is published and weighted in the open.</p>
            <dl className="feat-table">
              {WEIGHTS.map((w) => (
                <div key={w.k}>
                  <dt>{w.k}</dt>
                  <dd className={w.tone}>{w.v}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="feat-cell reveal">
            <h3>Real collateral, held by you</h3>
            <p>
              Supply mUSDC, mETH, or mWBTC. The pool never takes custody, and you can
              withdraw whatever isn&apos;t backing a draw.
            </p>
            <div className="feat-tokens">
              <span>mUSDC</span>
              <span>mETH</span>
              <span>mWBTC</span>
            </div>
          </div>

          <div className="feat-cell reveal">
            <h3>Up to 90% LTV, zero gatekeepers</h3>
            <p>
              Anonymous wallets stop at 45%. Prove yourself once and the ceiling moves,
              with no application to file.
            </p>
            <p className="feat-num">90% LTV</p>
          </div>
        </div>
      </div>
    </section>
  );
}
