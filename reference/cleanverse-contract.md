# Cleanverse — the contract Vera actually depends on

Our own summary of the two endpoints Vera calls, written so a future session
doesn't need to get back through the access gate at docs.cleanverse.com to know
the shape of things. Taken from the v5.6 reference on 2026-08-06.

The full scraped reference sits in `reference/cleanverse/` — gitignored, because
it is Cleanverse's document, not ours to redistribute.

## Base URL and auth

| Env | Base |
|---|---|
| Sandbox (default) | `https://uatapi.cleanverse.com/api/cooperate` |
| Production | `https://api.cleanverse.com/api/cooperate` |

Switched by `CLEANVERSE_ENV` — `production` picks the second, anything else the
first.

Auth is the **`api-id` header alone**. `api-key` is local AES key material for
the encrypted endpoints and is **never transmitted** — worth stating plainly,
because sending it would be the obvious wrong guess. `X-Request-ID` is an
optional UUID for tracing; we always send one.

Our sandbox credentials carry the **Issue Member** role, which covers every
module we touch. `monad` is a supported chain slug.

## Response envelope

Everything comes back HTTP 200. The `code` field carries the real outcome, so
checking the HTTP status alone tells you nothing.

| code | Meaning |
|---|---|
| `0000` | Success — the check *ran*. |
| `0002` | Business failure. `message` often carries a bracketed sub-code. |
| `12027` | Validator on-chain read failed, e.g. verify against a paused pool. |

Two distinctions we rely on, both of which are easy to get wrong:

- **No A-Pass is a state, not an error.** It arrives as
  `{"code":"0002","message":"[CN_001]get apass err: apass not found for user 0x…","data":""}`.
  We match it with `code === "0002" && /not\s*found/i.test(message)` and turn it
  into `verified: false, score: 0` — a 200 from our own route, not a 5xx.
- **`valid: false` is an outcome, not a failure.** On `/validator/verify`, code
  `0000` means the check completed; the verdict is in `data.valid`. Conflating
  the two would let a non-compliant wallet through as "check errored, allow".

## POST /query_apass — the CVI read

Request `{ chain, address }`. Response `data` is **flat** — there is no nested
`wallets` object, and the docs say so explicitly.

| Field | Type | Note |
|---|---|---|
| `cvRecordId` | string | CV record id. Null on our sandbox record. |
| `tier` | string | Numeric, but typed as a string. Cast it. |
| `subTier` | integer | |
| `status` | integer | **1 = Activate, 2 = Freeze** |
| `expirationTime` | long | **Unix seconds, not milliseconds.** |
| `group`, `subGroup` | string | |
| `currentKycHash` | string | |
| `countries` | string[] | ISO 3166-1 alpha-2. Empty array when none. |

Three of these are quiet traps: `tier` is a string so arithmetic on it silently
yields `NaN`; `expirationTime` in seconds compared against `Date.now()` makes
every pass look decades expired; and `status: 2` is a *freeze*, not a truthy
"ok". `lib/apass.test.js` pins all three.

## POST /validator/verify — the on-chain CVA read

Request `{ chain, contract_address, user_address }`, verdict in `data.valid`.
`contract_address` is our lending pool, which has to be registered as a
compliance pool via `POST /validator/register` first.

Not wired up yet: registration needs a deployed pool, an AES-encrypted body and
an EIP-191 owner signature, and `PRIVATE_KEY` is still empty. So `/api/cva`
reports `onChain: { checked: false, valid: null }` rather than treating an
unrun check as a pass.

## Encryption, for the endpoints that need it

AES-256-CBC, PKCS5Padding, Base64. The key is the **Base64-decoded** `api-key`,
and the IV is **16 zero bytes** — fixed, not random. Implemented in
`web/lib/cleanverse-server.js`.

A fixed IV is weak by normal standards; it is what the spec mandates, so
interoperability wins here. Worth knowing rather than mistaking for our choice.

Webhooks are verified with HMAC-SHA256 over the raw body, compared in constant
time via `crypto.timingSafeEqual`.
