"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import { shortAddr } from "@/lib/vera";

const SECTIONS = [
  { id: "vera", label: "Vera" },
  { id: "how", label: "How it works" },
  { id: "trust", label: "Trust score" },
  { id: "features", label: "Features" },
  { id: "architecture", label: "Architecture" },
  { id: "contracts", label: "Contracts" },
  { id: "security", label: "Security & credentials" },
  { id: "demo", label: "Try the demo" },
];

const POOL = "0x8195157976EbC72fa422391CAb47E71b58623E28";
const ORACLE = "0xd3B2B60610AAF874Cf92078fBF156F897C130B4B";
const COLLATERAL = "0x0d6510547e521eeC5accf33a039335753433E00c";
const DEBT = "0x3e42243B7f24C4d5aaF5E7e921D08B38eEdDEFa6";
const EXTRA = "0xa3A0c4EF06E649106536e91b5e286A28F0704f04";
const DEMO_WALLET = "0x5702b24116718DCF49314231222A33403e88Aff8";
const ANON_WALLET = "0xdEaD00000000000000000000000000000000bEEf";

/**
 * Scrollspy: highlight whichever section is nearest the top of the viewport.
 * Mirrors NavBar's own scroll listener rather than pulling in a new pattern —
 * this page is the same site, not a different one.
 */
