import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  SEL,
  decodePosition,
  ethCallBatch,
  fromUnits,
  toBigInt,
  word,
} from "@vera/backend/chain";
import { rateLimit } from "@vera/backend/rate-limit";

/**
 * What the deployed pool actually holds.
 *
 * GET -> { ok, asOf, chainId, pool, prices, totals, tokens, account? }
 * GET ?address=0x.. -> additionally the wallet's real balances and position.
 *
 * The dashboard used to render a local baseline for every pool-wide figure. This
 * is the replacement: the numbers on screen are the ones in storage, and when
 * this route cannot answer the UI says so instead of substituting an invention.
 *
 * Server-side for the same reason as the Cleanverse routes -- one cached read per
 * window for every visitor rather than one per visitor per load.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHAIN_ID = Number(process.env.MONAD_CHAIN_ID || 10143);
const TTL_MS = 10_000;

/** Pool-wide reads only. An account query is per-wallet and never cached here. */
let cached = null;

async function deployment() {
  const file = path.join(process.cwd(), "public", "deployments", `${CHAIN_ID}.json`);
  return JSON.parse(await readFile(file, "utf8"));
}

/**
 * Pool-wide state in one round trip.
 *
 * Prices come from the pool's own oracle rather than a market feed: these are
 * the values the contract values collateral at, and a dashboard that disagrees
 * with its own pool about the price of the collateral is worse than one that
 * shows nothing.
 */
async function readPool(d) {
  const calls = [
    { to: d.pool, data: SEL.totalSupplied },
    { to: d.pool, data: SEL.totalCollateral },
    { to: d.pool, data: SEL.totalDebt },
    { to: d.pool, data: SEL.validatorPoolId },
    { to: d.oracle, data: SEL.getPrice + word(d.debtToken) },
    { to: d.oracle, data: SEL.getPrice + word(d.collateralToken) },
    { to: d.oracle, data: SEL.getPrice + word(d.extraToken) },
    { to: d.collateralToken, data: SEL.decimals },
    { to: d.debtToken, data: SEL.decimals },
    { to: d.pool, data: SEL.totalSupplyShares },
  ];

  const r = await ethCallBatch(calls);
  const colDec = Number(toBigInt(r[7]) ?? 18n);
  const debtDec = Number(toBigInt(r[8]) ?? 6n);

  // 1e18-scaled USD per whole token, straight off IVeraOracle.
  const price = (hex) => fromUnits(toBigInt(hex), 18);
  const prices = { mUSDC: price(r[4]), mETH: price(r[5]), mWBTC: price(r[6]) };

  const suppliedQty = fromUnits(toBigInt(r[0]), debtDec);
  const collateralQty = fromUnits(toBigInt(r[1]), colDec);
  const debtQty = fromUnits(toBigInt(r[2]), debtDec);

  const poolId = toBigInt(r[3]);

  return {
    chainId: CHAIN_ID,
    pool: d.pool,
    oracle: d.oracle,
    // Zero means never registered. Surfaced as null so the UI renders the
    // "not registered" branch rather than a row of zeroes that looks like an id.
    validatorPoolId: poolId && poolId !== 0n ? r[3] : null,
    tokens: {
      collateral: { symbol: "mETH", address: d.collateralToken, decimals: colDec },
      debt: { symbol: "mUSDC", address: d.debtToken, decimals: debtDec },
      quote: { symbol: "mWBTC", address: d.extraToken, decimals: 8 },
    },
    prices,
    // Raw, for pricing one wallet's shares below. Not part of the response.
    raw: { totalSuppliedRaw: toBigInt(r[0]), totalSupplySharesRaw: toBigInt(r[9]) },
    totals: {
      suppliedQty,
      collateralQty,
      debtQty,
      suppliedUsd: suppliedQty === null ? null : suppliedQty * (prices.mUSDC ?? 0),
      collateralUsd: collateralQty === null ? null : collateralQty * (prices.mETH ?? 0),
      debtUsd: debtQty === null ? null : debtQty * (prices.mUSDC ?? 0),
      utilization: suppliedQty && debtQty !== null ? Math.min(100, (debtQty / suppliedQty) * 100) : 0,
    },
  };
}

/** The connected wallet's real holdings. Zero is a truthful answer here. */
async function readAccount(d, address, base) {
  const tokens = base.tokens;
  const r = await ethCallBatch([
    { to: d.collateralToken, data: SEL.balanceOf + word(address) },
    { to: d.debtToken, data: SEL.balanceOf + word(address) },
    { to: d.extraToken, data: SEL.balanceOf + word(address) },
    { to: d.pool, data: SEL.positions + word(address) },
    { to: d.pool, data: SEL.supplyShares + word(address) },
  ]);

  const pos = decodePosition(r[3]);

  // Shares are not the asset: `withdrawSupply` pays out
  // `shares * totalSupplied / totalSupplyShares`, so that is what this wallet's
  // supply is worth, interest included. Priced here rather than in the browser
  // because the ratio moves with every accrual.
  const shares = toBigInt(r[4]);
  const { totalSuppliedRaw, totalSupplySharesRaw } = base.raw;
  const suppliedRaw =
    shares !== null && totalSuppliedRaw !== null && totalSupplySharesRaw
      ? (shares * totalSuppliedRaw) / totalSupplySharesRaw
      : null;

  return {
    address,
    balances: {
      mETH: fromUnits(toBigInt(r[0]), tokens.collateral.decimals),
      mUSDC: fromUnits(toBigInt(r[1]), tokens.debt.decimals),
      mWBTC: fromUnits(toBigInt(r[2]), tokens.quote.decimals),
    },
    supplied: fromUnits(suppliedRaw, tokens.debt.decimals),
    position: pos && {
      collateral: fromUnits(pos.collateralRaw, tokens.collateral.decimals),
      debt: fromUnits(pos.debtRaw, tokens.debt.decimals),
      score: pos.score,
      verified: pos.verified,
      complianceCleared: pos.complianceCleared,
      lastAccrual: pos.lastAccrual,
    },
  };
}

export async function GET(request) {
  const limited = rateLimit(request, { max: 60 });
  if (limited) return limited;

  const address = new URL(request.url).searchParams.get("address");
  if (address && !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return Response.json({ ok: false, error: "bad address", code: "bad-request" }, { status: 400 });
  }

  try {
    const d = await deployment();
    const now = Date.now();

    let base = cached && now - cached.at < TTL_MS ? cached.body : null;
    if (!base) {
      base = await readPool(d);
      cached = { at: now, body: base };
    }

    // `raw` carries BigInts for the share-pricing maths and is dropped here:
    // JSON.stringify throws on BigInt, and the browser has no use for it.
    const { raw, ...pub } = base;
    const body = { ok: true, asOf: new Date(now).toISOString(), ...pub };
    if (address) body.account = await readAccount(d, address, base);

    return Response.json(body);
  } catch (err) {
    // No stale fallback and no invented numbers: a dashboard that cannot reach
    // the chain should say so, which is what `ok: false` drives in the UI.
    return Response.json(
      { ok: false, error: String(err?.message || err), code: "chain-unreachable" },
      { status: 502 },
    );
  }
}
