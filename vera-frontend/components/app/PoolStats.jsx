"use client";

import { pct, usd } from "@/lib/vera";

/**
 * Pool-wide figures: TVL, borrowed, idle liquidity, utilization.
 *
 * Read from `VeraPool` storage via /api/pool — `totalSupplied`, `totalCollateral`
 * and `totalDebt`, valued at the pool's own oracle. Until 2026-08-09 these were a
 * local baseline (412k supplied, 188.5k borrowed) that rendered a 45.8%
 * utilization for a pool whose real utilization is 0%.
 *
 * When the chain read fails the cells go to a dash rather than a number. The
 * claim that nothing here is invented only holds if "unknown" is a state the UI
 * can actually render.
 */
const LABEL = {
  live: "live · Monad testnet",
  loading: "reading chain",
  unavailable: "chain unavailable",
};

export default function PoolStats({ pool }) {
  const live = pool.live;
  const status = pool.status ?? (live ? "live" : "unavailable");
  // A read in flight is not a read that failed, so it gets its own placeholder.
  const show = (v, dp = 0) => (live ? usd(v, dp) : status === "loading" ? "···" : "—");

  return (
    <section className="pool">
      <div className="pool-head">
        <h2 className="serif sec-h">Pool</h2>
        <span className={live ? "tag-live" : "tag-demo"}>{LABEL[status]}</span>
      </div>

      <div className="pool-grid">
        <div className="pool-cell">
          <span className="duo-k">Total value locked</span>
          <strong className="serif">{show(pool.tvlUsd)}</strong>
          <em>collateral plus supplied</em>
        </div>
        <div className="pool-cell">
          <span className="duo-k">Borrowed</span>
          <strong className="serif">{show(pool.borrowedUsd)}</strong>
          <em>mUSDC drawn against credit</em>
        </div>
        <div className="pool-cell">
          <span className="duo-k">Available now</span>
          <strong className="serif">{show(pool.liquidityUsd)}</strong>
          <em>the ceiling on any single draw</em>
        </div>
        <div className="pool-cell">
          <span className="duo-k">Utilization</span>
          <strong className="serif">
            {live ? pct(pool.utilization, 1) : status === "loading" ? "···" : "—"}
          </strong>
          <em>share of supply lent out</em>
        </div>
      </div>

      <div className="pool-track" role="presentation">
        <span
          className="pool-fill"
          style={{ width: `${live ? Math.min(100, pool.utilization) : 0}%` }}
        />
      </div>

      <p className="pool-note">
        {live
          ? "Read from VeraPool storage on Monad testnet, valued at the pool's own oracle."
          : status === "loading"
            ? "Reading VeraPool storage on Monad testnet."
            : "The pool could not be reached, so these are not being shown rather than estimated."}
      </p>
    </section>
  );
}
