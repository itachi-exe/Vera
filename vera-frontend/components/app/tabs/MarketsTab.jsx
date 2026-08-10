"use client";

import { useEffect, useMemo, useState } from "react";
import PoolStats from "../PoolStats";
import { ASSETS } from "../useVera";
import { usd } from "@/lib/vera";
import TokenLogo from "../TokenLogo";

const FILTERS = ["All", "Collateral", "Stables", "Borrowable"];

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

/**
 * What a pool asset is, in the deployed contract's terms.
 *
 * `VeraPool` is single-collateral and single-debt by construction, so exactly
 * one of these rows is depositable, one is borrowable, and one is neither —
 * priced by the oracle but not listed. Saying so beats an LTV figure for a
 * token the pool would refuse.
 */
function role(a, v) {
  if (a.collateral) return `up to ${v.ltv}% LTV · collateral`;
  if (a.kind === "stable") return `${v.apy}% APY · borrowable`;
  return "priced by the oracle · not listed";
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
        // The chips describe the pool's own roles, so they read off the same
        // flags the contract enforces rather than off what happens to be
        // deposited right now.
        if (filter === "Stables" && a.kind !== "stable") return false;
        if (filter === "Collateral" && !a.collateral) return false;
        if (filter === "Borrowable" && a.kind !== "stable") return false;
        const t = `${a.symbol} ${a.name}`.toLowerCase();
        return t.includes(q.trim().toLowerCase());
      })
      .map((a) => ({
        ...a,
        // The oracle's number once /api/pool has answered. There is no 24h
        // series to draw against it: these are testnet mocks priced by a
        // contract we set, so a sparkline here would be decoration, not data.
        price: v.prices?.[a.symbol] ?? a.price,
        role: role(a, v),
      }));
  }, [q, filter, v.apy, v.ltv, v.prices]);

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
                  <em>{a.role}</em>
                </span>
                <span className="row-val">
                  <strong>{usd(a.price, a.price < 10 ? 4 : 2)}</strong>
                  <em>{v.pool.live ? "pool oracle" : "last known"}</em>
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
