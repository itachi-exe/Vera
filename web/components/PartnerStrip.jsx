/** Section 8 — the reference's "built on" partner strip plus legal note. */
export default function PartnerStrip() {
  return (
    <section className="partners">
      <div className="container partners-inner">
        <p className="eyebrow reveal">Built on</p>

        <div className="partners-marks reveal">
          <span className="partner">
            <span className="partner-glyph" aria-hidden="true" />
            Monad
          </span>
          <span className="partner">
            <span className="partner-glyph" aria-hidden="true" />
            Cleanverse
          </span>
        </div>

        <p className="partners-note reveal">
          Vera settles on <strong>Monad</strong>. Identity attestations are issued by{" "}
          <strong>Cleanverse</strong> through CVI, and compliance checks run against CVA.
          Collateral assets on testnet are mock ERC-20s, not claims on real assets.
        </p>
      </div>
    </section>
  );
}
