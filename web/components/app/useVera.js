"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchCompliance,
  fetchIdentity,
  historyInputs,
  walletFor,
} from "@/lib/cleanverse";
import {
  MONAD_CHAIN_ID,
  connectWallet,
  disconnectWallet,
  hasInjectedWallet,
  loadDeployment,
  needsWalletChoice,
  onWalletEvents,
  onWalletsDiscovered,
  readChainId,
  readConnectedAccount,
  switchToMonad,
} from "@/lib/wallet";
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
  scoreBreakdown,
  supplyApy,
  utilization as utilizationOf,
  withdrawableUsd as withdrawableUsdOf,
} from "@/lib/vera";

export const ASSETS = {
  mUSDC: { symbol: "mUSDC", name: "Vera USD", price: 1, dp: 2, kind: "stable" },
  mETH: { symbol: "mETH", name: "Vera Ether", price: 2504.12, dp: 4, kind: "volatile" },
  mWBTC: { symbol: "mWBTC", name: "Vera Bitcoin", price: 64991.4, dp: 6, kind: "volatile" },
};

/** Faucet grant per mint() call, per asset. */
export const FAUCET = { mUSDC: 1000, mETH: 0.5, mWBTC: 0.01 };

const INITIAL_WALLET = { mUSDC: 1250, mETH: 0.85, mWBTC: 0.011 };
const INITIAL_COLLATERAL = { mETH: 0.412, mWBTC: 0.0061, mUSDC: 0 };
const INITIAL_SUPPLIED = { mUSDC: 1480, mETH: 0, mWBTC: 0 };
const INITIAL_DEBT = 820;

/** How long the opening 820 of debt has been outstanding, so interest is visible. */
const DEBT_AGE_MS = 6 * 24 * 60 * 60 * 1000;

/**
 * Rest of the pool, for the pool-wide figures.
 *
 * These are local demo numbers, not chain reads — `VeraPool` is not deployed yet,
 * so there is no `totalSupplied` to call. Everything derived from them is labelled
 * "demo · pre-deploy" in the UI. Once the pool lands, this object is the only thing
 * that gets replaced by a contract read.
 */
export const POOL_BASE = {
  /** mUSDC supplied by everyone else. */
  usdc: 412_000,
  /** mUSDC everyone else has already drawn. */
  borrowed: 188_500,
  /** USD value of collateral posted by everyone else. */
  collateralUsd: 96_400,
};

/** Price map, keyed by symbol, for the liquidation-price solver. */
export const PRICES = Object.fromEntries(
  Object.entries(ASSETS).map(([sym, a]) => [sym, a.price])
);

const round = (n, dp) => Number(n.toFixed(dp));
const usdOf = (bag) =>
  Object.entries(bag).reduce((s, [sym, q]) => s + (q || 0) * ASSETS[sym].price, 0);

/**
 * The whole app's state. Deliberately one hook so the demo toggle can flip
 * identity on and off and every derived number moves at once — that is the
 * thing worth showing.
 */
