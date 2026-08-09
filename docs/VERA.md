# Vera

Trust-based DeFi lending protocol. Verified identity and on-chain compliance set
your borrowing power, not collateral alone.

Built for the **Cleanverse Build: Trusted Assets Hackathon** (DeFi track, sponsored
by Monad Foundation). Team **TheSpiders**.

- Build window: **Aug 8 00:00 – Aug 9 23:59 UTC**
- Submission: isaac@cleanverse.com by Aug 9 23:59 UTC
- Winners announced Aug 14

## Status — 2026-08-08

| Area | State |
|---|---|
| Landing page | Built, matches reference at 1440 / 768 / 390 |
| Design system | Ported from stax.best, tokens exact |
| Logo | Traced to SVG from supplied bitmap |
| Credentials | In `.env`, git-ignored and verified |
| CVI (identity) | **Live** against the Cleanverse sandbox on `monad`, with retries and a 60s read cache |
| CVA (compliance) | Attestation layer **live**; on-chain layer wired, pending a deployed pool |
| Contracts | **Complete** — VeraPool + VeraMath + MockOracle + tests, 138/138 passing |
| Security audit | Done. Seven findings fixed, each with a regression test and a mutation check |
| Accessibility | Re-audited 2026-08-08 by `scripts/a11y-app.mjs`: 0 contrast, 0 semantics, 0 keyboard findings |
| Metadata / OG | Titles, descriptions, generated OG card, theme colour — verified on both routes |
| Demo script | Broadcasts clean against a fresh chain; claims asserted, not just printed |
| Wallet connect | **Wired**, with EIP-6963 multi-wallet discovery — the user picks, not the injection race |
| Git repo | **Not initialized.** Commit hold expired Aug 8 00:00 UTC; awaiting a decision |

## Layout

```
Vera/
├─ README.md                 repo entry point
├─ .env                      sandbox credentials (git-ignored)
├─ .env.example              shape only, no values
├─ docs/
│  ├─ VERA.md                this file — status and engineering log
│  ├─ SUBMISSION.md          the one-page summary for judges
│  ├─ cleanverse-contract.md just the API surface Vera depends on
│  └─ reference-cleanverse/  scraped v5.6 vendor docs (git-ignored)
├─ assets/                   working media: reference video, source bitmap (git-ignored)
├─ vera-contracts/           Foundry — the protocol itself
│  ├─ src/
│  │  ├─ VeraMath.sol        credit rules; integer mirror of vera-frontend/lib/vera.js
│  │  ├─ VeraPool.sol        the lending pool
│  │  ├─ IVeraOracle.sol     price interface — must revert, never return 0
│  │  ├─ MockOracle.sol      owner-set prices, testnet only
│  │  └─ MockERC20.sol       mUSDC / mETH / mWBTC with an open faucet
│  ├─ test/                  138 tests, including a JS↔Solidity parity suite
│  │  └─ fixtures/           rates.json, generated from the UI library
│  ├─ script/
│  │  ├─ Deploy.s.sol        deploys the stack, writes deployments/<chainid>.json
│  │  ├─ Demo.s.sol          the two-wallet claim, asserted on chain
│  │  └─ SignRegistration.s.sol  EIP-191 owner signature for /validator/register
│  └─ deployments/           deploy receipts, addresses only (git-ignored)
└─ vera-frontend/            Next.js 16 landing page + app
   ├─ app/
   │  ├─ globals.css         design tokens
   │  ├─ sections.css        section + component styles
   │  ├─ layout.js           Fraunces + Hanken Grotesk
   │  ├─ page.js             section composition
   │  └─ api/                cvi + cva route handlers (server-only)
   ├─ components/            14 landing components, plus app/ for the connected screen
   ├─ lib/                   vera.js (protocol math), cleanverse*.js, apass.js, wallet.js
   ├─ scripts/               e2e suites, a11y audits, gen-rate-fixtures.mjs
   └─ public/                vera-mark.svg, hero media, deployments/ (git-ignored)
```

The two directories are wired together in three places, all of them load-bearing:

