"use client";

import Link from "next/link";
import { useState } from "react";
import Logo, { Mark } from "@/components/Logo";
import { shortAddr } from "@/lib/vera";
import ActionSheet from "./ActionSheet";
import AssetSheet from "./AssetSheet";
import SystemSheet from "./SystemSheet";
import TabBar from "./TabBar";
import HomeTab from "./tabs/HomeTab";
import MarketsTab from "./tabs/MarketsTab";
import PositionsTab from "./tabs/PositionsTab";
import VeraTab from "./tabs/VeraTab";
import { useHydrated } from "./useHydrated";
import { useModalShell } from "./useModalShell";
import { useVera } from "./useVera";

function Connect({ v }) {
  const ready = useHydrated();
  const err = v.walletError;
  const noProvider = err?.code === "no-provider";

  return (
    <div className="connect">
      <div className="connect-card">
        <span className="orb orb-lg" aria-hidden="true">
          <Mark size={34} />
        </span>
        <h1 className="serif connect-h">
          See what your
          <br />
          <em>reputation</em> is worth.
        </h1>
        <p className="connect-p">
          Vera reads your CVI attestation and compliance standing, then prices a credit
          line against them.
        </p>
        {/* With several wallets installed, `window.ethereum` holds whichever
            extension won the injection race, so a single "Connect" button is a
            coin flip. When EIP-6963 turns up more than one, name them and let
            the user choose. One wallet stays one click. */}
        {ready && v.needsWalletChoice ? (
          <div className="wallet-pick" role="group" aria-label="Choose a wallet">
            {v.wallets.map((w) => (
              <button
                key={w.rdns}
                className="btn btn-ghost wallet-opt"
                onClick={() => v.connect(w.rdns)}
                disabled={v.connecting}
              >
                {/* Wallet-supplied data URI. Decorative — the name is the label. */}
                {w.icon ? <img src={w.icon} alt="" width={20} height={20} /> : null}
                <span>{w.name}</span>
              </button>
            ))}
          </div>
        ) : (
          <button
            className="btn btn-primary connect-cta"
            onClick={v.connect}
            disabled={!ready || v.connecting}
            aria-busy={!ready || v.connecting}
          >
            {!ready ? "Starting…" : v.connecting ? "Connecting…" : "Connect wallet"}
          </button>
        )}

        {/* Every failure is named. A connect flow that fails silently reads as a
            broken button, and the user retries the thing that cannot work. */}
        {ready && err ? (
          <p className="connect-err" role="alert">
            {err.message}
          </p>
        ) : null}

        {/* The sandbox wallets stay reachable — most judges will not have a
            Monad-funded wallet to hand, and the demo path is the honest way to
            show the protocol without pretending the connection succeeded. */}
        <button
          className="btn btn-ghost connect-demo"
          onClick={v.useDemoMode}
          disabled={!ready}
        >
          {noProvider ? "Continue in demo mode" : "Or explore in demo mode"}
        </button>

        <p className="connect-note">
          {ready ? "Monad testnet · no real funds" : "Loading the app…"}
        </p>
      </div>
    </div>
  );
}

