"use client";

import { useEffect, useMemo, useState } from "react";
import AmountField from "./AmountField";
import HealthPreview from "./HealthPreview";
import Sheet from "./Sheet";
import { ASSETS, FAUCET } from "./useVera";
import { qty, usd } from "@/lib/vera";
import TokenLogo from "./TokenLogo";

const COPY = {
  deposit: {
    title: "Deposit collateral",
    sub: "Back your credit line. Deposited assets stay yours and can be withdrawn while they are not securing a draw.",
    cta: "Deposit",
    label: "How much to deposit",
  },
  withdraw: {
    title: "Withdraw collateral",
    sub: "Take collateral back out. Vera caps this at whatever keeps your health factor at or above 1.",
    cta: "Withdraw",
    label: "How much to withdraw",
  },
  supply: {
    title: "Supply to the pool",
    sub: "Earn yield on idle assets. Supplied assets are not collateral and can be pulled out at any time.",
    cta: "Supply",
    label: "How much to supply",
  },
  withdrawSupply: {
    title: "Withdraw from the pool",
    sub: "Pull supplied assets back into your wallet, along with anything they have earned.",
    cta: "Withdraw",
    label: "How much to withdraw",
  },
  borrow: {
    title: "Borrow mUSDC",
    sub: "Draw against your collateral. Your trust score sets the ceiling, and every draw clears a CVA compliance check first.",
    cta: "Draw",
    label: "How much to draw",
  },
  repay: {
    title: "Repay mUSDC",
    sub: "Pay down the loan. Interest settles first, then principal — the order the pool applies once it has folded the two together.",
    cta: "Repay",
    label: "How much to repay",
  },
  faucet: {
    title: "Get test tokens",
    sub: "The collateral assets are mock ERC-20s with an open mint(). Grab some to try the flow. Testnet only, no value.",
    cta: "Mint",
    label: "",
  },
};

/** Asset row, ported from the reference's Market list. */
function AssetRow({ sym, active, onClick, right }) {
  const a = ASSETS[sym];
  return (
    <button
      type="button"
      className={`pick${active ? " on" : ""}`}
      onClick={onClick}
      aria-pressed={active}
    >
      <TokenLogo symbol={sym} className="pick-badge" />
      <span className="pick-meta">
        <strong>{sym}</strong>
        <em>{a.name}</em>
      </span>
      <span className="pick-right">{right}</span>
    </button>
  );
}