| Direction | Path | Why |
|---|---|---|
| frontend → contracts | `vera-frontend/scripts/gen-rate-fixtures.mjs` writes `vera-contracts/test/fixtures/rates.json` | the parity suite checks Solidity against the rates the UI quotes |
| contracts → frontend | `Deploy.s.sol` writes `../vera-frontend/public/deployments/<chainid>.json` | served at `/deployments/<chainid>.json`, the exact path `lib/wallet.js` fetches |
| frontend → contracts | `register-pool.mjs` reads `vera-contracts/deployments/registration-<chainid>.json` | the EIP-191 signature Foundry produced, posted to `/validator/register` |

`vera-frontend/.env` is a symlink to the root `.env`, so both halves read one file
and credentials are never duplicated.

## Design

Ported component-for-component from **https://www.stax.best**. All tokens were
pulled from the live site via computed styles, never estimated. The canonical
copy of every token is the stylesheet itself, so there is no second table to
drift out of sync with it.

The short version:

- Display **Fraunces** 600, italic accents 500. Tracking is uniformly `-0.035em`,
  leading `1.02–1.06`. Those two facts carry most of the look.
- UI **Hanken Grotesk** 400/700, leading `1.5`.
- Background `#0C0F0A`, text `#EEF2EA`, accent mint `#6CC09C`, sand `#F7E6CD`.
- Container `1200px` / `28px` gutter. Section rhythm `92px`.
- Radii `16px` cards, `99px` pills.

Section heights match the reference within ±9px, most within ±2.

Note: the reference site's own in-app agent is also named "Vera". All copy here is
original — none of theirs is reused.

## Running it

```bash
cd vera-frontend
npm install
npm run dev      # http://localhost:3000
npm run build
```

Reach the dev server as **`localhost`**, not `127.0.0.1`. Next 16 blocks
cross-origin dev resources by hostname, so hitting it by IP makes every `_next`
chunk 403 — hydration never runs and the page sits on "Starting…", which looks
exactly like a product bug and is not one.

### Testing on a phone

Use the **production** server, not `next dev`:

```bash
npm run lan      # builds, then serves on 0.0.0.0:3100
```

The dev bundle is ~3.7 MB across 15 chunks; production is ~577 KB across 8.
Over WiFi the dev bundle takes seconds to hydrate, and until it does, buttons
are rendered but have no handlers attached — taps silently do nothing. Interactive
controls gate on `useHydrated()` so they read as pending rather than broken, but
the real fix for device testing is serving the production build.

## CVI / CVA — done 2026-08-06

Items 1–5 of the old list are built and verified against the real sandbox. No
field name or endpoint path was invented; all of them came out of the v5.6
reference at docs.cleanverse.com, scraped with the access code in `.env`.

| File | Role |
|---|---|
| `vera-frontend/lib/cleanverse-server.js` | Server-only client. `import "server-only"` so a client import fails the build. AES-256-CBC helpers, HMAC webhook verify, request timeouts. |
| `vera-frontend/lib/apass.js` | Pure interpretation — scoring, expiry, compliance verdicts. No I/O, so it is unit-testable. |
| `vera-frontend/app/api/cvi/route.js` | `verifyIdentity` — POST `/query_apass`. |
| `vera-frontend/app/api/cva/route.js` | `checkCompliance` — attestation layer, plus `/validator/verify` once a pool is registered. |
| `vera-frontend/lib/cleanverse.js` | Browser-side fetchers. Fails **closed**: a failed check reports `cleared: false`. |

Credentials never reach the browser — the client talks to our own two routes,
not to Cleanverse. Verified by grepping the built bundle for the live values:
zero hits, and zero references to the variable names.

Identity is 30% of the trust score. A frozen or expired A-Pass scores zero
however good its tier, and the on-chain layer cannot rescue a wallet the
attestation layer rejected.

**Verified end to end** — `vera-frontend/scripts/e2e-cvi-cva.mjs`, against a real attested
wallet and one that genuinely holds no A-Pass. These are also the exact numbers
`vera-contracts/script/Demo.s.sol` proves on chain — the UI quote and the pool agree:

