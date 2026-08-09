import DeviceMock from "./DeviceMock";

const STEPS = [
  {
    k: "Verify once with CVI",
    v: "Connect your wallet and prove your identity through Cleanverse. Vera reads the attestation, never your documents.",
  },
  {
    k: "Get your trust score",
    v: "Identity, on-chain history, and repayment behaviour combine into one score. Identity carries 30% of the weight.",
  },
  {
    k: "Borrow at your LTV",
    v: "A higher score unlocks a higher loan-to-value. Every draw clears a CVA compliance check before it executes.",
  },
];

/** Section 5 — the reference's numbered 3-step flow: copy left, device right. */
export default function Steps() {
  return (
    <section id="how" className="sec split">
      <div className="container split-inner">
        <div className="split-copy">
          <h2 className="serif reveal">
            From a wallet
            <br />
            to a <em>credit line</em>.
          </h2>

          <p className="lede reveal">
            No forms, no underwriters, no waiting. Three steps, and the terms are yours
            before you sign anything.
          </p>

          <ol className="steps reveal">
            {STEPS.map((s, i) => (
              <li key={s.k}>
                <span className="steps-n">{i + 1}</span>
                <div>
                  <h3>{s.k}</h3>
                  <p>{s.v}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="split-device reveal">
          <DeviceMock variant="ask" />
        </div>
      </div>
    </section>
  );
}
