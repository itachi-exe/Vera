/**
 * Vera protocol math.
 *
 * Single source of truth for the trust score and everything derived from it.
 * The UI never computes these inline — when the real contracts land, only this
 * file changes.
 */

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Score component weights. Published, per the FAQ — they must add to 1. */
export const WEIGHTS = {
  identity: 0.3,
  history: 0.45,
  repayment: 0.25,
};

export const SCORE_MAX = 1000;

/** Loan-to-value ceiling for a wallet with no CVI attestation. */
export const ANON_LTV_CAP = 45;

/** Protocol-wide loan-to-value ceiling, whatever the score. */
export const MAX_LTV = 90;

/** Liquidation threshold sits this many points above your LTV. */
const LIQ_BUFFER = 8;

/**
 * Weighted trust score, 0..1000.
 * Without a CVI attestation the identity component contributes nothing —
 * that is the whole point of verifying.
 */
export function computeTrustScore({ identity, history, repayment, verified }) {
  const id = verified ? identity : 0;
  const raw =
    WEIGHTS.identity * id + WEIGHTS.history * history + WEIGHTS.repayment * repayment;
  return Math.round(clamp(raw, 0, SCORE_MAX));
}

/** Score component breakdown, for the UI's weight bars. */
export function scoreBreakdown({ identity, history, repayment, verified }) {
  const id = verified ? identity : 0;
  return [
    {
      key: "identity",
      label: "Identity (CVI)",
      raw: id,
      weight: WEIGHTS.identity,
      points: Math.round(WEIGHTS.identity * id),
      max: Math.round(WEIGHTS.identity * SCORE_MAX),
      locked: !verified,
    },
    {
      key: "history",
      label: "On-chain history",
      raw: history,
      weight: WEIGHTS.history,
      points: Math.round(WEIGHTS.history * history),
      max: Math.round(WEIGHTS.history * SCORE_MAX),
      locked: false,
    },
    {
      key: "repayment",
      label: "Repayment record",
      raw: repayment,
      weight: WEIGHTS.repayment,
      points: Math.round(WEIGHTS.repayment * repayment),
      max: Math.round(WEIGHTS.repayment * SCORE_MAX),
      locked: false,
    },
  ];
}

/**
 * Loan-to-value, in percent.
 * Verified wallets scale with score up to MAX_LTV; unverified wallets are
 * capped at ANON_LTV_CAP no matter how good their on-chain history is.
 */
export function ltvFor(score, verified) {
  const earned = Math.round(score * 0.096);
  return verified ? clamp(earned, 20, MAX_LTV) : clamp(earned, 20, ANON_LTV_CAP);
}

/** Liquidation threshold, in percent. */
export function liquidationThreshold(score, verified) {
  return clamp(ltvFor(score, verified) + LIQ_BUFFER, 0, 95);
}

/** Borrow APR, in percent. A better score borrows cheaper. */
export function borrowApr(score) {
  return Number(clamp(10.6 - score * 0.00665, 3.5, 12).toFixed(1));
}

/** Supply APY, in percent. Tracks borrow demand. */
export function supplyApy(score) {
  return Number(clamp(borrowApr(score) * 0.79, 1, 10).toFixed(1));
}

/**
 * Health factor. Below 1.0 the position can be liquidated.
 * Returns null when there is no debt (nothing to be unhealthy about).
 */
export function healthFactor(collateralUsd, debtUsd, threshold) {
  if (debtUsd <= 0) return null;
  return (collateralUsd * (threshold / 100)) / debtUsd;
}

/** Collateral price at which the position would be liquidated. */
export function liquidationPrice(debtUsd, collateralQty, threshold) {
  if (collateralQty <= 0 || debtUsd <= 0) return null;
  return debtUsd / (collateralQty * (threshold / 100));
}

export function healthTone(hf) {
  if (hf === null) return "none";
  if (hf < 1.1) return "danger";
  if (hf < 1.5) return "warn";
  return "safe";
}

/* ---------- liquidation parameters ---------- */

/**
 * These mirror `VeraPool.CLOSE_FACTOR_PCT` and `VeraPool.LIQUIDATION_BONUS_PCT`.
 * They are contract constants, so the UI states them rather than deriving them.
 */
export const CLOSE_FACTOR_PCT = 50;
export const LIQUIDATION_BONUS_PCT = 5;

/**
 * Collateral you may withdraw and still pass the contract's check.
 *
 * The pool gates `withdrawCollateral` on `_requireWithinLTV` — the *LTV*, not the
 * liquidation threshold. Quoting the threshold here would offer a withdrawal the
 * contract reverts, and would leave a position at exactly HF 1 if it didn't.
 */
