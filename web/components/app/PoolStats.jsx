"use client";

import { pct, usd } from "@/lib/vera";

/**
 * Pool-wide figures: TVL, borrowed, idle liquidity, utilization.
 *
 * `VeraPool` is not deployed yet, so these are derived from local demo state
 * rather than read from chain. Each one carries a badge saying so — the claim
 * that nothing in this app is invented only holds if the derived numbers admit
 * to being derived.
 */
export default function PoolStats({ pool }) {
  return (
    <section className="pool">
      <div className="pool-head">
        <h2 className="serif sec-h">Pool</h2>
        <span className="tag-demo">demo · pre-deploy</span>
      </div>

      <div className="pool-grid">
        <div className="pool-cell">
          <span className="duo-k">Total value locked</span>
          <strong className="serif">{usd(pool.tvlUsd, 0)}</strong>
          <em>collateral plus supplied</em>
        </div>
        <div className="pool-cell">
          <span className="duo-k">Borrowed</span>
          <strong className="serif">{usd(pool.borrowedUsd, 0)}</strong>
          <em>mUSDC drawn against credit</em>
        </div>
        <div className="pool-cell">
          <span className="duo-k">Available now</span>
          <strong className="serif">{usd(pool.liquidityUsd, 0)}</strong>
          <em>the ceiling on any single draw</em>
        </div>
        <div className="pool-cell">
          <span className="duo-k">Utilization</span>
          <strong className="serif">{pct(pool.utilization, 1)}</strong>
          <em>share of supply lent out</em>
        </div>
      </div>

      <div className="pool-track" role="presentation">
        <span className="pool-fill" style={{ width: `${Math.min(100, pool.utilization)}%` }} />
      </div>

      <p className="pool-note">
        Local until the pool is deployed. Your own rows are real demo state; the rest is a
        fixed baseline so utilization and liquidity behave the way the contract would.
      </p>
    </section>
  );
}
