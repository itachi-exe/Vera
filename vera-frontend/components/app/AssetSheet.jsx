"use client";

import Sheet from "./Sheet";
import { ASSETS } from "./useVera";
import { pct, qty, usd } from "@/lib/vera";

/**
 * Detail for one market: price, the terms your score buys on it, and your own
 * position in it. Reached by tapping a Markets row — the rows used to be inert.
 */
export default function AssetSheet({ sym, onClose, onAction, v }) {
  const a = sym ? ASSETS[sym] : null;
  if (!a) return null;

  const isStable = a.kind === "stable";
  const inWallet = v.wallet[sym] || 0;
  const asCollateral = v.collateral[sym] || 0;
  const asSupply = v.supplied[sym] || 0;
  const liq = v.liqPrices?.[sym] ?? null;

  const terms = [
    { k: "Price", v: usd(a.price, a.price < 10 ? 4 : 2) },
    { k: "Supply APY", v: pct(isStable ? v.apy : Number((v.apy * 0.42).toFixed(1)), 1) },
    isStable
      ? { k: "Borrow APR", v: pct(v.apr, 1) }
      : { k: "Max LTV", v: pct(v.ltv) },
    {
      k: isStable ? "Available to borrow" : "Liquidation threshold",
      v: isStable ? usd(v.liquidityUsd, 0) : pct(v.liqThreshold),
    },
  ];

  const mine = [
    { k: "In wallet", v: qty(inWallet, a.dp) },
    { k: "As collateral", v: qty(asCollateral, a.dp) },
    { k: "Supplied", v: qty(asSupply, a.dp) },
  ];

  return (
    <Sheet
      open={Boolean(sym)}
      onClose={onClose}
      title={a.name}
      sub={
        isStable
          ? `${a.symbol} is the pool's debt asset. Supply it to earn, or draw it against collateral.`
          : `${a.symbol} can back a credit line. Deposited as collateral it stays yours until a liquidation.`
      }
      footer={
        <div className="asheet-cta">
          <button
            className="btn btn-primary sheet-cta"
            onClick={() => onAction(isStable ? "borrow" : "deposit", sym)}
          >
            {isStable ? "Draw mUSDC" : `Deposit ${sym}`}
          </button>
          <button className="btn btn-ghost sheet-cta" onClick={() => onAction("supply", sym)}>
            Supply {sym}
          </button>
        </div>
      }
    >
      <span className="amt-label">Terms at your score of {v.score}</span>
      <dl className="terms">
        {terms.map((t) => (
          <div key={t.k}>
            <dt>{t.k}</dt>
            <dd>{t.v}</dd>
          </div>
        ))}
      </dl>

      <span className="amt-label">Your position</span>
      <dl className="terms">
        {mine.map((m) => (
          <div key={m.k}>
            <dt>{m.k}</dt>
            <dd>{m.v}</dd>
          </div>
        ))}
      </dl>

      {!isStable && asCollateral > 0 && (
        <p className="sheet-note">
          {liq === null ? (
            <>
              Your other collateral already covers the debt, so there is no{" "}
              {sym} price that triggers a liquidation on its own.
            </>
          ) : (
            <>
              Liquidation on this position starts if {sym} reaches{" "}
              <strong>{usd(liq)}</strong>, holding your other collateral where it is.
            </>
          )}
        </p>
      )}

      {isStable && (
        <p className="sheet-note">
          Every draw clears a CVA compliance check first, and the pool can only pay out
          what it holds — {usd(v.liquidityUsd, 0)} right now.
        </p>
      )}
    </Sheet>
  );
}
