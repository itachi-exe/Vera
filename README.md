# Vera

**Trust-based DeFi lending on Monad.** Verified identity and on-chain compliance
set your borrowing power — not collateral alone.

Built for the **Cleanverse Build: Trusted Assets Hackathon**, DeFi track,
sponsored by the Monad Foundation. Team **TheSpiders**.

> An anonymous wallet posting 1 mETH borrows at 45% LTV and 7.0% APR. The same
> wallet, with a Cleanverse A-Pass and a clean compliance record, borrows at 71%
> LTV and 5.7% APR against identical collateral. That gap is the product.

## Repository layout

| Path | What lives there |
|---|---|
| [`vera-contracts/`](vera-contracts/) | Foundry. The protocol: `VeraPool`, `VeraMath`, oracle interface, mocks. 138 tests. |
| [`vera-frontend/`](vera-frontend/) | Next.js 16. Landing page, connected app, and the server-only Cleanverse routes. |
| [`docs/`](docs/) | Status log, judge summary, and the Cleanverse API surface Vera depends on. |
| `assets/` | Working media — reference recording and source bitmap. Git-ignored. |
| `.env.example` | Every variable the project reads, with no values. |

Start with [`docs/VERA.md`](docs/VERA.md) for current status and the engineering
log, or [`docs/SUBMISSION.md`](docs/SUBMISSION.md) for the one-page version.

## How the two halves connect

The credit rules exist twice on purpose: `vera-frontend/lib/vera.js` is the quote
a borrower reads, `vera-contracts/src/VeraMath.sol` is what the pool enforces. If
those ever disagree, a wallet is charged a rate it never agreed to — so the
agreement is asserted by a parity suite, not assumed.

| Direction | Wire | Why it exists |
|---|---|---|
| frontend → contracts | `vera-frontend/scripts/gen-rate-fixtures.mjs` writes `vera-contracts/test/fixtures/rates.json` | `VeraMathParity.t.sol` checks Solidity against the rates the UI actually quotes — 1001 rate rows, 1960 trust cases |
| contracts → frontend | `Deploy.s.sol` writes `vera-frontend/public/deployments/<chainid>.json` | served at `/deployments/<chainid>.json`, the exact path `lib/wallet.js` fetches |
| frontend → contracts | `register-pool.mjs` reads `vera-contracts/deployments/registration-<chainid>.json` | posts the EIP-191 owner signature Foundry produced to `/validator/register` |

`vera-frontend/.env` is a symlink to the root `.env`, so both halves read one
file and credentials are never duplicated.

## Running it

```bash
cp .env.example .env        # then fill in your Cleanverse sandbox credentials

cd vera-contracts && ./setup.sh && forge test     # 138 tests
cd ../vera-frontend && npm install && npm run dev # http://localhost:3000
```

Reach the dev server as **`localhost`**, not `127.0.0.1`. Next 16 blocks
cross-origin dev resources by hostname, so hitting it by IP makes every `_next`
chunk 403 — hydration never runs and the page sits on "Starting…", which looks
exactly like a product bug and is not one.

For phone testing use `npm run lan`, which serves the production build. The dev
bundle is ~3.7 MB across 15 chunks against ~577 KB across 8, and until it
hydrates over WiFi, buttons render without handlers attached.

## Security

Cleanverse credentials are read server-side only. `lib/cleanverse-server.js` is
marked `import "server-only"`, so a client import fails the build rather than
shipping a key. The built bundle is grepped for the live credential values as a
check, not as an assumption.

`.env` is git-ignored, and a `pre-commit` hook refuses any commit containing a
value from it. Never commit real credentials — if one does land in a commit,
treat it as burned and rotate it, because purging the history does not
un-publish what was already pushed.

## Status

Contracts complete and tested, two security audits closed, identity live against
the Cleanverse sandbox, accessibility audited clean. Outstanding work and known
gaps are tracked honestly in [`docs/VERA.md`](docs/VERA.md).

## Notes

The design is ported component-for-component from
[stax.best](https://www.stax.best), with tokens pulled from computed styles
rather than estimated. That site's own in-app agent is also called "Vera"; all
copy here is original and none of theirs is reused.

The mock tokens have an open faucet and the oracle price is owner-set, so a judge
can fund a wallet and watch a liquidation on demand. Both are testnet-only and
neither belongs on a live network.
