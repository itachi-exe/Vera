"use client";

import { ASSETS, PRICES } from "./useVera";
import { usd } from "@/lib/vera";
import TokenLogo from "./TokenLogo";

/**
 * What liquidation would actually cost, and how far away it is.
 *
 * Per-asset trigger prices come from `liquidationPrices`, which accounts for the
 * whole collateral book — the price mETH must hold depends on what else is posted.
 * The close factor and bonus are contract constants, quoted rather than derived.
 */
export default function RiskSection({ v }) {
  const held = Object.keys(ASSETS).filter((s) => (v.collateral[s] || 0) > 0);
  const repayable = v.debt > 0 ? v.debt * (v.closeFactorPct / 100) : 0;
  const penalty = repayable * (v.liquidationBonusPct / 100);

  return (
    <section className="pos-group risk">
      <h2 className="serif sec-h">Liquidation risk</h2>

      {/* The health factor itself sits in the strip at the top of this screen,
          along with how far it is from 1.00. Restating the figure here only
          invited the two drifting apart, so this section carries what that
          number does not say: which prices trigger a liquidation, and what
          one costs when it lands. */}
      {v.debt <= 0 && (
        <p className="risk-note">
          No debt outstanding, so there is nothing to liquidate. These are the terms that
          would apply to a draw.
        </p>
      )}

      {v.debt > 0 && held.length > 0 && (
        <>
          <span className="amt-label">Trigger prices</span>
          <ul className="rows">
            {held.map((s) => {
              const trigger = v.liqPrices[s];
              const spot = PRICES[s];
              const drop = trigger === null ? null : ((spot - trigger) / spot) * 100;
              // A trigger above spot means the price needed to clear this
              // position is one it does not hold — it is already liquidatable,
              // and "a -12% fall triggers it" would hide that.
              const past = trigger !== null && trigger >= spot;
              return (
                <li key={s}>
                  <TokenLogo symbol={s} />
                  <span className="row-meta">
                    <strong>{s}</strong>
                    <em>
                      {trigger === null
                        ? "Covered by your other collateral"
                        : past
                          ? `now ${usd(spot, 0)} · already past it`
                          : `now ${usd(spot, 0)} · a ${drop.toFixed(0)}% fall triggers it`}
                    </em>
                  </span>
                  <span className="row-val">
                    <strong className={trigger === null ? "" : past ? "danger" : "warn-t"}>
                      {trigger === null ? "—" : usd(trigger, 0)}
                    </strong>
                    <em>{past ? "needed" : "trigger"}</em>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="risk-note">
            Each price assumes your other collateral holds where it is. Posting more of
            anything moves every other trigger down.
          </p>
        </>
      )}

      <dl className="terms">
        <div>
          <dt>Liquidation at</dt>
          <dd>{v.liqThreshold}%</dd>
        </div>
        <div>
          <dt>Close factor</dt>
          <dd>{v.closeFactorPct}%</dd>
        </div>
        <div>
          <dt>Most repayable at once</dt>
          <dd>{usd(repayable)}</dd>
        </div>
        <div>
          <dt>Penalty on that</dt>
          <dd className="warn-t">{usd(penalty)}</dd>
        </div>
      </dl>

      <p className="risk-note">
        A liquidator may repay up to {v.closeFactorPct}% of your debt in one call and takes
        collateral worth that plus {v.liquidationBonusPct}%. Both are constants in{" "}
        <code>VeraPool</code>, not parameters your score moves.
      </p>

      {!v.attested && (
        <p className="risk-warn">
          This wallet has no CVI attestation, so it is held at a {v.ltv}% LTV and a{" "}
          {v.liqThreshold}% threshold. An attestation raises both, which pushes every
          trigger price above further away at the same debt.
        </p>
      )}
    </section>
  );
}
