"use client";

import { healthTone, pct, usd } from "@/lib/vera";

const show = (hf) => (hf === null ? "—" : hf.toFixed(2));

/**
 * Health factor, debt and capacity before and after the action in the open sheet.
 *
 * Every sheet that can move the position shows this, so a draw is never a step
 * into the dark. The numbers come from `useVera.simulate`, which reuses the same
 * `healthFactor` the pool does.
 */
export default function HealthPreview({ sim, threshold }) {
  const { before, after, changed } = sim;
  const tone = healthTone(after.hf);
  const risky = after.hf !== null && after.hf < 1.1;

  return (
    <div className={`hp${changed ? " on" : ""}`}>
      <div className="hp-row">
        <span className="hp-k">Health factor</span>
        <span className="hp-v">
          <em className={healthTone(before.hf)}>{show(before.hf)}</em>
          {changed && (
            <>
              <i aria-hidden="true">→</i>
              <strong className={tone}>{show(after.hf)}</strong>
            </>
          )}
        </span>
      </div>

      <div className="hp-row">
        <span className="hp-k">Debt</span>
        <span className="hp-v">
          <em>{usd(before.debtUsd)}</em>
          {changed && (
            <>
              <i aria-hidden="true">→</i>
              <strong>{usd(after.debtUsd)}</strong>
            </>
          )}
        </span>
      </div>

      <div className="hp-row">
        <span className="hp-k">Credit line used</span>
        <span className="hp-v">
          <em>{pct(before.capacityUsed)}</em>
          {changed && (
            <>
              <i aria-hidden="true">→</i>
              <strong className={after.capacityUsed > 100 ? "danger" : ""}>
                {pct(after.capacityUsed)}
              </strong>
            </>
          )}
        </span>
      </div>

      {changed && risky && (
        <p className="hp-warn">
          That leaves the position at {show(after.hf)}. Below 1.00 anyone may liquidate it,
          and the {threshold}% threshold is where that starts.
        </p>
      )}
    </div>
  );
}
