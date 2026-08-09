"use client";

import { useState } from "react";
import { Mark } from "@/components/Logo";
import { ASSETS } from "../useVera";
import { healthTone, pct, qty, usd } from "@/lib/vera";
import TokenLogo from "../TokenLogo";

function EyeIcon({ off }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="15" height="15" aria-hidden="true">
      <path
        d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12Z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.7" />
      {off && <path d="M4 20 20 4" stroke="currentColor" strokeWidth="1.7" />}
    </svg>
  );
}

/** Home — the reference's "Your money" screen, mapped to a credit position. */
export default function HomeTab({ v, onAction, setTab, onPanel, unread }) {
  const [hidden, setHidden] = useState(false);
  const mask = (s) => (hidden ? "••••••" : s);

  const net = v.collateralUsd + v.suppliedUsd - v.debt;
  const held = Object.keys(ASSETS).filter((s) => (v.collateral[s] || 0) > 0);
  // Supplied assets count toward the net position above, so they belong in the
  // list that explains it. Listed after the debt row, which keeps what you owe
  // next to what secures it and puts what you earn last.
  const lent = Object.keys(ASSETS).filter((s) => (v.supplied[s] || 0) > 0);

  // The bar runs to the liquidation threshold so both the drawn amount and the
  // LTV ceiling sit on one scale. Measuring the fill against capacity instead
  // would put the mark and the fill on different axes.
  const liqCapacity = v.collateralUsd * (v.liqThreshold / 100);
  const drawnToLiq = liqCapacity > 0 ? (v.debt / liqCapacity) * 100 : 0;
  const ltvMark = (v.ltv / v.liqThreshold) * 100;

  // An unattested wallet is held at a lower LTV, so a position drawn at the
  // attested ceiling can sit above the anonymous one. Say that outright — a
  // clamped bar would read as "at the limit" when the debt is past it.
  const capacityUsed = v.borrowCapacity > 0 ? (v.debt / v.borrowCapacity) * 100 : 0;
  const overBy = v.debt - v.borrowCapacity;
  const over = overBy > 0.01;

  return (
    <>
      <section className="hd">
        <div>
          <p className="hd-hi">Welcome back</p>
          <h1 className="serif hd-title">Your position</h1>
        </div>
        <div className="hd-icons">
          <button
            className="icon-btn"
            aria-label={unread > 0 ? "Notifications, unread" : "Notifications"}
            onClick={() => onPanel("notifications")}
          >
            {unread > 0 && <span className="icon-badge" aria-hidden="true" />}
            <svg viewBox="0 0 24 24" fill="none" width="17" height="17" aria-hidden="true">
              <path
                d="M18 8.5a6 6 0 1 0-12 0c0 6-2 7.5-2 7.5h16s-2-1.5-2-7.5Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
              />
              <path d="M10.5 19.5a2 2 0 0 0 3 0" stroke="currentColor" strokeWidth="1.7" />
            </svg>
          </button>
          <button
            className="icon-btn"
            aria-label="Settings"
            onClick={() => onPanel("settings")}
          >
            {/* A gear, not a sun. The previous sun-rays glyph read as a
                light-mode switch and the app has no light theme. */}
            <svg viewBox="0 0 24 24" fill="none" width="17" height="17" aria-hidden="true">
              <circle cx="12" cy="12" r="3.1" stroke="currentColor" strokeWidth="1.7" />
              <path
                d="M19.4 15a1.6 1.6 0 0 0 .32 1.77l.06.06a1.9 1.9 0 1 1-2.69 2.69l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-.97 1.47V21a1.9 1.9 0 1 1-3.8 0v-.1a1.6 1.6 0 0 0-1.05-1.47 1.6 1.6 0 0 0-1.77.32l-.06.06a1.9 1.9 0 1 1-2.69-2.69l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.47-.97H3a1.9 1.9 0 1 1 0-3.8h.1a1.6 1.6 0 0 0 1.47-1.05 1.6 1.6 0 0 0-.32-1.77l-.06-.06a1.9 1.9 0 1 1 2.69-2.69l.06.06a1.6 1.6 0 0 0 1.77.32H9a1.6 1.6 0 0 0 .97-1.47V3a1.9 1.9 0 1 1 3.8 0v.1a1.6 1.6 0 0 0 .97 1.47 1.6 1.6 0 0 0 1.77-.32l.06-.06a1.9 1.9 0 1 1 2.69 2.69l-.06.06a1.6 1.6 0 0 0-.32 1.77V9a1.6 1.6 0 0 0 1.47.97H21a1.9 1.9 0 1 1 0 3.8h-.1a1.6 1.6 0 0 0-1.47.97Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </section>

      <section className="bal">
        <button className="bal-label" onClick={() => setHidden((h) => !h)}>
          Net position
          <EyeIcon off={hidden} />
        </button>
        <p className="serif bal-figure">{mask(usd(net))}</p>
        {v.netApy !== null && (
          <p className={`bal-apy${v.netApy >= 0 ? "" : " down"}`}>
            {v.netApy >= 0 ? "+" : ""}
            {pct(v.netApy, 2)} net rate
            <span> · {v.apy}% earned against {v.apr}% paid</span>
          </p>
        )}
      </section>

      <section className={`power${over ? " over" : ""}`}>
        <div className="power-top">
          <span className="duo-k">Borrowing power</span>
          <strong>
            {mask(usd(v.debt, 0))} <span>of {mask(usd(v.borrowCapacity, 0))}</span>
          </strong>
        </div>
        <div className="power-track" role="presentation">
          <span
            className={`power-fill ${healthTone(v.hf)}`}
            style={{ width: `${Math.min(100, drawnToLiq)}%` }}
          />
          <span className="power-mark" style={{ left: `${Math.min(100, ltvMark)}%` }} />
        </div>
        {over ? (
          <p className="power-note warn-t">
            {mask(usd(overBy, 0))} past your {v.ltv}% credit line, so there is nothing left to
            draw. Repay that much or post more collateral to get back under it. Liquidation
            starts at {v.liqThreshold}%.
          </p>
        ) : (
          <p className="power-note">
            {pct(capacityUsed)} of your {v.ltv}% credit line drawn · the mark is that ceiling,
            the end of the bar is the {v.liqThreshold}% liquidation line.
          </p>
        )}
      </section>

      <div className="duo">
        <div className="duo-card">
          <span className="duo-k">Collateral</span>
          <strong className="serif duo-v">{mask(usd(v.collateralUsd))}</strong>
        </div>
        <div className="duo-card">
          <span className="duo-k">Available to draw</span>
          <strong className="serif duo-v">{mask(usd(v.available))}</strong>
          <button
            className="duo-add"
            onClick={() => onAction("deposit")}
            aria-label="Deposit collateral"
          >
            +
          </button>
        </div>
      </div>

      <button className="promo" onClick={() => onAction("borrow")}>
        <span className="orb" aria-hidden="true">
          <Mark size={17} />
        </span>
        <span className="promo-copy">
          <strong>Borrow with Vera</strong>
          <em>Tell me what you need, I&apos;ll price it.</em>
        </span>
        <span className="promo-arrow" aria-hidden="true">
          ↗
        </span>
      </button>

      <section className="hold">
        <h2 className="serif sec-h">What you hold</h2>

        {held.length === 0 && lent.length === 0 ? (
        <div className="blank">
          <p className="blank-h">Nothing here yet</p>
          <p className="blank-p">Deposit an asset to open your first credit line.</p>
        </div>
      ) : (
        <ul className="rows">
          {held.map((s) => (
            <li key={s}>
              <TokenLogo symbol={s} />
              <span className="row-meta">
                <strong>{s}</strong>
                <em>Collateral</em>
              </span>
              <span className="row-val">
                <strong>{mask(usd((v.collateral[s] || 0) * ASSETS[s].price))}</strong>
                <em>{mask(qty(v.collateral[s] || 0, ASSETS[s].dp))}</em>
              </span>
            </li>
          ))}
          {v.debt > 0 && (
            <li>
              <span className="row-badge warn" aria-hidden="true">
                DB
              </span>
              <span className="row-meta">
                <strong>Borrowed</strong>
                <em>mUSDC at {v.apr}% APR</em>
              </span>
              <span className="row-val">
                <strong>{mask(usd(v.debt))}</strong>
                <em>HF {v.hf === null ? "—" : v.hf.toFixed(2)}</em>
              </span>
            </li>
          )}
          {lent.map((s) => (
            <li key={`supplied-${s}`}>
              <TokenLogo symbol={s} />
              <span className="row-meta">
                <strong>Supplied</strong>
                <em>
                  {s} earning {v.apy}% APY
                </em>
              </span>
              <span className="row-val">
                <strong>{mask(usd((v.supplied[s] || 0) * ASSETS[s].price))}</strong>
                <em>{mask(qty(v.supplied[s] || 0, ASSETS[s].dp))}</em>
              </span>
            </li>
          ))}
        </ul>
      )}

      </section>

      <button className="trustline" onClick={() => setTab("vera")}>
        <span className="trustline-tick" aria-hidden="true">
          ✓
        </span>
        Every draw signed &amp; recorded on Monad
        <span className="trustline-arrow" aria-hidden="true">
          ›
        </span>
      </button>
    </>
  );
}
