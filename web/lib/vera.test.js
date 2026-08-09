import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOSE_FACTOR_PCT,
  LIQUIDATION_BONUS_PCT,
  accruedInterest,
  borrowApr,
  computeTrustScore,
  explainError,
  healthFactor,
  liquidationPrices,
  liquidationThreshold,
  ltvFor,
  netApy,
  utilization,
  withdrawableUsd,
} from "./vera.js";

const YEAR = 365 * 24 * 60 * 60;

/* ---------- withdrawable: the contract gates on LTV, not the threshold ---------- */

test("withdrawable leaves exactly the collateral the LTV check requires", () => {
  // VeraPool._requireWithinLTV: debtValue <= collateralValue * ltv / 100.
  // At 71% LTV, 820 of debt needs 1154.93 of collateral to stay legal.
  const left = 2000 - withdrawableUsd(2000, 820, 71);
  assert.equal(Number(left.toFixed(2)), 1154.93);
  assert.equal(Number((820 / (left / 100)).toFixed(0)), 71);
});

test("withdrawable is stricter than a threshold-based figure", () => {
  // The old UI used the liquidation threshold, which permits a withdrawal the
  // pool reverts and would leave the position at exactly HF 1.
  const onLtv = withdrawableUsd(2000, 820, 71);
  const onThreshold = 2000 - 820 / (79 / 100);
  assert.ok(onLtv < onThreshold);
});

test("withdrawable returns everything when there is no debt", () => {
  assert.equal(withdrawableUsd(1500, 0, 71), 1500);
});

test("withdrawable never goes negative on an underwater position", () => {
  assert.equal(withdrawableUsd(500, 900, 71), 0);
});

/* ---------- per-asset liquidation prices ---------- */

test("liquidation price accounts for the other collateral posted", () => {
  const collateral = { mETH: 0.412, mWBTC: 0.0061 };
  const prices = { mETH: 2504.12, mWBTC: 64991.4 };
  const out = liquidationPrices(collateral, prices, 820, 79);

  // mWBTC contributes 396.45, so mETH only has to cover 1037.97 - 396.45.
  assert.equal(Number(out.mETH.toFixed(2)), 1557.1);
  // Treating mETH as the only collateral overstates the price it must hold.
  assert.ok(out.mETH < 820 / (0.412 * 0.79));
});

test("an asset the rest of the book already covers has no liquidation price", () => {
  const out = liquidationPrices(
    { mETH: 0.412, mWBTC: 0.0061 },
    { mETH: 2504.12, mWBTC: 64991.4 },
    100,
    79
  );
  assert.equal(out.mETH, null);
  assert.equal(out.mWBTC, null);
});

test("no debt means no liquidation price for anything", () => {
  const out = liquidationPrices({ mETH: 1 }, { mETH: 2504.12 }, 0, 79);
  assert.equal(out.mETH, null);
});

test("an asset that is not held has no liquidation price", () => {
  const out = liquidationPrices({ mETH: 0 }, { mETH: 2504.12 }, 500, 79);
  assert.equal(out.mETH, null);
});

test("at its liquidation price the position sits exactly at health factor 1", () => {
  const collateral = { mETH: 0.412, mWBTC: 0.0061 };
  const prices = { mETH: 2504.12, mWBTC: 64991.4 };
  const out = liquidationPrices(collateral, prices, 820, 79);

  const atPrice = 0.412 * out.mETH + 0.0061 * prices.mWBTC;
  assert.equal(Number(healthFactor(atPrice, 820, 79).toFixed(6)), 1);
});

/* ---------- interest ---------- */

test("accrued interest matches simple interest over a full year", () => {
  assert.equal(Number(accruedInterest(1000, 5.7, YEAR).toFixed(4)), 57);
});

test("accrued interest is proportional to elapsed time", () => {
  const half = accruedInterest(1000, 5.7, YEAR / 2);
  assert.equal(Number(half.toFixed(4)), 28.5);
});

test("no principal, no rate, or no time accrues nothing", () => {
  assert.equal(accruedInterest(0, 5.7, YEAR), 0);
  assert.equal(accruedInterest(1000, 0, YEAR), 0);
  assert.equal(accruedInterest(1000, 5.7, 0), 0);
});

/* ---------- net rate and utilization ---------- */

test("a borrower paying more than they earn shows a negative net rate", () => {
  const n = netApy({
    suppliedUsd: 200,
    debtUsd: 820,
    collateralUsd: 1428.1,
    apyPct: 4.5,
    aprPct: 5.7,
  });
  assert.ok(n < 0);
});

test("the default demo position earns more than its debt costs", () => {
  // 1480 supplied at 4.5% out-earns 820 of debt at 5.7%, so the net rate is
  // positive here. Worth pinning: it is the number the Home screen shows.
  const n = netApy({
    suppliedUsd: 1480,
    debtUsd: 820,
    collateralUsd: 1428.1,
    apyPct: 4.5,
    aprPct: 5.7,
  });
  assert.ok(n > 0);
  assert.equal(Number(n.toFixed(2)), 0.95);
});

test("supplying with no debt is a positive net rate", () => {
  const n = netApy({
    suppliedUsd: 1000,
    debtUsd: 0,
    collateralUsd: 0,
    apyPct: 4.5,
    aprPct: 5.7,
  });
  assert.equal(Number(n.toFixed(2)), 4.5);
});

test("net rate is undefined when net worth is zero or negative", () => {
  assert.equal(
    netApy({ suppliedUsd: 0, debtUsd: 100, collateralUsd: 0, apyPct: 4, aprPct: 6 }),
    null
  );
});

test("utilization is borrowed over supplied, clamped to 100", () => {
  assert.equal(utilization(500, 1000), 50);
  assert.equal(utilization(0, 1000), 0);
  assert.equal(utilization(1500, 1000), 100);
  assert.equal(utilization(100, 0), 0);
});

/* ---------- constants and error vocabulary ---------- */

test("liquidation constants match the pool contract", () => {
  assert.equal(CLOSE_FACTOR_PCT, 50);
  assert.equal(LIQUIDATION_BONUS_PCT, 5);
});

test("known contract errors read as sentences and unknown ones pass through", () => {
  assert.match(explainError("ComplianceBlocked"), /CVA compliance/);
  assert.match(explainError("InsufficientLiquidity"), /does not hold enough/);
  assert.equal(explainError("SomethingNew"), "SomethingNew");
});

/* ---------- the demo claim still holds end to end ---------- */

test("the two demo wallets still price apart exactly as documented", () => {
  const base = { identity: 680, history: 800, repayment: 700 };

  const attested = computeTrustScore({ ...base, verified: true });
  const anon = computeTrustScore({ ...base, verified: false });

  assert.equal(attested, 739);
  assert.equal(anon, 535);
  assert.equal(ltvFor(attested, true), 71);
  assert.equal(ltvFor(anon, false), 45);
  assert.equal(liquidationThreshold(attested, true), 79);
  assert.equal(liquidationThreshold(anon, false), 53);
  assert.equal(borrowApr(attested), 5.7);
  assert.equal(borrowApr(anon), 7);
});