| | Verified | Anonymous |
|---|---|---|
| Trust score | 739 | 535 |
| Identity (CVI) | 204 / 300 | 0 / 300 |
| LTV | 71% | 45% (anon cap) |
| Liquidation threshold | 79% | 53% |
| Borrow APR | 5.7% | 7.0% |
| Max borrow (3 mETH) | 6,390 mUSDC | 4,050 mUSDC |
| Borrow CTA | priced | "Blocked by compliance", disabled |

Score inputs are identity 681 (measured on the sandbox A-Pass), history 800,
repayment 700. History and repayment are defined once in `historyInputs()`
(`vera-frontend/lib/cleanverse.js`) and mirrored by the demo script's constants; identity
is not a constant on the web side at all — it is computed from the live A-Pass
by `identityScoreFrom()`, and 681 is what that returns for the sandbox record.
They were briefly out of sync (the UI used 700/848) and were unified on
2026-08-07. `Demo.s.sol` held 680 until 2026-08-08; both weight to 204/300 and
score 739, which is why it read correctly on screen while being the wrong number.

Unit suite `vera-frontend/lib/apass.test.js` — 17/17, fixtures captured from the sandbox.

**Known gap, stated rather than faked.** The on-chain half of CVA needs a Monad
pool registered via `POST /validator/register`, which needs a deployed pool and
an EIP-191 owner signature. `PRIVATE_KEY` is still empty. Until then the API
honestly returns `onChain: { checked: false, valid: null }` instead of quietly
passing that layer.

## Surviving a slow sandbox — 2026-08-08

The sandbox is not merely slow, it intermittently stalls: measured across one
session, `/query_apass` for a single address took 2.3s, 6.0s and 3.5s on three
consecutive calls, and three of twenty-two calls never answered at all. Because
compliance **fails closed**, every one of those renders as a wallet that cannot
be assessed — which, seconds after connecting, reads to a user as a broken app.
Three layers now sit between that and the screen.

**Retries with a total budget** (`cleanverse-server.js`). Per-attempt deadlines
of 6s / 8s / 10s under a 20s ceiling for the whole chain. The first deadline is
deliberately the shortest: a stalled request does not recover, so waiting long
before retrying spends the budget on a call that was never going to answer. The
ceiling exists because a CVA request makes two of these calls back to back.

**A 60-second read cache** over `queryApass` and `verifyCompliance`. Repeat reads
went from ~2.5s to ~11ms on the production build. Two properties matter more than
the speed, and both are pinned by tests rather than by reading:

- A read that did not complete is never cached. Most failures throw, so they never
  reach the write; a 12027 *resolves* to `{ ran: false }` — because the CVA route
  answers any throw with a blanket 502, which would discard the identity half of
  the response — and is excluded by an explicit `cacheable` predicate instead.
- A failure is never answered from an older success. That would be the fail-closed
  gate opening on error, which is the one thing it must not do.

`vera-frontend/scripts/verify-read-cache.mjs` — 22 checks against a stubbed upstream with a
call counter, so "served from cache" is proven by the absence of a request rather
than inferred from a timing. Mutation-checked: removing the `cacheable` predicate
makes it fail.

**"Could not check" is not "you failed the check"** (`VeraTab.jsx`). The CVA chip
previously rendered anything that was not `cleared` as **Blocked**, so an upstream
stall accused a compliant wallet of failing compliance. Only `check-failed` and
the not-yet-loaded state now read **Unknown**; every other status in `lib/apass.js`
is a real determination and still reads Blocked. Note that `unscreened` is itself
a determination — "no A-Pass exists" — so it is not the empty state.
`vera-frontend/scripts/e2e-cva-degraded.mjs` proves it under the exact failure it exists
for: with `/api/cva` forced to 502 the chip reads Unknown, the attestation is
still honoured at 739 / 71% / 5.7%, and the draw is still refused.

## Wallet choice, not a coin flip — 2026-08-08