export function useVera() {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [verified, setVerified] = useState(true);
  const [checking, setChecking] = useState(false);

  /**
   * How the connected wallet got here.
   *
   *   "demo" — the two sandbox wallets, chosen by the verified/anonymous toggle
   *   "live" — an address an injected wallet actually authorised
   *
   * Both run the same real CVI/CVA lookups; the difference is only which address
   * is looked up. Which one is active is stated on screen, never inferred.
   */
  const [mode, setMode] = useState("demo");
  const [address, setAddress] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [walletError, setWalletError] = useState(null);
  const [deployment, setDeployment] = useState(null);

  // Wallets that announced themselves via EIP-6963. Empty is the ordinary case
  // (one legacy wallet, or none) and the connect button behaves as it always has.
  const [wallets, setWallets] = useState([]);

  const [identity, setIdentity] = useState(null);
  const [compliance, setCompliance] = useState(null);

  const [wallet, setWallet] = useState(INITIAL_WALLET);
  const [collateral, setCollateral] = useState(INITIAL_COLLATERAL);
  const [supplied, setSupplied] = useState(INITIAL_SUPPLIED);
  const [draft, setDraft] = useState(0);

  // Debt is principal plus whatever has accrued since the last checkpoint —
  // the same split `VeraPool` keeps. Any action that touches the debt folds the
  // accrued part into principal and restarts the clock, which is exactly what
  // `_poke` does on chain.
  //
  // `elapsed` starts at zero so the server render and the first client render
  // agree; the effect below moves it to its real value after mount.
  const [principal, setPrincipal] = useState(INITIAL_DEBT);
  const [elapsed, setElapsed] = useState(0);
  const checkpointRef = useRef(null);

  useEffect(() => {
    checkpointRef.current = Date.now() - DEBT_AGE_MS;
    const tick = () => setElapsed((Date.now() - checkpointRef.current) / 1000);
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);

  /** Fold accrued interest into principal and restart the interest clock. */
  const checkpoint = useCallback((nextPrincipal) => {
    checkpointRef.current = Date.now();
    setElapsed(0);
    setPrincipal(round(Math.max(0, nextPrincipal), 6));
  }, []);

  const [activity, setActivity] = useState([
    { id: 3, t: "Drew 320 mUSDC at 78% LTV", when: "3d ago", kind: "borrow" },
    { id: 2, t: "CVI attestation issued", when: "1d ago", kind: "verify" },
    { id: 1, t: "Supplied 500 mUSDC", when: "2h ago", kind: "supply" },
  ]);

  const log = useCallback((t, kind) => {
    setActivity((a) => [{ id: Date.now() + Math.random(), t, when: "just now", kind }, ...a]);
  }, []);

  /**
   * Connect a real injected wallet.
   *
   * Every outcome is reported rather than swallowed: no provider, a rejected
   * prompt, and the wrong network are all distinct states with distinct copy.
   * A wrong-network connection still records the address, because the wallet
   * did connect — the network is the thing to fix, and `switchNetwork` below
   * fixes it without a second prompt.
   */
  const connect = useCallback(async (rdnsOrEvent) => {
    setWalletError(null);

    // `connect` is wired straight to onClick in two places, so the first
    // argument is a PointerEvent there and an rdns string when a specific wallet
    // was picked. Anything not a string is discarded rather than forwarded as a
    // provider id.
    const rdns = typeof rdnsOrEvent === "string" ? rdnsOrEvent : undefined;

    if (!hasInjectedWallet()) {
      setWalletError({
        code: "no-provider",
        message: "No wallet detected. Install MetaMask, or continue in demo mode.",
      });
      return { ok: false };
    }

    setConnecting(true);
    const res = await connectWallet(rdns);
    setConnecting(false);

    if (res.address) setAddress(res.address);
    if (res.chainId != null) setChainId(res.chainId);

    if (!res.ok) {
      setWalletError({
        code: res.wrongChain ? "wrong-chain" : res.rejected ? "rejected" : "failed",
        message: res.reason,
      });
      // A wrong-chain wallet is connected, just not usable yet. Saying otherwise
      // would hide the address the user needs to see to know which one it is.
      if (res.wrongChain) {
        setMode("live");
        setConnected(true);
      }
      return res;
    }

    setMode("live");
    setConnected(true);
    return res;
  }, []);

  const switchNetwork = useCallback(async () => {
    setWalletError(null);
    const res = await switchToMonad();
    if (!res.ok) {
      setWalletError({ code: "switch-failed", message: res.reason || "Could not switch network" });
      return res;
    }
    setChainId(MONAD_CHAIN_ID);
    return res;
  }, []);

  /** Fall back to the sandbox demo wallets without touching the injected one. */
  const useDemoMode = useCallback(() => {
    setMode("demo");
    setConnected(true);
    setWalletError(null);
  }, []);

  // Withdraw the wallet's authorisation before clearing state. Doing only the
  // latter leaves the site still approved, so `eth_accounts` keeps returning
  // the address and the restore effect reconnects on the next load — which is
  // exactly what "I cannot disconnect" looks like from the outside.
  const disconnect = useCallback(async () => {
    await disconnectWallet();
    setConnected(false);
    setMode("demo");
    setAddress(null);
    setChainId(null);
    setWalletError(null);
    setIdentity(null);
    setCompliance(null);
  }, []);

  // Track announced wallets. Extensions can announce after hydration, so this
  // stays subscribed rather than reading the list once on mount.
  useEffect(() => onWalletsDiscovered(setWallets), []);

  // Restore an already-authorised session on load, without prompting.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const acct = await readConnectedAccount();
      if (cancelled || !acct) return;
      const chain = await readChainId();
      if (cancelled) return;
      setAddress(acct);
      setChainId(chain);
      setMode("live");
      setConnected(true);
      if (chain !== MONAD_CHAIN_ID) {
        setWalletError({
          code: "wrong-chain",
          message: `Switch to Monad testnet (chain ${MONAD_CHAIN_ID})`,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // A wallet the user switches in MetaMask must not leave the previous wallet's
  // score on screen. Clearing identity and compliance forces the re-check below
  // rather than letting a stale, possibly flattering, answer stand.
  useEffect(() => {
    return onWalletEvents({
      onAccountsChanged: (next) => {
        setIdentity(null);
        setCompliance(null);
        if (!next) {
          // The user disconnected from the wallet side.
          setAddress(null);
          setMode("demo");
          setConnected(false);
          return;
        }
        setAddress(next);
        setMode("live");
        setConnected(true);
      },
      onChainChanged: (next) => {
        setChainId(next);
        setWalletError(
          next === MONAD_CHAIN_ID
            ? null
            : { code: "wrong-chain", message: `Switch to Monad testnet (chain ${MONAD_CHAIN_ID})` }
        );
      },
    });
  }, []);

  // Pool addresses, when a deploy has happened. Null is the honest pre-deploy
  // answer and the UI says so rather than implying a live pool.
  useEffect(() => {
    let cancelled = false;
    loadDeployment().then((d) => {
      if (!cancelled) setDeployment(d);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-run CVI + CVA whenever the wallet connects or the demo mode flips.
  //
  // The toggle picks which real wallet to look up — one that holds an A-Pass on
  // Monad, one that genuinely does not. Both answers come from Cleanverse, so
  // the difference on screen is a difference in attestation data, not a local
  // boolean pretending to be one.
  // Bumped to re-run the lookup without changing wallet or mode, so a failed
  // check is recoverable without a reconnect. The sandbox occasionally takes
  // longer than the 12s timeout, and failing closed means one slow response
  // otherwise leaves an attested wallet priced as anonymous for the session.
  const [attempt, setAttempt] = useState(0);
  const recheck = useCallback(() => setAttempt((n) => n + 1), []);

  // The address the trust score is actually computed for. In live mode that is
  // the connected wallet; in demo mode it is whichever sandbox wallet the toggle
  // selects. Either way it is a real address run through the real lookups.
  const subject = mode === "live" ? address : walletFor(verified);

  useEffect(() => {
    if (!connected || !subject) return;
    let cancelled = false;
    setChecking(true);
    Promise.all([fetchIdentity(subject), fetchCompliance(subject)]).then(([id, cva]) => {
      if (cancelled) return;
      setIdentity(id);
      setCompliance(cva);
      setChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, [connected, subject, attempt]);

  const derived = useMemo(() => {
    const { history, repayment } = historyInputs();

    // Creditworthiness follows the attestation Cleanverse actually returned,
    // not the demo toggle. Until a lookup resolves there is nothing proven, so
    // the wallet is treated as unattested — the conservative direction.
    const attested = identity?.verified === true;
    const inputs = { identity: identity?.score ?? 0, history, repayment, verified: attested };

    const score = computeTrustScore(inputs);
    const breakdown = scoreBreakdown(inputs);
    const ltv = ltvFor(score, attested);
    const liqThreshold = liquidationThreshold(score, attested);
    const apr = borrowApr(score);
    const apy = supplyApy(score);

    // Principal and the interest sitting on top of it, kept apart so the UI can
    // show what was drawn against what it has cost.
    const accrued = accruedInterest(principal, apr, elapsed);
    const debt = principal + accrued;

    const collateralUsd = usdOf(collateral);
    const suppliedUsd = usdOf(supplied);
    const walletUsd = usdOf(wallet);

    // Pool-wide figures. Everything but this wallet's own row is a local demo
    // baseline — see POOL_BASE. Labelled as such wherever it is shown.
    const poolSuppliedUsd = POOL_BASE.usdc + suppliedUsd;
    const poolBorrowedUsd = POOL_BASE.borrowed + debt;
    const poolCollateralUsd = POOL_BASE.collateralUsd + collateralUsd;
    const poolTvlUsd = poolSuppliedUsd + poolCollateralUsd;
    const poolUtilization = utilizationOf(poolBorrowedUsd, poolSuppliedUsd);

    // Borrowable mUSDC actually sitting in the pool. `VeraPool.borrow` reverts
    // with InsufficientLiquidity past this, however much credit you have.
    const liquidityUsd = Math.max(
      0,
      POOL_BASE.usdc + (supplied.mUSDC || 0) - POOL_BASE.borrowed - debt
    );

    const borrowCapacity = collateralUsd * (ltv / 100);
    const projectedDebt = debt + draft;
    const available = Math.max(0, borrowCapacity - projectedDebt);

    const hf = healthFactor(collateralUsd, projectedDebt, liqThreshold);

    // Per asset, holding the others at their current prices. The old single-asset
    // form only looked at mETH, which overstated the price mETH had to hold.
    const liqPrices = liquidationPrices(collateral, PRICES, projectedDebt, liqThreshold);
    const liqPrice = liqPrices.mETH ?? null;

    // Collateral you may remove and still pass the contract's check. The pool
    // gates withdrawCollateral on LTV, not the liquidation threshold.
    const withdrawableUsd = withdrawableUsdOf(collateralUsd, debt, ltv);

    const net = netApy({ suppliedUsd, debtUsd: debt, collateralUsd, apyPct: apy, aprPct: apr });

    return {
      score,
      breakdown,
      attested,
      ltv,
      liqThreshold,
      apr,
      apy,
      netApy: net,
      principal,
      accrued,
      debt,
      debtAgeSeconds: elapsed,
      collateralUsd,
      suppliedUsd,
      walletUsd,
      netWorthUsd: collateralUsd + suppliedUsd + walletUsd - debt,
      borrowCapacity,
      projectedDebt,
      available,
      withdrawableUsd,
      hf,
      liqPrice,
      liqPrices,
      liquidityUsd,
      pool: {
        suppliedUsd: poolSuppliedUsd,
        borrowedUsd: poolBorrowedUsd,
        collateralUsd: poolCollateralUsd,
        tvlUsd: poolTvlUsd,
        liquidityUsd,
        utilization: poolUtilization,
      },
      closeFactorPct: CLOSE_FACTOR_PCT,
      liquidationBonusPct: LIQUIDATION_BONUS_PCT,
      utilization: borrowCapacity > 0 ? (projectedDebt / borrowCapacity) * 100 : 0,
    };
  }, [identity, collateral, supplied, wallet, principal, elapsed, draft]);

  // The pool cannot pay out more than it holds, however much credit you have.
  const maxDraw = Math.min(
    Math.max(0, derived.borrowCapacity - derived.debt),
    derived.liquidityUsd
  );
  const maxDrawRef = useRef(maxDraw);
  maxDrawRef.current = maxDraw;

  const derivedRef = useRef(derived);
  derivedRef.current = derived;

  /* ---------- what an action would do to the position ---------- */

  /**
   * Health factor, debt and capacity as they stand, and as they would stand if
   * the given action went through. The sheets show both so a draw is never a
   * step into the dark.
   *
   * Returns null for actions that cannot move the health factor.
   */
  const simulate = useCallback(
    (action, sym, amt) => {
      const d = derivedRef.current;
      const size = Number(amt) || 0;

      const before = {
        collateralUsd: d.collateralUsd,
        debtUsd: d.debt,
        hf: healthFactor(d.collateralUsd, d.debt, d.liqThreshold),
        capacityUsed: d.borrowCapacity > 0 ? (d.debt / d.borrowCapacity) * 100 : 0,
      };

      let collateralUsd = d.collateralUsd;
      let debtUsd = d.debt;

      if (action === "borrow") debtUsd += size;
      else if (action === "repay") debtUsd = Math.max(0, debtUsd - size);
      else if (action === "deposit") collateralUsd += size * (ASSETS[sym]?.price || 0);
      else if (action === "withdraw") collateralUsd -= size * (ASSETS[sym]?.price || 0);
      else return null;

      collateralUsd = Math.max(0, collateralUsd);
      const capacity = collateralUsd * (d.ltv / 100);

      const after = {
        collateralUsd,
        debtUsd,
        hf: healthFactor(collateralUsd, debtUsd, d.liqThreshold),
        capacityUsed: capacity > 0 ? (debtUsd / capacity) * 100 : 0,
      };

      return { before, after, changed: size > 0 };
    },
    []
  );

  /* ---------- max helpers, per action ---------- */

  const maxFor = useCallback(
    (action, sym) => {
      const a = ASSETS[sym];
      if (!a) return 0;
      if (action === "deposit" || action === "supply") return wallet[sym] || 0;
      if (action === "repay") return Math.min(derived.debt, wallet.mUSDC || 0);
      if (action === "withdrawSupply") {
        const held = supplied[sym] || 0;
        // Only mUSDC is lent out, so only mUSDC can be short. The pool pays
        // withdrawals out of idle liquidity, same as `withdrawSupply` on chain.
        if (sym !== "mUSDC") return held;
        return Math.max(0, Math.min(held, derived.liquidityUsd));
      }
      if (action === "withdraw") {
        const held = collateral[sym] || 0;
        const cap = derived.withdrawableUsd / a.price;
        return Math.max(0, Math.min(held, cap));
      }
      return 0;
    },
    [wallet, supplied, collateral, derived.withdrawableUsd, derived.liquidityUsd, derived.debt]
  );

  /* ---------- actions ---------- */

  /**
   * Failure shaped like a contract revert.
   *
   * The UI enforces the same rules the pool does, so a rejection here names the
   * error `VeraPool` would have thrown. Post-deploy the decoded revert drops
   * into the same slot and the message on screen does not change.
   */
  const fail = (code, detail) => ({ ok: false, code, reason: detail || explainError(code) });

  const mint = useCallback(
    (sym) => {
      const amt = FAUCET[sym];
      const a = ASSETS[sym];
      setWallet((w) => ({ ...w, [sym]: round((w[sym] || 0) + amt, a.dp) }));
      log(`Minted ${amt} ${sym} from the faucet`, "mint");
      return { ok: true };
    },
    [log]
  );

  const deposit = useCallback(
    (sym, amt) => {
      const a = ASSETS[sym];
      if (!(amt > 0)) return fail("ZeroAmount");
      if (amt > (wallet[sym] || 0) + 1e-9)
        return fail("InsufficientCollateral", `Not enough ${sym} in your wallet`);
      setWallet((w) => ({ ...w, [sym]: round((w[sym] || 0) - amt, a.dp) }));
      setCollateral((c) => ({ ...c, [sym]: round((c[sym] || 0) + amt, a.dp) }));
      log(`Deposited ${amt} ${sym} as collateral`, "deposit");
      return { ok: true };
    },
    [wallet, log]
  );

  const withdraw = useCallback(
    (sym, amt) => {
      const a = ASSETS[sym];
      if (!(amt > 0)) return fail("ZeroAmount");
      if (amt > (collateral[sym] || 0) + 1e-9)
        return fail("InsufficientCollateral", `You have not deposited that much ${sym}`);
      if (amt * a.price > derived.withdrawableUsd + 1e-6) return fail("ExceedsLTV");
      setCollateral((c) => ({ ...c, [sym]: round((c[sym] || 0) - amt, a.dp) }));
      setWallet((w) => ({ ...w, [sym]: round((w[sym] || 0) + amt, a.dp) }));
      log(`Withdrew ${amt} ${sym} of collateral`, "withdraw");
      return { ok: true };
    },
    [collateral, derived.withdrawableUsd, log]
  );

  const supply = useCallback(
    (sym, amt) => {
      const a = ASSETS[sym];
      if (!(amt > 0)) return fail("ZeroAmount");
      if (amt > (wallet[sym] || 0) + 1e-9)
        return fail("InsufficientShares", `Not enough ${sym} in your wallet`);
      setWallet((w) => ({ ...w, [sym]: round((w[sym] || 0) - amt, a.dp) }));
      setSupplied((s) => ({ ...s, [sym]: round((s[sym] || 0) + amt, a.dp) }));
      log(`Supplied ${amt} ${sym} to earn ${derived.apy}%`, "supply");
      return { ok: true };
    },
    [wallet, derived.apy, log]
  );

  const withdrawSupply = useCallback(
    (sym, amt) => {
      const a = ASSETS[sym];
      if (!(amt > 0)) return fail("ZeroAmount");
      if (amt > (supplied[sym] || 0) + 1e-9)
        return fail("InsufficientShares", `You have not supplied that much ${sym}`);
      // Withdrawals come out of idle liquidity. If it is all lent out, the pool
      // cannot pay, even though the shares are yours.
      if (sym === "mUSDC" && amt > derived.liquidityUsd + 1e-6)
        return fail("InsufficientLiquidity");
      setSupplied((s) => ({ ...s, [sym]: round((s[sym] || 0) - amt, a.dp) }));
      setWallet((w) => ({ ...w, [sym]: round((w[sym] || 0) + amt, a.dp) }));
      log(`Withdrew ${amt} ${sym} from the pool`, "withdraw");
      return { ok: true };
    },
    [supplied, derived.liquidityUsd, log]
  );

  /** Draw an explicit amount. The CVA gate is enforced here, not in the UI. */
  const borrowAmount = useCallback(
    (amt) => {
      if (!(amt > 0)) return fail("ZeroAmount");
      if (!compliance?.cleared) return fail("ComplianceBlocked");
      const d = derivedRef.current;
      if (amt > d.liquidityUsd + 1e-6) return fail("InsufficientLiquidity");
      if (amt > Math.max(0, d.borrowCapacity - d.debt) + 1e-6) return fail("ExceedsLTV");
      // The draw checkpoints the loan, so accrued interest becomes principal.
      checkpoint(d.debt + amt);
      setWallet((w) => ({ ...w, mUSDC: round((w.mUSDC || 0) + amt, 2) }));
      log(`Drew ${amt.toLocaleString()} mUSDC at ${d.ltv}% LTV`, "borrow");
      setDraft(0);
      return { ok: true };
    },
    [compliance, checkpoint, log]
  );

  const borrow = useCallback(() => borrowAmount(draft), [borrowAmount, draft]);

  /**
   * Repay an explicit amount. Interest is settled first, so a partial repayment
   * clears what the loan has cost before it touches what was drawn — the order
   * `VeraPool.repay` uses once `_poke` has folded the two together.
   */
  const repayAmount = useCallback(
    (amt) => {
      const d = derivedRef.current;
      if (!(amt > 0)) return fail("ZeroAmount");
      if (d.debt <= 0) return fail("NoDebt");
      if (amt > (wallet.mUSDC || 0) + 1e-9)
        return fail("TransferFailed", "Not enough mUSDC in your wallet to repay that");

      const paid = Math.min(amt, d.debt);
      const toInterest = Math.min(paid, d.accrued);
      const toPrincipal = paid - toInterest;

      checkpoint(d.debt - paid);
      setWallet((w) => ({ ...w, mUSDC: round((w.mUSDC || 0) - paid, 2) }));
      log(
        toInterest > 0.005
          ? `Repaid ${round(paid, 2)} mUSDC · ${round(toInterest, 2)} interest, ${round(toPrincipal, 2)} principal`
          : `Repaid ${round(paid, 2)} mUSDC`,
        "repay"
      );
      return { ok: true, paid, toInterest, toPrincipal };
    },
    [wallet.mUSDC, checkpoint, log]
  );

  /** Clear the loan outright, interest included, if the wallet can cover it. */
  const repayAll = useCallback(
    () => repayAmount(Math.min(derivedRef.current.debt, wallet.mUSDC || 0)),
    [repayAmount, wallet.mUSDC]
  );

  return {
    connected,
    connecting,
    connect,
    disconnect,
    mode,
    address,
    subject,
    chainId,
    chainOk: chainId === MONAD_CHAIN_ID,
    walletError,
    switchNetwork,
    useDemoMode,
    // Only surface a chooser when there is a genuine ambiguity to resolve.
    // With one wallet — the common case — the connect button stays one click.
    wallets,
    needsWalletChoice: wallets.length > 1 && needsWalletChoice(),
    deployment,
    poolDeployed: !!deployment?.pool,
    verified,
    setVerified,
    checking,
    recheck,
    identity,
    compliance,
    wallet,
    collateral,
    supplied,
    draft,
    setDraft,
    maxDraw,
    maxFor,
    simulate,
    activity,
    mint,
    deposit,
    withdraw,
    supply,
    withdrawSupply,
    borrow,
    borrowAmount,
    repayAmount,
    repayAll,
    ...derived,
  };
}