/** Menu behind the centre FAB. */
function FabMenu({ onPick, onClose }) {
  // Escape + inert the shell behind, same as the sheets.
  useModalShell(true, onClose);

  const items = [
    { id: "borrow", label: "Borrow", hint: "Draw against your collateral" },
    { id: "repay", label: "Repay", hint: "Pay down the loan, interest first" },
    { id: "deposit", label: "Deposit", hint: "Add collateral" },
    { id: "withdraw", label: "Withdraw", hint: "Take collateral back" },
    { id: "supply", label: "Supply", hint: "Earn on idle assets" },
    { id: "withdrawSupply", label: "Unsupply", hint: "Pull supplied assets out" },
    { id: "faucet", label: "Get test tokens", hint: "Mint mock ERC-20s" },
  ];

  return (
    <div className="fabmenu-wrap" role="dialog" aria-modal="true" aria-label="Actions">
      <button className="sheet-scrim" aria-label="Close" onClick={onClose} />
      <div className="fabmenu">
        <span className="fabmenu-grip" aria-hidden="true" />
        <h2 className="serif fabmenu-h">What would you like to do?</h2>
        <ul>
          {items.map((i) => (
            <li key={i.id}>
              <button onClick={() => onPick(i.id)}>
                <span className="row-meta">
                  <strong>{i.label}</strong>
                  <em>{i.hint}</em>
                </span>
                <span aria-hidden="true">›</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function AppClient() {
  const v = useVera();
  const [tab, setTab] = useState("home");
  const [sheet, setSheet] = useState(null);
  // Asset the sheet should open on, when the user picked one in Markets.
  const [preset, setPreset] = useState(null);
  const [asset, setAsset] = useState(null);
  const [fab, setFab] = useState(false);
  const [panel, setPanel] = useState(null);
  // Notification count: anything logged since the panel was last opened.
  const [seen, setSeen] = useState(0);
  const unread = Math.max(0, v.activity.length - seen);

  // Copy the full address, not the truncated label on screen — a shortened
  // address pasted into a wallet is worse than nothing. clipboard.writeText
  // needs a secure context, so the textarea path covers plain-HTTP LAN testing
  // where it is undefined.
  const [copied, setCopied] = useState(false);
  const copyAddress = async () => {
    const addr = v.subject;
    if (!addr) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(addr);
      } else {
        const ta = document.createElement("textarea");
        ta.value = addr;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard blocked by permissions policy. Leave the label unchanged
      // rather than claiming a copy that did not happen.
    }
  };

  const openPanel = (id) => {
    if (id === "notifications") setSeen(v.activity.length);
    setPanel(id);
  };

  const act = (id, sym = null) => {
    setFab(false);
    setAsset(null);
    setPreset(sym);
    setSheet(id);
  };

  return (
    <div className="app">
      <div className="app-glow" aria-hidden="true" />

      <header className="app-bar">
        <Link href="/" className="app-brand" aria-label="Vera home">
          <Logo size={18} />
        </Link>
        {v.connected ? (
          <button
            className="wallet"
            onClick={copyAddress}
            title={copied ? "Address copied" : "Click to copy wallet address"}
            aria-label={
              copied ? "Wallet address copied" : `Copy wallet address ${v.subject}`
            }
          >
            {v.mode === "demo" ? <span className="wallet-tag">demo</span> : null}
            {copied ? "Copied" : shortAddr(v.subject)}
          </button>
        ) : (
          <Link href="/" className="app-back">
            Back to site
          </Link>
        )}
      </header>

      {/* A connected-but-wrong-network wallet cannot transact. Say it once, at
          the top, with the fix attached — not buried in a settings sheet. */}
      {v.connected && v.mode === "live" && !v.chainOk ? (
        <div className="chain-warn" role="alert">
          <span>Wrong network. Vera runs on Monad testnet.</span>
          <button className="btn btn-ghost btn-sm" onClick={v.switchNetwork}>
            Switch network
          </button>
        </div>
      ) : null}

      {!v.connected ? (
        <Connect v={v} />
      ) : (
        <>
          <main className={`screen screen-${tab}`} key={tab}>
            {tab === "home" && (
              <HomeTab
                v={v}
                onAction={act}
                setTab={setTab}
                onPanel={openPanel}
                unread={unread}
              />
            )}
            {tab === "markets" && (
              <MarketsTab v={v} onAction={act} onAsset={setAsset} />
            )}
            {tab === "positions" && <PositionsTab v={v} onAction={act} />}
            {tab === "vera" && <VeraTab v={v} onAction={act} />}
          </main>

          <TabBar tab={tab} setTab={setTab} onFab={() => setFab(true)} />
        </>
      )}

      {fab && <FabMenu onPick={act} onClose={() => setFab(false)} />}
      <AssetSheet sym={asset} onClose={() => setAsset(null)} onAction={act} v={v} />
      <ActionSheet action={sheet} preset={preset} onClose={() => setSheet(null)} v={v} />
      <SystemSheet panel={panel} onClose={() => setPanel(null)} v={v} />
    </div>
  );
}
