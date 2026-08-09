"use client";

import { useState } from "react";
import {
  borrowApr,
  computeTrustScore,
  liquidationThreshold,
  ltvFor,
  pct,
  supplyApy,
  usd,
} from "@/lib/vera";

const ROWS = [
  { key: "identity", label: "Identity (CVI)", hint: "Attestation strength from Cleanverse" },
  { key: "history", label: "On-chain history", hint: "Age, activity, protocol footprint" },
  { key: "repayment", label: "Repayment record", hint: "Loans closed without a liquidation" },
];

/**
 * Move the three score components and watch the terms move with them.
 *
 * Same functions the app and the contract use — nothing here is a separate
 * model of the scoring. It is the published formula, run on numbers you choose.
 */
export default function ScoreSimulator({ v }) {
  const [attested, setAttested] = useState(v.attested);
  const [parts, setParts] = useState(() => ({
    identity: v.breakdown.find((b) => b.key === "identity")?.raw || 680,
    history: v.breakdown.find((b) => b.key === "history")?.raw || 800,
    repayment: v.breakdown.find((b) => b.key === "repayment")?.raw || 700,
  }));

  const inputs = { ...parts, verified: attested };
  const score = computeTrustScore(inputs);
  const ltv = ltvFor(score, attested);
  const threshold = liquidationThreshold(score, attested);
  const apr = borrowApr(score);
  const apy = supplyApy(score);

  // What that LTV would be worth against the collateral already posted.
  const capacity = v.collateralUsd * (ltv / 100);
  const delta = score - v.score;

  return (
    <section className="card sim">
      <header className="sim-head">
        <h3>Try the formula</h3>
        <span className={`sim-delta${delta === 0 ? "" : delta > 0 ? " up" : " down"}`}>
          {delta === 0 ? "matches you" : `${delta > 0 ? "+" : ""}${delta} vs you`}
        </span>
      </header>

      <div className="sim-sliders">
        {ROWS.map((r) => {
          const locked = r.key === "identity" && !attested;
          return (
            <label key={r.key} className={`sim-row${locked ? " off" : ""}`}>
              <span className="sim-top">
                <span>{r.label}</span>
                <b>{locked ? "not counted" : parts[r.key]}</b>
              </span>
              <input
                type="range"
                min={0}
                max={1000}
                step={10}
                value={parts[r.key]}
                disabled={locked}
                onChange={(e) =>
                  setParts((p) => ({ ...p, [r.key]: Number(e.target.value) }))
                }
                aria-label={r.label}
              />
              <em>{r.hint}</em>
            </label>
          );
        })}
      </div>

      <button
        className={`sim-toggle${attested ? " on" : ""}`}
        onClick={() => setAttested((a) => !a)}
        aria-pressed={attested}
      >
        {attested ? "With a CVI attestation" : "Without an attestation"}
      </button>

      <div className="sim-out">
        <div>
          <span>Score</span>
          <strong>{score}</strong>
        </div>
        <div>
          <span>Max LTV</span>
          <strong className="accent">{pct(ltv)}</strong>
        </div>
        <div>
          <span>Borrow APR</span>
          <strong>{pct(apr, 1)}</strong>
        </div>
        <div>
          <span>Supply APY</span>
          <strong>{pct(apy, 1)}</strong>
        </div>
        <div>
          <span>Liquidation at</span>
          <strong>{pct(threshold)}</strong>
        </div>
        <div>
          <span>On your collateral</span>
          <strong>{usd(capacity, 0)}</strong>
        </div>
      </div>

      <p className="fineprint">
        Runs the same computeTrustScore, ltvFor, borrowApr and liquidationThreshold the
        app uses, which VeraMath mirrors in integer arithmetic on chain. Without an
        attestation the identity component contributes nothing and LTV is capped at 45%.
      </p>
    </section>
  );
}