With several extensions installed, `window.ethereum` holds whichever one won the
injection race, so a single "Connect" button connects an arbitrary wallet.
`vera-frontend/lib/wallet.js` now discovers wallets over **EIP-6963** and names them. The
listener is registered before `eip6963:requestProvider` is dispatched — reversing
that misses every wallet already loaded. One wallet stays one click; the picker
only appears when there is a real ambiguity, and the choice persists.

`vera-frontend/scripts/e2e-eip6963.mjs` announces two wallets and points `window.ethereum`
at the **wrong** one on purpose, so a cosmetic picker fails the test. The legacy
single-`window.ethereum` path is still covered by `e2e-wallet.mjs`, 19/19.

## Verification

| Command | Covers |
|---|---|
| `npm test` | 37 unit tests + 22 read-cache checks |
| `npm run e2e` | live CVI/CVA, wallet states, degraded CVA, EIP-6963, accessibility |

`scripts/a11y-app.mjs` audits the connected screen for WCAG AA contrast, missing
accessible names, colour-only state, and tab-order removal — 0 findings. It
composites translucent ancestors and scores text against the **worst** stop of a
gradient: `background-color` is transparent under a `linear-gradient`, so a naive
sampler walks past a solid-looking button to the dark page behind it and reports
~1:1 on text that is actually 7.8:1. Both the contrast detector and the cache
predicate were mutation-checked — a check that has never failed is decoration.

## Next

All three items of the original list are done. Mock ERC-20s with an open `mint()`
and the lending pool with dynamic LTV and score-priced interest are built and
tested; wallet connect is wired — `components/app/useVera.js` drives the app off
a real connected address, and the demo toggle is now a fallback rather than the
only path.

What remains is one chain of work, and a missing key blocks all of it. itachi
is supplying `PRIVATE_KEY` into `.env` directly (2026-08-08); nothing here should
generate, read, echo, or otherwise handle that value.

1. Deploy to Monad testnet. Needs `PRIVATE_KEY` filled in; `Deploy.s.sol` writes
   `deployments/<chainid>.json` for the frontend to read. Until this runs,
   `/app` requests `deployments/10143.json`, gets a 404, and degrades to the
   demo path — expected, not a bug. The deploy address also needs MON from
   https://faucet.monad.xyz/ before the broadcast will land.
2. Register the pool with `POST /validator/register`, then record the
   registration on chain and set `VERA_POOL_ADDRESS` — this is what closes the
   on-chain CVA gap above. `register-pool.mjs` prints the exact `cast send` to
   run, using the registration **transaction hash** as the `bytes32`: v5.6
   returns a tx hash and defines no pool identifier, so there is no id to pass.
   Earlier drafts of this file said `setValidatorPoolId(<id>)`, which described
   a field that does not exist.
3. Fill the addresses block in `SUBMISSION.md` from
   `vera-contracts/deployments/10143.json` once step 1 lands.

## Submission — due 2026-08-09 23:59 UTC

Checklist from the hackathon rules, as it currently stands:

| Item | State |
|---|---|
| One-page summary | **Done** — `SUBMISSION.md`, addresses block pending deploy |
| Live demo URL / testnet deployment | Blocked on `PRIVATE_KEY` |
| Demo video | Not started |
| Public repo, commit history inside Aug 8–9 UTC | **Not being done** — hold stands by decision, see below |
| Send to isaac@cleanverse.com | Not started |

## Standing constraints

- **No commits or pushes. The hold stands — decided 2026-08-08.** The hold's
  original reason expired when the Aug 8–9 UTC window opened, but itachi was
  asked directly and chose to keep holding. No git command has been run here and
  none should be. Note the cost, so the decision is made with open eyes: the
  submission checklist requires a public repo with commit history inside the
  Aug 8–9 UTC window, and that history does not exist yet.
- This folder is not yet its own git repo. It sits inside the home directory
  repo, so `git init` here would be required before any commit.
- Credentials live in `.env` only. Never hardcoded, never logged, never in a
  screenshot.
