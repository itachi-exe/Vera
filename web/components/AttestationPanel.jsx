import Link from "next/link";
import DeviceMock from "./DeviceMock";

const ROWS = [
  {
    k: "Signed",
    v: "Every CVI attestation carries its issuer's cryptographic signature.",
  },
  {
    k: "Recorded",
    v: "Every score, draw, and repayment is written to Monad. Nothing is edited after the fact.",
  },
  {
    k: "Open",
    v: "Anyone can audit a wallet's full trust and repayment history on-chain.",
  },
];

/** Section 4 — the reference's "track record" panel: device left, copy right. */
export default function AttestationPanel() {
  return (
    <section id="trust" className="sec split">
      <div className="container split-inner">
        <div className="split-device reveal">
          <DeviceMock variant="record" />
        </div>

        <div className="split-copy">
          <h2 className="serif reveal">
            A credit record that
            <br />
            <em>can&apos;t be edited</em>.
          </h2>

          <p className="lede reveal">
            Vera turns a verified identity into a score, and the score into a line. The
            trail is permanent: you hold the numbers, not the marketing.
          </p>

          <dl className="attest reveal">
            {ROWS.map((r) => (
              <div className="attest-row" key={r.k}>
                <dt>{r.k}</dt>
                <dd>{r.v}</dd>
              </div>
            ))}
          </dl>

          <Link href="/app" className="btn btn-secondary reveal">
            See Vera in action <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
