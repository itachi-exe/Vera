"use client";

import { useEffect, useMemo, useState } from "react";
import PoolStats from "../PoolStats";
import { ASSETS } from "../useVera";
import { usd } from "@/lib/vera";
import TokenLogo from "../TokenLogo";

const FILTERS = ["All", "Collateral", "Stables", "Borrowable"];

const SERIES = {
  mUSDC: [12, 12, 11, 12, 12, 13, 12, 12, 12, 12],
  mETH: [8, 11, 9, 13, 12, 16, 14, 18, 17, 20],
  mWBTC: [19, 17, 18, 14, 15, 12, 13, 10, 11, 9],
};

const DELTA = { mUSDC: 0.01, mETH: 2.41, mWBTC: -1.36 };

/**
 * Monad-native assets quoted live, not yet listed as markets.
 *
 * The pool holds three mock ERC-20s because that is what `Deploy.s.sol`
 * deploys; adding a fourth here would offer a deposit the contract cannot take.
 * So these rows carry a real price and no action, and say which they are. MON
 * is the gas token, the other two are the liquid-staking tokens built on it —
 * the assets a Monad lender lists next, in the order it would list them.
 */
const ECOSYSTEM = [
  { symbol: "MON", note: "Native gas token · quote only" },
  { symbol: "aprMON", note: "aPriori liquid staking · quote only" },
  { symbol: "shMON", note: "ShMonad liquid staking · quote only" },
];

function Spark({ points, up }) {
  const w = 62;
  const h = 26;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p - min) / span) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} fill="none" aria-hidden="true">
      <path
        d={d}
        stroke={up ? "var(--accent)" : "var(--warn)"}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Markets — the reference's Market screen: search, filter chips, asset rows. */
export default function MarketsTab({ v, onAction, onAsset }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("All");
  // null while the first request is in flight, so "loading" and "unavailable"
  // are distinguishable states rather than one empty cell.
  const [feed, setFeed] = useState(null);

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/prices", { signal: ac.signal })
      .then((r) => r.json())
      .then((d) => setFeed(d))
      // The route already fails soft; this catches the request never landing.
      .catch(() => setFeed({ ok: false, prices: {} }));
    return () => ac.abort();
  }, []);

  const rows = useMemo(() => {
    return Object.values(ASSETS)
      .filter((a) => {
        if (filter === "Stables" && a.kind !== "stable") return false;
        if (filter === "Collateral" && (v.collateral[a.symbol] || 0) <= 0) return false;
        if (filter === "Borrowable" && a.kind !== "stable") return false;
        const t = `${a.symbol} ${a.name}`.toLowerCase();
        return t.includes(q.trim().toLowerCase());
      })
      .map((a) => ({
        ...a,
        delta: DELTA[a.symbol],
        apy: a.kind === "stable" ? v.apy : Number((v.apy * 0.42).toFixed(1)),
        maxLtv: a.kind === "stable" ? Math.min(v.ltv + 5, 95) : v.ltv,
      }));
  }, [q, filter, v.apy, v.ltv, v.collateral]);

  // Quoted, not listed: they are neither collateral nor borrowable, so every
  // filter but "All" excludes them. Search still reaches them.
  const eco = useMemo(() => {
    if (filter !== "All") return [];
    const needle = q.trim().toLowerCase();
    return ECOSYSTEM.filter((a) => a.symbol.toLowerCase().includes(needle));
  }, [q, filter]);

  return (
    <>
      <div className="mkt-head">
        <h1 className="serif page-h">Markets</h1>

        <label className="search">
        <svg viewBox="0 0 24 24" fill="none" width="17" height="17" aria-hidden="true">
          <circle cx="11" cy="11" r="6.6" stroke="currentColor" strokeWidth="1.8" />
          <path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search assets"
          aria-label="Search assets"
        />
        </label>
      </div>

      <div className="filters">
        {FILTERS.map((f) => (
          <button
            key={f}
            className={`filter${filter === f ? " on" : ""}`}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
          >
            {f}
          </button>
        ))}
      </div>

      {rows.length === 0 && eco.length === 0 ? (
        <div className="blank">
          <p className="blank-h">No assets match</p>
          <p className="blank-p">Try a different search or filter.</p>
        </div>
      ) : (
        <ul className="rows">
          {rows.map((a) => (
            <li key={a.symbol}>
              <button
                type="button"
                className="row-hit"
                onClick={() => onAsset(a.symbol)}
                aria-label={`${a.name} details`}
              >
                <TokenLogo symbol={a.symbol} />
                <span className="row-meta">
                  <strong>{a.symbol}</strong>
                  <em>
                    {a.kind === "stable" ? `${a.apy}% APY · borrowable` : `up to ${a.maxLtv}% LTV`}
                  </em>
                </span>
                <Spark points={SERIES[a.symbol]} up={a.delta >= 0} />
                <span className="row-val">
                  <strong>{usd(a.price, a.price < 10 ? 4 : 2)}</strong>
                  <em className={a.delta >= 0 ? "up" : "down"}>
                    {a.delta >= 0 ? "+" : ""}
                    {a.delta}%
                  </em>
                </span>
              </button>
            </li>
          ))}

          {eco.length > 0 && (
            <li className="rows-div">
              <span>Monad ecosystem</span>
              <em>
                {feed?.ok === false && feed?.stale
                  ? "last known price"
                  : "live price, listing next"}
              </em>
            </li>
          )}

          {eco.map((a) => {
            const p = feed?.prices?.[a.symbol];
            const up = p && p.change24h !== null ? p.change24h >= 0 : true;
            return (
              <li key={a.symbol} className="row-quote">
                <TokenLogo symbol={a.symbol} className="row-badge quote" />
                <span className="row-meta">
                  <strong>{a.symbol}</strong>
                  <em>{a.note}</em>
                </span>
                <span className="row-val">
                  <strong>{p ? usd(p.usd, 4) : feed === null ? "Fetching" : "Unavailable"}</strong>
                  {p && p.change24h !== null ? (
                    <em className={up ? "up" : "down"}>
                      {up ? "+" : ""}
                      {p.change24h.toFixed(2)}%
                    </em>
                  ) : (
                    <em>24h</em>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <PoolStats pool={v.pool} />

      <div className="mkt-note">
        <p>
          Max LTV follows your trust score. At <strong>{v.score}</strong> you borrow up to{" "}
          <strong className="accent">{v.ltv}%</strong> against volatile collateral.
        </p>
        <button className="chip-btn" onClick={() => onAction("faucet")}>
          Get test tokens
        </button>
      </div>
    </>
  );
}