function useActiveSection(ids) {
  const [active, setActive] = useState(ids[0]);
  const ticking = useRef(false);

  useEffect(() => {
    const onScroll = () => {
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(() => {
        ticking.current = false;
        const y = window.scrollY + 140;
        let current = ids[0];
        for (const id of ids) {
          const el = document.getElementById(id);
          if (el && el.offsetTop <= y) current = id;
        }
        setActive(current);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [ids]);

  return active;
}

export default function DocClient() {
  const ids = SECTIONS.map((s) => s.id);
  const active = useActiveSection(ids);

  return (
    <>
      <NavBar />
      <main className="doc">
        <div className="container">
          <div className="doc-head">
            <span className="eyebrow">Documentation</span>
            <h1 className="serif">Everything Vera is, in one page.</h1>
            <p className="lede">
              What the protocol does, how the trust score is computed, what runs where, and
              what is — and is not — real about this build. Nothing below is simplified for
              the pitch; it is the same math and the same endpoints the app calls.
            </p>

            <div className="doc-facts">
              <span className="doc-fact live">
                <b>Monad testnet</b> · chain 10143
              </span>
              <span className="doc-fact">
                Pool <b>{shortAddr(POOL)}</b>
              </span>
              <span className="doc-fact">
                Cleanverse <b>CVI + CVA</b>, live sandbox
              </span>
              <span className="doc-fact">
                <b>Non-custodial</b>
              </span>
            </div>
          </div>

          <div className="doc-shell">
            <nav className="doc-toc" aria-label="On this page">
              <span className="doc-toc-h">On this page</span>
              {SECTIONS.map((s) => (
                <a key={s.id} href={`#${s.id}`} className={active === s.id ? "on" : ""}>
                  {s.label}
                </a>
              ))}
            </nav>

            <div className="doc-body">
              {/* ---------- Vera ---------- */}
              <section id="vera" className="doc-sec">
                <h2 className="serif">What Vera is</h2>
                <p>
                  Vera is a trust-based lending protocol. Every other DeFi money market prices
                  a borrower as a stranger and asks for collateral to compensate — an honest,
                  verifiable wallet gets the same 45–50% loan-to-value as an anonymous address
                  with no history, because the protocol has no way to tell them apart. Vera
                  reads two things a stranger cannot fake — a signed identity attestation and
                  an on-chain compliance check — and turns them into better terms. Proving
                  yourself is a benefit, not a gate: an anonymous wallet can still borrow, just
                  at a lower ceiling.
                </p>
                <p>
                  Concretely, that means three things run underneath every number the app
                  shows:
                </p>
                <ul className="doc-ul">
                  <li>
                    <strong>CVI</strong> (Cleanverse Identity) — a signed attestation that a
                    wallet belongs to a verified person, without revealing who. Vera reads it as
                    the identity component of the trust score.
                  </li>
                  <li>
                    <strong>CVA</strong> (Cleanverse Asset compliance) — checked before any draw
                    executes. A wallet that fails is refused at the contract, not flagged after
                    the money has moved.
                  </li>
                  <li>
                    <strong>VeraPool</strong> — a non-custodial Solidity contract on Monad
                    testnet that holds collateral, issues debt, and enforces the same LTV and
                    liquidation rules the UI quotes.
                  </li>
                </ul>
                <p>
                  The app runs entirely as a local simulation on top of these — it computes and
                  displays results, but it does not itself submit transactions. CVI and CVA are
                  real, live calls against the Cleanverse sandbox; the pool state shown is a
                  real, live read of what is in <code className="inline">VeraPool</code>{" "}
                  storage on Monad. See{" "}
                  <a href="#architecture">Architecture</a> for exactly where the line between
                  &ldquo;real&rdquo; and &ldquo;simulated&rdquo; sits.
                </p>
              </section>

              {/* ---------- How it works ---------- */}
              <section id="how" className="doc-sec">
                <h2 className="serif">How it works</h2>
                <p>Three steps, in the order a wallet actually takes them.</p>

                <h3>1. Verify once with CVI</h3>
                <p>
                  Connect a wallet and Vera looks it up against Cleanverse&apos;s{" "}
                  <code className="inline">query_apass</code> endpoint. If the wallet holds an
                  A-Pass, Vera reads the attestation — never documents, never personal data.
                  If it has none, <code className="inline">query_apass</code> returns a normal
                  200 with a business code saying so; Vera treats &ldquo;no A-Pass&rdquo; as a
                  state, not an error, and prices the wallet as anonymous rather than failing
                  the page.
                </p>

                <h3>2. Get a trust score</h3>
                <p>
                  Identity, on-chain history, and repayment record combine into one score from
                  0 to 1000. Identity carries 30% of the weight, history 45%, repayment 25% —
                  published weights, not a black box. Without an attestation the identity term
                  contributes exactly zero; that is the entire mechanism by which verifying
                  helps you. See <a href="#trust">Trust score</a> for the formula.
                </p>

                <h3>3. Borrow at your LTV</h3>
                <p>
                  The score sets a loan-to-value ceiling on a continuous curve, not a tier
                  lookup — one point of score moves the ceiling by a fixed, published amount.
                  Before any draw executes, Vera calls Cleanverse&apos;s{" "}
                  <code className="inline">validator/verify</code> endpoint for the borrowing
                  wallet. A wallet that fails this check is refused at the pool, regardless of
                  how good its score is: compliance fails closed, never open.
                </p>

                <div className="doc-note">
                  <h4>Fails closed, by design</h4>
                  <p>
                    An unrun or failed compliance check reports <code className="inline">
                      cleared: false
                    </code>. &ldquo;Could not check&rdquo; is never treated as &ldquo;passed the
                    check&rdquo; anywhere in this codebase — a Cleanverse outage makes Vera more
                    conservative, not more permissive.
                  </p>
                </div>
              </section>

              {/* ---------- Trust score ---------- */}
              <section id="trust" className="doc-sec">
                <h2 className="serif">Trust score</h2>
                <p>
                  The score, and everything derived from it, lives in one file —{" "}
                  <code className="inline">lib/vera.js</code> — so there is exactly one place
                  the UI could disagree with itself. The same formulas are mirrored in Solidity
                  in <code className="inline">VeraMath.sol</code>, and a parity suite asserts
                  the two agree point-for-point across all 1001 possible scores.
                </p>

                <h3>Score composition</h3>
                <div className="doc-table">
                  <div>
                    <dt>Identity (CVI)</dt>
                    <dd>
                      30% of the score. Zero for an unattested wallet — verifying is what turns
                      this term on.
                    </dd>
                  </div>
                  <div>
                    <dt>On-chain history</dt>
                    <dd>45% of the score. Age, activity, and protocol footprint.</dd>
                  </div>
                  <div>
                    <dt>Repayment record</dt>
                    <dd>25% of the score. Loans closed without a liquidation.</dd>
                  </div>
                </div>

                <h3>What the score buys</h3>
                <div className="doc-table">
                  <div>
                    <dt>Loan-to-value</dt>
                    <dd>
                      <code className="inline">round(score × 0.096)</code>, clamped 20–90% for a
                      verified wallet. An anonymous wallet is clamped 20–45% regardless of
                      score — the anonymous ceiling, not a penalty.
                    </dd>
                  </div>
                  <div>
                    <dt>Liquidation threshold</dt>
                    <dd>
                      LTV + 8 points, capped at 95%. The buffer between where you can still
                      borrow and where the position becomes unhealthy.
                    </dd>
                  </div>
                  <div>
                    <dt>Borrow APR</dt>
                    <dd>
                      <code className="inline">clamp(10.6 − score × 0.00665, 3.5, 12)</code> —
                      a better score borrows cheaper, continuously.
                    </dd>
                  </div>
                  <div>
                    <dt>Supply APY</dt>
                    <dd>
                      79% of the prevailing borrow APR, clamped 1–10%. Tracks borrow demand
                      rather than being set independently.
                    </dd>
                  </div>
                  <div>
                    <dt>Health factor</dt>
                    <dd>
                      <code className="inline">
                        (collateral USD × threshold) / debt USD
                      </code>
                      . Below 1.0, the position can be liquidated.
                    </dd>
                  </div>
                  <div>
                    <dt>Liquidation mechanics</dt>
                    <dd>
                      50% close factor, 5% liquidation bonus — contract constants, stated in
                      the UI rather than re-derived, so they can never drift from{" "}
                      <code className="inline">VeraPool.sol</code>.
                    </dd>
                  </div>
                </div>

                <div className="doc-scroll">
                  <table className="doc-grid-table">
                    <thead>
                      <tr>
                        <th></th>
                        <th>Verified</th>
                        <th>Anonymous</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Trust score</td>
                        <td className="good">753</td>
                        <td>535</td>
                      </tr>
                      <tr>
                        <td>Identity (CVI)</td>
                        <td className="good">218 / 300</td>
                        <td className="flat">0 / 300</td>
                      </tr>
                      <tr>
                        <td>LTV</td>
                        <td className="good">72%</td>
                        <td className="flat">45% (anon cap)</td>
                      </tr>
                      <tr>
                        <td>Liquidation threshold</td>
                        <td className="good">80%</td>
                        <td>53%</td>
                      </tr>
                      <tr>
                        <td>Borrow APR</td>
                        <td className="good">5.6%</td>
                        <td>7.0%</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p>
                  Same collateral, same history — the only input that differs between these two
                  rows is the CVI attestation. This is the exact comparison{" "}
                  <code className="inline">vera-contracts/script/Demo.s.sol</code> funds and
                  reads back on chain with <code className="inline">cast</code>, and that{" "}
                  <code className="inline">scripts/e2e-cvi-cva.mjs</code> reproduces against the
                  live sandbox with two real wallets.
                </p>
              </section>

              {/* ---------- Features ---------- */}
              <section id="features" className="doc-sec">
                <h2 className="serif">Features</h2>

                <div className="doc-cards">
                  <div className="doc-card">
                    <span className="doc-card-k">Identity</span>
                    <h4>CVI-verified, never stored</h4>
                    <p>
                      Attestation strength feeds the score. Vera never sees or stores the
                      underlying identity document — only the signed result.
                    </p>
                  </div>
                  <div className="doc-card">
                    <span className="doc-card-k">Compliance</span>
                    <h4>CVA gated on every draw</h4>
                    <p>
                      Every borrow re-checks compliance immediately before executing, not once
                      at signup.
                    </p>
                  </div>
                  <div className="doc-card">
                    <span className="doc-card-k">Custody</span>
                    <h4>Non-custodial, always</h4>
                    <p>
                      Collateral sits in a contract you can exit at any time, minus whatever is
                      backing an open draw. Vera never takes custody of your assets.
                    </p>
                  </div>
                  <div className="doc-card">
                    <span className="doc-card-k">Pricing</span>
                    <h4>One oracle, no disagreement</h4>
                    <p>
                      Collateral is valued at the pool&apos;s own on-chain oracle. The dashboard
                      reads the same price the contract would liquidate you at.
                    </p>
                  </div>
                  <div className="doc-card">
                    <span className="doc-card-k">Terms</span>
                    <h4>Continuous, not tiered</h4>
                    <p>
                      LTV, liquidation threshold, and APR move on a continuous curve with score
                      — one point of score is one point of terms, with no cliff.
                    </p>
                  </div>
                  <div className="doc-card">
                    <span className="doc-card-k">Access</span>
                    <h4>Anonymous wallets welcome</h4>
                    <p>
                      No attestation caps you at 45% LTV; it does not lock you out. Verifying
                      raises the ceiling, it is not a requirement to participate.
                    </p>
                  </div>
                </div>

                <h3>Assets in the pool</h3>
                <p>
                  <code className="inline">VeraPool</code> is single-collateral and
                  single-debt by construction — <code className="inline">collateralToken</code>{" "}
                  and <code className="inline">debtToken</code> are immutable, set once at
                  deployment. mETH is the collateral asset, mUSDC is what you borrow. mWBTC is
                  priced by the same oracle and shown on Markets, but is not depositable — the
                  contract was never given a second collateral slot to put it in, and the UI
                  says so rather than offering a deposit the pool would revert.
                </p>
              </section>

              {/* ---------- Architecture ---------- */}
              <section id="architecture" className="doc-sec">
                <h2 className="serif">Architecture</h2>
                <p>
                  Three packages, split by trust boundary rather than by framework
                  convention — each one exists because something on the other side of it must
                  not see what it holds.
                </p>

                <div className="doc-cards">
                  <div className="doc-card">
                    <span className="doc-card-k">vera-frontend</span>
                    <h4>Next.js 16, App Router</h4>
                    <p>
                      React 19 client for the marketing site and the <code className="inline">
                        /app
                      </code>{" "}
                      dashboard. Talks to Cleanverse and the chain only through its own route
                      handlers — never directly, and never with a credential in the browser.
                    </p>
                  </div>
                  <div className="doc-card">
                    <span className="doc-card-k">vera-backend</span>
                    <h4>The credentialed tier</h4>
                    <p>
                      The only package that imports Cleanverse or RPC credentials. Every module
                      opens with <code className="inline">import &quot;server-only&quot;</code>,
                      which turns an accidental client-side import into a build failure rather
                      than a leaked key.
                    </p>
                  </div>
                  <div className="doc-card">
                    <span className="doc-card-k">vera-contracts</span>
                    <h4>Foundry, Solidity 0.8.28</h4>
                    <p>
                      <code className="inline">VeraPool</code>, <code className="inline">
                        VeraMath
                      </code>
                      , the oracle interface, and the mock tokens the pool holds. 138 tests,
                      including exploit and guard suites.
                    </p>
                  </div>
                </div>

                <h3>Request path</h3>
                <p>
                  A page never calls Cleanverse or the RPC endpoint directly. Every external
                  call goes: <strong>browser</strong> → <strong>Next.js route handler</strong>{" "}
                  (server-side, in <code className="inline">vera-frontend/app/api/*</code>) →{" "}
                  <strong>vera-backend client</strong> → <strong>Cleanverse API or Monad
                  RPC</strong>. The route handler is the only thing that can hold a session with
                  a credential; the backend client is the only thing that can read one.
                </p>

                <div className="doc-scroll">
                  <table className="doc-grid-table">
                    <thead>
                      <tr>
                        <th>Route</th>
                        <th>Backs onto</th>
                        <th>Reads</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>
                          <code className="inline">POST /api/cvi</code>
                        </td>
                        <td>Cleanverse <code className="inline">query_apass</code></td>
                        <td>Identity attestation for one address</td>
                      </tr>
                      <tr>
                        <td>
                          <code className="inline">POST /api/cva</code>
                        </td>
                        <td>
                          A-Pass status + Cleanverse{" "}
                          <code className="inline">validator/verify</code>
                        </td>
                        <td>Compliance clearance for one address</td>
                      </tr>
                      <tr>
                        <td>
                          <code className="inline">GET /api/pool</code>
                        </td>
                        <td>Monad JSON-RPC, batched <code className="inline">eth_call</code></td>
                        <td>
                          Pool totals, oracle prices; <code className="inline">?address=</code>{" "}
                          adds one wallet&apos;s balances and position
                        </td>
                      </tr>
                      <tr>
                        <td>
                          <code className="inline">GET /api/prices</code>
                        </td>
                        <td>A public market-data feed</td>
                        <td>24h quotes for the Monad ecosystem row, display only</td>
                      </tr>
                      <tr>
                        <td>
                          <code className="inline">POST /api/webhooks/cleanverse</code>
                        </td>
                        <td>Cleanverse, signed push</td>
                        <td>
                          Invalidates a cached A-Pass the moment it is frozen upstream, closing
                          the read-cache staleness window
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <h3>What is real, and what is simulated</h3>
                <p>
                  Worth stating plainly, since a demo like this lives or dies on the
                  distinction: the app itself does not sign or submit transactions — deposits,
                  borrows, and repayments in <code className="inline">/app</code> update local
                  state, computed with the exact same formulas{" "}
                  <code className="inline">VeraMath.sol</code> enforces on chain. What is not
                  simulated is everything upstream of that: CVI and CVA are live network calls
                  to the Cleanverse sandbox with real business-code responses, and every pool
                  figure and price on the dashboard is a live <code className="inline">
                    eth_call
                  </code>{" "}
                  against the deployed contract — not a fixture. A wallet holding nothing on
                  chain renders zeroes, not a placeholder balance.
                </p>
              </section>

              {/* ---------- Contracts ---------- */}
              <section id="contracts" className="doc-sec">
                <h2 className="serif">Deployed contracts</h2>
                <p>
                  Live on Monad testnet, chain id <code className="inline">10143</code>. These
                  addresses are public by nature — nothing about a deployed contract address is
                  a secret — and every one below can be read directly with{" "}
                  <code className="inline">cast call</code> or any block explorer.
                </p>

                <div className="doc-cards">
                  <div className="doc-card">
                    <span className="doc-card-k">VeraPool</span>
                    <h4>The lending pool</h4>
                    <p>
                      Holds collateral, issues debt, enforces LTV and liquidation. Registered
                      with Cleanverse as a compliance pool via{" "}
                      <code className="inline">validator/register</code>.
                    </p>
                    <p className="doc-addr">{POOL}</p>
                  </div>
                  <div className="doc-card">
                    <span className="doc-card-k">Oracle</span>
                    <h4>IVeraOracle implementation</h4>
                    <p>Prices every asset the pool holds. The dashboard reads the same feed.</p>
                    <p className="doc-addr">{ORACLE}</p>
                  </div>
                  <div className="doc-card">
                    <span className="doc-card-k">mETH</span>
                    <h4>Collateral token</h4>
                    <p>The pool&apos;s immutable collateral asset. Mock ERC-20.</p>
                    <p className="doc-addr">{COLLATERAL}</p>
                  </div>
                  <div className="doc-card">
                    <span className="doc-card-k">mUSDC</span>
                    <h4>Debt token</h4>
                    <p>The pool&apos;s immutable borrowable asset. Mock ERC-20.</p>
                    <p className="doc-addr">{DEBT}</p>
                  </div>
                  <div className="doc-card">
                    <span className="doc-card-k">mWBTC</span>
                    <h4>Quoted, not held</h4>
                    <p>Priced by the oracle for Markets; not a collateral slot on this pool.</p>
                    <p className="doc-addr">{EXTRA}</p>
                  </div>
                </div>

                <div className="doc-note">
                  <h4>Mock assets, testnet only</h4>
                  <p>
                    mUSDC, mETH, and mWBTC behave like the real thing for the purposes of the
                    protocol, but carry no value outside Monad testnet. Nothing described on
                    this page is real money, and nothing here is financial advice or an offer
                    of credit.
                  </p>
                </div>
              </section>

              {/* ---------- Security & credentials ---------- */}
              <section id="security" className="doc-sec">
                <h2 className="serif">Security &amp; credentials</h2>
                <p>
                  Stated in full rather than left implicit, because &ldquo;trust me&rdquo; is
                  exactly the failure mode this protocol exists to route around. Every
                  credential the project uses is named below by variable — none by value. A
                  value is never something a public page should carry, documentation included.
                </p>

                <h3>What exists, and where</h3>
                <div className="doc-table">
                  <div>
                    <dt>
                      <code className="inline">CLEANVERSE_API_ID</code>
                    </dt>
                    <dd>
                      Sent as a request header on every Cleanverse call. Identifies the caller;
                      not secret by itself, but kept server-side with the rest.
                    </dd>
                  </div>
                  <div>
                    <dt>
                      <code className="inline">CLEANVERSE_API_KEY</code>
                    </dt>
                    <dd>
                      Local AES-256-CBC key material for Cleanverse&apos;s encrypted endpoints.
                      Per the v5.6 spec, this value is <strong>never transmitted</strong> to
                      Cleanverse or anywhere else — it only ever decrypts responses locally, on
                      the server.
                    </dd>
                  </div>
                  <div>
                    <dt>
                      <code className="inline">CLEANVERSE_DOCS_ACCESS_CODE</code>
                    </dt>
                    <dd>
                      Invite code used once to fetch Cleanverse&apos;s v5.6 API reference for
                      local use. Not used at runtime.
                    </dd>
                  </div>
                  <div>
                    <dt>
                      <code className="inline">PRIVATE_KEY</code>
                    </dt>
                    <dd>
                      The deployer key. Used only inside Foundry, which reads{" "}
                      <code className="inline">.env</code> directly for{" "}
                      <code className="inline">forge script</code> — it never enters Node, never
                      appears in a script&apos;s <code className="inline">argv</code>, and never
                      reaches this repository&apos;s process at all.
                    </dd>
                  </div>
                  <div>
                    <dt>
                      <code className="inline">MONAD_RPC_URL</code>
                    </dt>
                    <dd>
                      Public. The Monad testnet RPC endpoint — no key or token component. Kept
                      in <code className="inline">.env</code> for convenience, not for secrecy.
                    </dd>
                  </div>
                  <div>
                    <dt>
                      <code className="inline">VERA_POOL_ADDRESS</code>
                    </dt>
                    <dd>
                      Public. The deployed pool address above — a contract address is not a
                      secret by definition.
                    </dd>
                  </div>
                </div>

                <h3>How they stay out of the repository</h3>
                <ul className="doc-ul">
                  <li>
                    <strong>Server-only boundary.</strong> Every module that can see a
                    credential imports <code className="inline">
                      &quot;server-only&quot;
                    </code>{" "}
                    at the top of the file. Next.js turns an accidental import of that module
                    from client code into a build error, not a runtime leak.
                  </li>
                  <li>
                    <strong>Nothing crosses to the browser.</strong>{" "}
                    <code className="inline">CLEANVERSE_API_ID</code> is attached to the
                    outbound request inside the route handler; the client never sees it, and{" "}
                    <code className="inline">CLEANVERSE_API_KEY</code> is never sent over the
                    network by either side.
                  </li>
                  <li>
                    <strong>gitignored by pattern, not by name.</strong>{" "}
                    <code className="inline">.env</code> and every credential-shaped filename (
                    <code className="inline">*.key</code>, <code className="inline">*.pem</code>
                    , <code className="inline">id_rsa*</code>, and others) are excluded broadly
                    enough that a new credential file cannot reach a commit by being named
                    something the list did not anticipate.
                  </li>
                  <li>
                    <strong>Enforced at the gate, not by memory.</strong> A pre-commit hook
                    scans every staged file for the literal value of each secret in the local{" "}
                    <code className="inline">.env</code>, plus shape-based patterns for
                    private keys and secret-looking assignments, and refuses the commit if any
                    match. A pre-push hook independently re-checks every object reachable from{" "}
                    <code className="inline">HEAD</code> before it can leave the machine.
                  </li>
                </ul>

                <div className="doc-note warn">
                  <h4>Why the hooks exist</h4>
                  <p>
                    An earlier build brief for this project had live sandbox keys pasted into
                    it, and it was committed and pushed. Those values were rotated immediately
                    and the history was purged; the hooks above exist so that mistake gets
                    caught at the gate the next time, rather than after the fact.
                  </p>
                </div>
              </section>

              {/* ---------- Try the demo ---------- */}
              <section id="demo" className="doc-sec">
                <h2 className="serif">Try the demo</h2>
                <p>
                  <Link href="/app">/app</Link> runs the whole loop — connect, get scored,
                  borrow, watch the health factor move — against the live sandbox. Two ways in:
                </p>

                <div className="doc-cards">
                  <div className="doc-card">
                    <span className="doc-card-k">Demo mode</span>
                    <h4>Two real sandbox wallets</h4>
                    <p>
                      A toggle switches between two real Cleanverse records on Monad: one holds
                      an actual A-Pass, one genuinely has none —{" "}
                      <code className="inline">query_apass</code> returns &ldquo;not
                      found&rdquo; for it. Flipping the toggle re-runs both CVI and CVA for real;
                      it is not a local boolean standing in for the difference.
                    </p>
                    <p className="doc-addr">
                      Verified &nbsp;{DEMO_WALLET}
                      <br />
                      Anonymous {ANON_WALLET}
                    </p>
                  </div>
                  <div className="doc-card">
                    <span className="doc-card-k">Live mode</span>
                    <h4>Your own wallet</h4>
                    <p>
                      Connect any EIP-6963 wallet and Vera runs the identical CVI and CVA
                      lookups against your real address, then reads your real balances,
                      collateral, and debt straight from{" "}
                      <code className="inline">VeraPool</code> — a wallet holding nothing
                      renders zeroes, honestly.
                    </p>
                  </div>
                </div>

                <div className="doc-end">
                  <div>
                    <h3 className="serif">See it priced live</h3>
                    <p>
                      Two wallets, identical collateral, one variable — whether Cleanverse can
                      vouch for the address drawing against it.
                    </p>
                  </div>
                  <div className="doc-end-actions">
                    <Link href="/app" className="btn btn-primary">
                      Open the app <span aria-hidden="true">→</span>
                    </Link>
                    <a href="#vera" className="btn btn-secondary">
                      Back to top
                    </a>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
