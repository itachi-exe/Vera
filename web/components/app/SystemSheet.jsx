"use client";

import { useState } from "react";
import Sheet from "./Sheet";
import { INTEGRATION_STATUS } from "@/lib/cleanverse";
import { shortAddr } from "@/lib/vera";

const KIND_LABEL = {
  borrow: "Borrow",
  deposit: "Deposit",
  withdraw: "Withdraw",
  supply: "Supply",
  repay: "Repay",
  verify: "Identity",
  mint: "Faucet",
};

/**
 * The two header controls. Previously the bell jumped to Positions and a
 * sun icon jumped to the Vera tab — a sun reads as a light-mode switch, so
 * it promised something the app does not do. Both now open the panel their
 * icon implies.
 */
export default function SystemSheet({ panel, onClose, v }) {
  const [copied, setCopied] = useState(false);
  const address = v.subject;

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked (insecure origin) — the value is still on screen */
    }
  };

  if (panel === "notifications") {
    return (
      <Sheet
        open
        onClose={onClose}
        title="Notifications"
        sub="Everything Vera has recorded for this wallet, newest first."
      >
        {v.activity.length === 0 ? (
          <div className="blank">
            <p className="blank-h">Nothing yet</p>
            <p className="blank-p">
              Deposits, draws and attestations show up here as they happen.
            </p>
          </div>
        ) : (
          <ul className="feed">
            {v.activity.map((a) => (
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
        )}
      </Sheet>
    );
  }

  if (panel === "settings") {
    return (
      <Sheet
        open
        onClose={onClose}
        title="Settings"
        sub="Wallet, network, and how this demo presents your identity."
        footer={
          <button
            className="btn btn-secondary sheet-cta"
            onClick={() => {
              onClose();
              v.disconnect();
            }}
          >
            Disconnect wallet
          </button>
        }
      >
        <span className="amt-label">Identity source</span>
        <div className="seg" role="group" aria-label="Identity source">
          <button
            className={v.mode === "demo" ? "on" : ""}
            onClick={v.useDemoMode}
            aria-pressed={v.mode === "demo"}
          >
            Demo wallets
          </button>
          <button
            className={v.mode === "live" ? "on" : ""}
            onClick={v.connect}
            aria-pressed={v.mode === "live"}
            disabled={v.connecting}
          >
            {v.connecting ? "Connecting…" : "My wallet"}
          </button>
          {v.checking && <span className="seg-spin" aria-label="Checking" />}
        </div>
        <p className="set-note">
          {v.mode === "live"
            ? "Scoring the wallet you connected. Both paths run the same live CVI and CVA lookups."
            : "Scoring a sandbox wallet. Both are real Cleanverse records — one holds an A-Pass, one does not."}
        </p>

        {/* The toggle only picks between the two sandbox wallets, so it is
            meaningless once a real address is driving the lookup. Hiding it
            there beats leaving a control that silently does nothing. */}
        {v.mode === "demo" ? (
          <>
            <span className="amt-label">Demo wallet</span>
            <div className="seg" role="group" aria-label="Demo wallet">
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
            </div>
          </>
        ) : null}

        <span className="amt-label">Wallet</span>
        <div className="set-rows">
          <button className="set-row" onClick={() => copy(address)}>
            <span>Address</span>
            <strong>
              {shortAddr(address)}
              <em>{copied ? "copied" : "copy"}</em>
            </strong>
          </button>
          <div className="set-row">
            <span>Network</span>
            <strong className={v.mode === "live" && !v.chainOk ? "warn-t" : ""}>
              {v.mode === "live"
                ? v.chainOk
                  ? "Monad testnet"
                  : `Wrong network (chain ${v.chainId ?? "unknown"})`
                : "Monad testnet"}
            </strong>
          </div>
          <div className="set-row">
            <span>Pool</span>
            <strong className={v.poolDeployed ? "accent" : ""}>
              {v.poolDeployed ? shortAddr(v.deployment.pool) : "Not deployed yet"}
            </strong>
          </div>
          <div className="set-row">
            <span>Identity</span>
            <strong className={v.identity?.verified ? "accent" : v.identity?.error ? "warn-t" : ""}>
              {v.identity?.verified
                ? "A-Pass attested"
                : v.identity?.error
                  ? "Check failed"
                  : "No attestation"}
            </strong>
          </div>
          <div className="set-row">
            <span>Compliance</span>
            <strong className={v.compliance?.cleared ? "accent" : v.compliance?.error ? "warn-t" : ""}>
              {v.compliance?.cleared
                ? "Cleared"
                : v.compliance?.error
                  ? "Check failed"
                  : "Not cleared"}
            </strong>
          </div>
        </div>

        <span className="amt-label">Integration status</span>
        <div className="set-rows">
          <div className="set-row">
            <span>CVI identity</span>
            {v.identity?.error ? (
              <strong className="warn-t">Unreachable · last check failed</strong>
            ) : (
              <strong className="accent">Live · sandbox API v5.6</strong>
            )}
          </div>
          <div className="set-row">
            <span>CVA compliance</span>
            {v.compliance?.error ? (
              <strong className="warn-t">Unreachable · last check failed</strong>
            ) : (
              <strong className={INTEGRATION_STATUS.cva === "live" ? "accent" : "warn-t"}>
                {INTEGRATION_STATUS.cva === "live"
                  ? "Live"
                  : "Attestation live · on-chain pending"}
              </strong>
            )}
          </div>
          <div className="set-row">
            <span>VeraPool</span>
            <strong className="warn-t">Not deployed yet</strong>
          </div>
          <div className="set-row">
            <span>Protocol math</span>
            <strong>lib/vera.js ↔ VeraMath.sol</strong>
          </div>
        </div>
        <p className="set-note">
          Identity and compliance are real calls against the Cleanverse sandbox. The pool
          itself is not deployed, so balances and pool-wide figures come from local demo
          state — the UI enforces exactly the rules{" "}
          <code>VeraPool</code> does, and every rejection you see names the contract error
          the real call would have reverted with.
        </p>

      </Sheet>
    );
  }

  return null;
}
