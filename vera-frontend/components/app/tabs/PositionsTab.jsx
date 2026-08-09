"use client";

import RiskSection from "../RiskSection";
import { ASSETS } from "../useVera";
import { healthTone, pct, qty, usd } from "@/lib/vera";
import TokenLogo from "../TokenLogo";

/** Rough age of the current interest checkpoint. */
const ago = (seconds) => {
  if (!(seconds > 0)) return "just now";
  const days = Math.floor(seconds / 86400);
  if (days >= 1) return `${days}d ago`;
  const hours = Math.floor(seconds / 3600);
  if (hours >= 1) return `${hours}h ago`;
  return `${Math.max(1, Math.floor(seconds / 60))}m ago`;
};

const KIND_LABEL = {
  borrow: "Borrow",
  deposit: "Deposit",
  withdraw: "Withdraw",
  supply: "Supply",
  repay: "Repay",
  verify: "Identity",
  mint: "Faucet",
};

/** Positions — the reference's "Owned" screen, including its empty state. */
export default function PositionsTab({ v, onAction }) {
  const collateral = Object.keys(ASSETS).filter((s) => (v.collateral[s] || 0) > 0);
  const supplied = Object.keys(ASSETS).filter((s) => (v.supplied[s] || 0) > 0);
  const nothing = collateral.length === 0 && supplied.length === 0 && v.debt <= 0;
  const tone = healthTone(v.hf);

  if (nothing) {
    return (
      <div className="void">
        <span className="void-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
            <path
              d="M3 16.5 9 10l4 4 7.5-7.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <p className="serif void-h">Nothing here yet</p>
        <p className="void-p">
          When you deposit collateral or draw against it, your positions show up here.
        </p>
        <button className="btn btn-primary" onClick={() => onAction("deposit")}>
          Deposit collateral
        </button>
      </div>
    );
  }

  return (
    <>
      <h1 className="serif page-h">Positions</h1>

      <div className="health">
        <div className="health-top">
          <span className="duo-k">Health factor</span>
          <strong className={`serif health-v ${tone}`}>
            {v.hf === null ? "—" : v.hf.toFixed(2)}
          </strong>
        </div>
        <div className="health-track">
          <span
            className={`health-fill ${tone}`}
            style={{ width: `${Math.min(100, v.utilization)}%` }}
          />
        </div>
        <p className="health-note">
          {pct(v.utilization)} of capacity used · liquidation at {v.liqThreshold}%
          {v.hf !== null && (
            <span>
              {" · "}
              {v.hf < 1
                ? "below 1.00, so this position can be liquidated now"
                : `${((v.hf - 1) * 100).toFixed(0)}% clear of the line`}
            </span>
          )}
        </p>
      </div>

      <div className="pcol pcol-a">
      {collateral.length > 0 && (
        <section className="pos-group">
          <h2 className="serif sec-h">Collateral</h2>
          <ul className="rows">
            {collateral.map((s) => (
              <li key={s}>
                <TokenLogo symbol={s} />
                <span className="row-meta">
                  <strong>{s}</strong>
                  <em>{qty(v.collateral[s], ASSETS[s].dp)}</em>
                </span>
                <span className="row-val">
                  <strong>{usd(v.collateral[s] * ASSETS[s].price)}</strong>
                  <em>{v.ltv}% LTV</em>
                </span>
              </li>
            ))}
          </ul>
          <div className="pair">
            <button className="chip-btn" onClick={() => onAction("deposit")}>
              Deposit
            </button>
            <button className="chip-btn" onClick={() => onAction("withdraw")}>
              Withdraw
            </button>
          </div>
        </section>
      )}

      {supplied.length > 0 && (
        <section className="pos-group">
          <h2 className="serif sec-h">Supplied</h2>
          <ul className="rows">
            {supplied.map((s) => (
              <li key={s}>
                <TokenLogo symbol={s} />
                <span className="row-meta">
                  <strong>{s}</strong>
                  <em>Earning {v.apy}%</em>
                </span>
                <span className="row-val">
                  <strong>{usd(v.supplied[s] * ASSETS[s].price)}</strong>
                  <em>{qty(v.supplied[s], ASSETS[s].dp)}</em>
                </span>
              </li>
            ))}
          </ul>
          <div className="pair">
            <button className="chip-btn" onClick={() => onAction("supply")}>
              Supply
            </button>
            <button className="chip-btn" onClick={() => onAction("withdrawSupply")}>
              Unsupply
            </button>
          </div>
        </section>
      )}

      {v.debt > 0 && (
        <section className="pos-group">
          <h2 className="serif sec-h">Borrowed</h2>
          <ul className="rows">
            <li>
              <TokenLogo symbol="mUSDC" className="row-badge warn" />
              <span className="row-meta">
                <strong>mUSDC</strong>
                <em>{v.apr}% APR</em>
              </span>
              <span className="row-val">
                <strong>{usd(v.debt)}</strong>
                <em>total owed</em>
              </span>
            </li>
          </ul>

          <dl className="debt-split">
            <div>
              <dt>Principal</dt>
              <dd>{usd(v.principal)}</dd>
            </div>
            <div>
              <dt>Interest accrued</dt>
              <dd className="warn-t">{usd(v.accrued)}</dd>
            </div>
            <div>
              <dt>Since</dt>
              <dd>{ago(v.debtAgeSeconds)}</dd>
            </div>
          </dl>
          <p className="debt-note">
            Interest accrues per second at {v.apr}% and is added to principal whenever the
            loan is touched — the same checkpoint VeraPool takes on every call.
          </p>

          <div className="pair">
            <button className="chip-btn" onClick={() => onAction("borrow")}>
              Borrow more
            </button>
            <button className="chip-btn" onClick={() => onAction("repay")}>
              Repay
            </button>
          </div>
        </section>
      )}
      </div>

      <div className="pcol pcol-b">
      <RiskSection v={v} />

      <section className="pos-group pos-record">
        <h2 className="serif sec-h">On-chain record</h2>
        <ul className="feed">
        {v.activity.slice(0, 6).map((a) => (
          <li key={a.id}>
            <span className={`feed-dot ${a.kind}`} aria-hidden="true" />
            <span className="row-meta">
              <strong>{a.t}</strong>
              <em>
                {KIND_LABEL[a.kind] || "Event"} · {a.when}
              </em>
            </span>
          </li>
          ))}
        </ul>
      </section>
      </div>
    </>
  );
}