export function withdrawableUsd(collateralUsd, debtUsd, ltvPct) {
  if (debtUsd <= 0) return Math.max(0, collateralUsd);
  if (ltvPct <= 0) return 0;
  return Math.max(0, collateralUsd - debtUsd / (ltvPct / 100));
}

/**
 * Price at which each collateral asset would put the position underwater, holding
 * the other assets at their current prices.
 *
 * Solves `(otherUsd + qty * price) * threshold = debt` for `price`. The previous
 * single-asset form ignored every holding but mETH, which overstated the mETH
 * price needed to stay solvent whenever anything else was posted.
 *
 * Returns `null` for an asset when the rest of the collateral already covers the
 * debt on its own — there is no price at which that asset alone triggers it.
 */
export function liquidationPrices(collateral, prices, debtUsd, thresholdPct) {
  const t = thresholdPct / 100;
  const out = {};
  const total = Object.entries(collateral).reduce(
    (s, [sym, q]) => s + (q || 0) * (prices[sym] || 0),
    0
  );

  for (const [sym, q] of Object.entries(collateral)) {
    const held = q || 0;
    if (held <= 0 || debtUsd <= 0 || t <= 0) {
      out[sym] = null;
      continue;
    }
    const otherUsd = total - held * (prices[sym] || 0);
    const needed = debtUsd / t;
    out[sym] = needed <= otherUsd ? null : (needed - otherUsd) / held;
  }
  return out;
}

/**
 * Interest owed since the last checkpoint, in debt tokens.
 * Simple interest between pokes, mirroring `VeraPool._pendingInterest`.
 */
export function accruedInterest(principal, aprPct, seconds) {
  if (principal <= 0 || aprPct <= 0 || seconds <= 0) return 0;
  const YEAR = 365 * 24 * 60 * 60;
  return (principal * (aprPct / 100) * seconds) / YEAR;
}

/**
 * Net rate across the whole position: what the supply side earns less what the
 * debt costs, over net worth. Negative is normal for a leveraged borrower.
 */
export function netApy({ suppliedUsd, debtUsd, collateralUsd, apyPct, aprPct }) {
  const worth = collateralUsd + suppliedUsd - debtUsd;
  if (worth <= 0) return null;
  const earned = suppliedUsd * (apyPct / 100);
  const paid = debtUsd * (aprPct / 100);
  return ((earned - paid) / worth) * 100;
}

/** Share of supplied liquidity currently lent out. */
export function utilization(borrowedUsd, suppliedUsd) {
  if (suppliedUsd <= 0) return 0;
  return clamp((borrowedUsd / suppliedUsd) * 100, 0, 100);
}

/* ---------- contract error vocabulary ---------- */

/**
 * Plain-language reading of every custom error `VeraPool` can revert with.
 *
 * The UI enforces the same rules locally, so these are what a failed call would
 * have said. Keeping the mapping here means the pre-deploy messages and the
 * post-deploy decoded reverts read identically.
 */
export const POOL_ERRORS = {
  ComplianceBlocked:
    "This wallet has not cleared CVA compliance, so the pool refuses the draw.",
  ExceedsLTV: "That draw would put the position past your LTV ceiling.",
  InsufficientLiquidity: "The pool does not hold enough mUSDC to pay that out right now.",
  InsufficientCollateral: "You have not deposited that much collateral.",
  InsufficientShares: "You have not supplied that much to the pool.",
  PositionHealthy: "That position is above a health factor of 1, so it cannot be liquidated.",
  NoDebt: "There is nothing outstanding to repay.",
  ZeroAmount: "Enter an amount above zero.",
  CollateralCoversNothing:
    "The remaining collateral is worth less than one unit of debt, so no liquidation can pay for itself.",
  Unauthorized: "Only the scorer may publish a credit profile.",
  ScoreOutOfRange: "Score components must be between 0 and 1000.",
  TransferFailed: "The token transfer did not succeed.",
};

/** Human sentence for a contract error name, falling back to the raw name. */
export const explainError = (name) => POOL_ERRORS[name] || name;

/* ---------- formatting ---------- */

export const usd = (n, dp = 2) =>
  n === null || n === undefined || Number.isNaN(n)
    ? "—"
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

export const pct = (n, dp = 0) =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : `${n.toFixed(dp)}%`;

export const qty = (n, dp = 4) =>
  n === null || n === undefined || Number.isNaN(n)
    ? "—"
    : n.toLocaleString("en-US", { maximumFractionDigits: dp });

export const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
