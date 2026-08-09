# Vera — One-Page Summary

**Cleanverse Build: Trusted Assets Hackathon** · DeFi track · Team **TheSpiders**

Trust-based DeFi lending: verified identity and on-chain compliance set your
borrowing power, not collateral alone.

## Problem

DeFi lending prices every borrower as a stranger. Because the protocol knows
nothing about who is borrowing, it can only ask for collateral — so honest,
verifiable users are overcollateralized at the same 45–50% LTV as an anonymous
address with no history. Identity exists on-chain now, but lending markets do
not read it, so being verifiable buys a borrower nothing.

The mirror problem is compliance. Pools that want a compliance gate either
bolt on an off-chain checkpoint the contract cannot enforce, or gate at the UI
and leave the pool open to anyone calling it directly.

## Solution

Vera reads Cleanverse identity and compliance and turns them into credit terms.

A **trust score** (300–850) is composed from identity 30%, history 40%, and
repayment 30%. The score drives LTV, liquidation threshold, and borrow APR on a
continuous curve — not a tier lookup. Anonymous wallets are not refused; they
are capped at a 45% LTV and priced accordingly, so the verified path is a
benefit rather than a gate.

The same rules exist twice on purpose: `vera-frontend/lib/vera.js` quotes the terms in the
UI, and `vera-contracts/src/VeraMath.sol` enforces them on chain. A parity suite
generates a fixture from the JS library and asserts the Solidity mirror matches
point-for-point across all 1001 scores and 1960 trust-score cases. Divergence
there would mean the pool charges a rate the borrower never agreed to.

## The claim, proven on chain

`vera-contracts/script/Demo.s.sol` funds two wallets with **identical** collateral
and history, one attested and one not, then reads the pool state back with
`cast` rather than trusting the script's own output:

| | Verified | Anonymous |
|---|---|---|
| Trust score | 753 | 535 |
| Identity (CVI) | 218 / 300 | 0 / 300 |
| LTV | 72% | 45% (anon cap) |
| Liquidation threshold | 80% | 53% |
| Borrow APR | 5.6% | 7.0% |
| Max borrow (3 mETH) | 6,480 mUSDC | 4,050 mUSDC |

These are the same numbers the UI quotes, verified end to end against the live
sandbox by `vera-frontend/scripts/e2e-cvi-cva.mjs` — one real attested wallet, and one
that genuinely holds no A-Pass.

## CVI · CVA integration points

Every field and endpoint came out of the live v5.6 reference at
docs.cleanverse.com. None were guessed.

**CVI — identity, 30% of the trust score.** `vera-frontend/app/api/cvi/route.js` calls
`POST /query_apass`. `identityScoreFrom()` derives an identity score from the
live A-Pass — tier, sub-tier, freshness — and `apass.js` weights it to 218/300
for the sandbox record as issued on 2026-08-09. That figure tracks the
attestation, not our code: Cleanverse re-issues these records, and when they do
the score moves without anything here changing. A frozen or expired A-Pass scores **zero** regardless of
tier. "No A-Pass" arrives as business code `0002` and maps to
`verified: false, score: 0` on a 200 — it is a state, not an error, and it is
half the demo.

**CVA — compliance, the borrow gate.** `vera-frontend/app/api/cva/route.js` runs the
attestation layer plus `/validator/verify` once a pool is registered. The gate
**fails closed**: a failed or unrun check reports `cleared: false`, and where no
compliance pool is registered the API returns
`onChain: { checked: false, valid: null }` rather than passing that layer by
silence. The gate is also enforced in `VeraPool.sol`, so a wallet blocked in the
UI cannot borrow by calling the contract directly.

Credentials never reach the browser. `vera-backend/src/cleanverse.js` opens with
`import "server-only"`, so a client import fails the build instead of leaking
quietly; the browser talks only to our two route handlers. Verified by grepping
the production bundle for the live values — zero hits.

## Deployed chains

**Monad testnet** (chain ID 10143) is the target. `Deploy.s.sol` deploys
VeraPool, VeraMath, MockOracle, and the mUSDC / mETH / mWBTC mocks with an open
`mint()`, and writes `deployments/10143.json` for the frontend to read.

Deployment is pending a funded deploy key. The full stack is proven against a
local chain end to end, including the two-wallet demo broadcast. Until the
testnet deploy runs, `/app` requests `deployments/10143.json`, gets a 404, and
degrades to the demo path — and `/api/cva` reports the on-chain compliance layer
as unchecked rather than claiming a pass it has not verified.

<!-- ADDRESSES: fill from vera-contracts/deployments/10143.json once deploy runs -->

## Build quality

- **138/138** Solidity tests across 7 suites, including the JS↔Solidity parity
  suite and a security suite proving oracle failure reverts instead of valuing
  collateral at zero, the reentrancy guard holds, the compliance gate is
  enforced on chain, and bad debt is flagged rather than hidden.
- **37/37** web unit tests, **22/22** read-cache checks.
- Five browser suites: live CVI/CVA, wallet states (19), degraded CVA (10),
  EIP-6963 wallet discovery (8), accessibility (**0** findings — contrast,
  accessible names, colour-only state, tab order).
- A security audit closed seven findings, each with a regression test and a
  mutation check. Both the contrast detector and the cache predicate were
  mutation-checked: a check that has never failed is decoration.
- The sandbox intermittently stalls, so retries with a total budget and a 60s
  read cache sit in front of it. Two properties are pinned by tests: a read that
  did not complete is never cached, and a failure is never answered from an
  older success — that would be the fail-closed gate opening on error.
- Wallets are discovered over **EIP-6963**, so the user picks rather than
  connecting whichever extension won the `window.ethereum` injection race.
