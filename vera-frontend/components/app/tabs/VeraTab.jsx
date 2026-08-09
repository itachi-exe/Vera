"use client";

import { useState } from "react";
import { Mark } from "@/components/Logo";
import ScoreSimulator from "../ScoreSimulator";
import { SCORE_MAX, shortAddr } from "@/lib/vera";

const PILLARS = [
  { k: "Signed", v: "Every attestation carries its issuer's signature" },
  { k: "Recorded", v: "Every score and draw is written to Monad" },
  { k: "Open", v: "Anyone can audit the full history on-chain" },
];

function Ring({ score, verified }) {
  const r = 62;
  const c = 2 * Math.PI * r;
  const frac = Math.min(1, score / SCORE_MAX);
  return (
    <div className="vring">
      <svg viewBox="0 0 160 160" aria-hidden="true">
        <circle cx="80" cy="80" r={r} className="vring-track" />
        <circle
          cx="80"
          cy="80"
          r={r}
          className={`vring-bar${verified ? " on" : ""}`}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
        />
      </svg>
      <span className="vring-mid">
        <strong className="serif">{score}</strong>
        <em>of {SCORE_MAX}</em>
      </span>
    </div>
  );
}

/** Vera — the reference's agent screen, carrying the trust and CVI/CVA story. */
export default function VeraTab({ v, onAction }) {
  const attested = v.identity?.verified;
  // "We could not check" is not "you failed the check". Only check-failed means
  // the screen never ran, so it has to read as unknown rather than as an
  // accusation — an upstream stall is not a finding about the wallet. Every
  // other status in lib/apass.js is a real determination and stays "Blocked".
  const cvaUnknown = !v.compliance || v.compliance.status === "check-failed";
  const [copied, setCopied] = useState(false);

  const copyRef = async () => {
    try {
      await navigator.clipboard.writeText(v.identity.ref);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked on insecure origins — hash is still in the title */
    }
  };

  return (
    <>
      <div className="agent">
        <span className="orb orb-lg" aria-hidden="true">
          <Mark size={34} />
        </span>
        <h1 className="serif agent-name">Vera</h1>
        <p className="agent-role">your lending agent</p>

        <p className={`agent-badge${attested ? " on" : ""}`}>
          <span className="agent-tick" aria-hidden="true">
            {attested ? "✓" : "!"}
          </span>
          {attested ? "Verified wallet" : "Unverified wallet"}
          <strong>№{v.score}</strong>
        </p>

        {/* The live A-Pass ref is a full 66-char hash. Rendered raw it is an
            unbreakable monospace string ~457px wide, which blew the layout out
            past a phone viewport, so it is truncated for display.
            This used to carry a "↗" inside a plain <p> — an external-link
            affordance on something that was not clickable. It is now a real
            button that copies the full hash. */}
        {/* A failed lookup and a wallet with no attestation both end up
            unverified, priced at the anonymous tier. Saying which one this is
            matters: one is a fact about the wallet, the other is a fact about
            the network. */}
        {v.identity?.error && (
          <p className="agent-stale">
            Could not reach the CVI issuer, so this wallet is held at the
            unattested tier until the check succeeds. Nothing here is assumed in
            your favour.
            <button onClick={v.recheck} disabled={v.checking}>
              {v.checking ? "Checking…" : "Try again"}
            </button>
          </p>
        )}

        {v.identity?.ref ? (
          <button
            className="agent-reg"
            onClick={copyRef}
            title={v.identity.ref}
            aria-label="Copy the full CVI attestation reference"
          >
            CVI attestation <span>{shortAddr(v.identity.ref)}</span>
            <em>{copied ? "copied" : "copy"}</em>
          </button>
        ) : (
          <p className="agent-reg">
            CVI attestation <span>none</span>
          </p>
        )}
      </div>

      <div className="vcol vcol-a">
      <div className="stats">
        <div>
          <strong className="serif">{v.score}</strong>
          <span>Trust score</span>
        </div>
        <div>
          <strong className="serif accent">{v.ltv}%</strong>
          <span>Your LTV</span>
        </div>
        <div>
          <strong className="serif">{v.apr}%</strong>
          <span>Borrow APR</span>
        </div>
      </div>

      <div className="scorecard">
        <Ring score={v.score} verified={v.attested} />
        <dl className="vweights">
          {v.breakdown.map((b) => (
            <div key={b.key} className={b.locked ? "locked" : ""}>
              <dt>
                {b.label}
                <em>{Math.round(b.weight * 100)}%</em>
              </dt>
              <dd>
                <span className="vbar">
                  <span style={{ width: `${(b.points / b.max) * 100}%` }} />
                </span>
                <i>
                  {b.points}
                  <em>/{b.max}</em>
                </i>
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="duo">
        <div className={`chk${attested ? " ok" : " off"}`}>
          <span className="chk-dot" aria-hidden="true" />
          <span className="duo-k">CVI · Identity</span>
          <strong className="serif chk-v">{attested ? "Attested" : "None"}</strong>
          <em>{v.identity?.issuer || "No attestation"}</em>
        </div>
        <div
          className={`chk${
            v.compliance?.cleared ? " ok" : cvaUnknown ? " off" : " bad"
          }`}
        >
          <span className="chk-dot" aria-hidden="true" />
          <span className="duo-k">CVA · Compliance</span>
          <strong className="serif chk-v">
            {v.compliance?.cleared ? "Cleared" : cvaUnknown ? "Unknown" : "Blocked"}
          </strong>
          <em>{v.compliance?.status ?? "not checked yet"}</em>
        </div>
      </div>

      <div className="quote-card">
        <span className="orb" aria-hidden="true">
          <Mark size={17} />
        </span>
        <p>
          &ldquo;I price credit from a score you can audit. Every attestation I read and
          every draw I approve is signed and recorded, so my record can&apos;t be edited
          after the fact.&rdquo;
        </p>
      </div>

      <ul className="pillars">
        {PILLARS.map((p) => (
          <li key={p.k}>
            <span className="pillar-tick" aria-hidden="true">
              ✓
            </span>
            <span className="row-meta">
              <strong>{p.k}</strong>
              <em>{p.v}</em>
            </span>
          </li>
        ))}
      </ul>

      <p className="fineprint">
        CVI and CVA run live against the Cleanverse sandbox on Monad. Every identity and
        compliance field shown is read from the API response — none are invented. Pool-wide
        figures are marked where they come from a local baseline instead.
      </p>

      </div>

      <div className="vcol vcol-b">
      <button className="promo" onClick={() => onAction("borrow")}>
        <span className="orb" aria-hidden="true">
          <Mark size={17} />
        </span>
        <span className="promo-copy">
          <strong>Draw against your score</strong>
          <em>{v.ltv}% LTV at {v.apr}% APR, priced now.</em>
        </span>
        <span className="promo-arrow" aria-hidden="true">
          ↗
        </span>
      </button>

      <div className="demo">
        <div className="demo-copy">
          <p className="demo-h">{v.mode === "live" ? "Your wallet" : "Demo mode"}</p>
          <p className="demo-p">
            {v.mode === "live"
              ? "Scoring the wallet you connected, against live Cleanverse data."
              : "Same wallet, same collateral. Only the CVI attestation changes."}
          </p>
        </div>
        {/* In live mode the score belongs to a real address, so a control that
            swaps sandbox wallets would be misleading. Offer the way back to
            demo instead of a toggle that no longer applies. */}
        {v.mode === "live" ? (
          <button className="btn btn-ghost btn-sm" onClick={v.useDemoMode}>
            Use demo wallets
          </button>
        ) : (
          <div className="seg" role="group" aria-label="Demo mode">
            <button
              className={!v.verified ? "on" : ""}
              onClick={() => v.setVerified(false)}
              aria-pressed={!v.verified}
            >
              Anonymous
            </button>
            <button
              className={v.verified ? "on" : ""}
              onClick={() => v.setVerified(true)}
              aria-pressed={v.verified}
            >
              Verified
            </button>
            {v.checking && <span className="seg-spin" aria-label="Checking" />}
          </div>
        )}
      </div>

      <ScoreSimulator v={v} />
      </div>
    </>
  );
}