export default function ActionSheet({ action, preset, onClose, v }) {
  const open = Boolean(action);
  const copy = COPY[action] || COPY.deposit;

  const assets = useMemo(() => {
    if (action === "borrow" || action === "repay") return ["mUSDC"];
    if (action === "withdrawSupply") return Object.keys(ASSETS).filter((s) => v.supplied[s] > 0);
    if (action === "withdraw") return Object.keys(ASSETS).filter((s) => v.collateral[s] > 0);
    return Object.keys(ASSETS);
  }, [action, v.supplied, v.collateral]);

  const [sym, setSym] = useState("mETH");
  const [amount, setAmount] = useState(0);
  const [flash, setFlash] = useState(null);

  // Reset whenever the sheet opens or the asset list changes under it. A preset
  // wins when it is valid — that is the asset the user tapped in Markets.
  useEffect(() => {
    if (!open) return;
    setAmount(0);
    setFlash(null);
    setSym((s) => {
      if (preset && assets.includes(preset)) return preset;
      return assets.includes(s) ? s : assets[0] || "mETH";
    });
  }, [open, action, assets, preset]);

  const max =
    action === "borrow"
      ? v.maxDraw
      : action && action !== "faucet"
        ? v.maxFor(action, sym)
        : 0;

  const blocked = action === "borrow" && !v.compliance?.cleared;

  // Before/after for the actions that can move the health factor.
  const sim = useMemo(
    () => (open ? v.simulate(action, sym, amount) : null),
    [open, action, sym, amount, v]
  );

  const rightFor = (s) => {
    if (action === "borrow") return `max ${usd(v.maxDraw, 0)}`;
    if (action === "repay") return `owed ${usd(v.debt)}`;
    if (action === "faucet") return `+${FAUCET[s]}`;
    if (action === "withdraw") return qty(v.collateral[s] || 0, ASSETS[s].dp);
    if (action === "withdrawSupply") return qty(v.supplied[s] || 0, ASSETS[s].dp);
    return qty(v.wallet[s] || 0, ASSETS[s].dp);
  };

  const submit = () => {
    if (action === "borrow") {
      v.setDraft(amount);
      const res = v.borrowAmount(amount);
      if (res.ok) {
        onClose();
        return;
      }
      setFlash(res.reason);
      return;
    }

    const fn =
      action === "deposit"
        ? () => v.deposit(sym, amount)
        : action === "withdraw"
          ? () => v.withdraw(sym, amount)
          : action === "supply"
            ? () => v.supply(sym, amount)
            : action === "withdrawSupply"
              ? () => v.withdrawSupply(sym, amount)
              : action === "repay"
                ? () => v.repayAmount(amount)
                : () => v.mint(sym);

    const res = fn();
    if (res.ok) {
      onClose();
      return;
    }
    setFlash(res.reason);
  };

  const disabled =
    blocked || (action !== "faucet" && (!(amount > 0) || amount > max));

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={copy.title}
      sub={copy.sub}
      footer={
        <button className="btn btn-primary sheet-cta" onClick={submit} disabled={disabled}>
          {assets.length === 0
            ? "Nothing to withdraw"
            : blocked
            ? "Blocked by compliance"
            : action === "repay" && v.debt <= 0
            ? "Nothing outstanding"
            : action === "faucet"
            ? `Mint ${FAUCET[sym]} ${sym}`
            : [copy.cta, amount > 0 ? qty(amount, ASSETS[sym]?.dp) : null, sym]
                .filter(Boolean)
                .join(" ")}
        </button>
      }
    >
      <span className="amt-label">Asset</span>
      <div className="picks">
        {assets.length === 0 ? (
          <p className="picks-empty">Nothing available to withdraw yet.</p>
        ) : (
          assets.map((s) => (
            <AssetRow
              key={s}
              sym={s}
              active={s === sym}
              onClick={() => {
                setSym(s);
                setAmount(0);
              }}
              right={rightFor(s)}
            />
          ))
        )}
      </div>

      {action !== "faucet" && assets.length > 0 && (
        <AmountField
          label={copy.label}
          symbol={sym}
          value={amount}
          onChange={setAmount}
          max={max}
          price={v.prices?.[sym]}
        />
      )}

      {sim && <HealthPreview sim={sim} threshold={v.liqThreshold} />}

      {action === "borrow" && (
        <>
          <dl className="terms">
            <div>
              <dt>Your LTV</dt>
              <dd className="accent">{v.ltv}%</dd>
            </div>
            <div>
              <dt>Borrow APR</dt>
              <dd>{v.apr}%</dd>
            </div>
            <div>
              <dt>Liquidation at</dt>
              <dd>{v.liqThreshold}%</dd>
            </div>
            <div>
              <dt>Pool can pay out</dt>
              <dd>{usd(v.liquidityUsd, 0)}</dd>
            </div>
          </dl>
          {blocked && (
            <p className="sheet-err">
              {v.compliance?.error ? (
                <>
                  <strong>Compliance check failed.</strong> Vera could not reach CVA, and a
                  gate that opens on error is not a gate — so the draw is refused until the
                  check succeeds. Retry it from the Vera tab.
                </>
              ) : (
                <>
                  <strong>Blocked by CVA.</strong> This wallet has not cleared compliance, so
                  the contract will refuse the draw. Verify to continue.
                </>
              )}
            </p>
          )}
          {!blocked && v.maxDraw <= 0 && (
            // Two different limits can zero the draw, and they need different
            // actions from you, so name the one that actually binds.
            <p className="sheet-note">
              {v.debt >= v.borrowCapacity ? (
                <>
                  <strong>Nothing left to draw.</strong> Your {usd(v.debt)} of debt is already
                  at or past the {usd(v.borrowCapacity)} your collateral supports at{" "}
                  {v.ltv}% LTV. Repay, or deposit more collateral.
                </>
              ) : (
                <>
                  <strong>The pool is out of mUSDC.</strong> You have{" "}
                  {usd(v.borrowCapacity - v.debt)} of credit left, but only{" "}
                  {usd(v.liquidityUsd)} is available to pay it out.
                </>
              )}
            </p>
          )}
        </>
      )}

      {action === "repay" && (
        <>
          <dl className="terms">
            <div>
              <dt>Principal</dt>
              <dd>{usd(v.principal)}</dd>
            </div>
            <div>
              <dt>Interest accrued</dt>
              <dd>{usd(v.accrued)}</dd>
            </div>
            <div>
              <dt>Total owed</dt>
              <dd>{usd(v.debt)}</dd>
            </div>
            <div>
              <dt>In your wallet</dt>
              <dd>{usd(v.wallet.mUSDC || 0)}</dd>
            </div>
          </dl>
          <p className="sheet-note">
            Repayments clear interest first, then principal. Paying the full{" "}
            <strong>{usd(v.debt)}</strong> closes the loan and frees all collateral.
          </p>
        </>
      )}

      {action === "withdraw" && (
        <p className="sheet-note">
          Withdrawable now: <strong>{usd(v.withdrawableUsd)}</strong> across all collateral.
          The pool gates this on your {v.ltv}% LTV, not the {v.liqThreshold}% liquidation
          threshold, so it leaves the position clear of the line rather than on it.
        </p>
      )}

      {action === "supply" && (
        <p className="sheet-note">
          Currently earning <strong>{v.apy}%</strong> on stables. Supplied assets do not
          raise your borrowing power.
        </p>
      )}

      {flash && <p className="sheet-err">{flash}</p>}
    </Sheet>
  );
}
