import "server-only";
import crypto from "node:crypto";

/**
 * Cleanverse Gateway client — SERVER ONLY.
 *
 * Verified against the live sandbox on 2026-08-06. Every endpoint path, header,
 * and field name below comes from the v5.6 docs at docs.cleanverse.com and was
 * confirmed with a real call. Nothing here is guessed.
 *
 *   Base path   {environment_url}/api/cooperate
 *   Sandbox     https://uatapi.cleanverse.com/api/cooperate
 *   Production  https://api.cleanverse.com/api/cooperate
 *   Auth        `api-id` request header. The api-key is NEVER sent — it is
 *               local AES key material only (docs, Authentication).
 *
 * The `server-only` import above is load-bearing: it turns any accidental
 * client import into a build error rather than a leaked key.
 */

const SANDBOX = "https://uatapi.cleanverse.com/api/cooperate";
const PRODUCTION = "https://api.cleanverse.com/api/cooperate";

export const BASE_URL =
  process.env.CLEANVERSE_ENV === "production" ? PRODUCTION : SANDBOX;

/** Chain slug for every Cleanverse call. Monad is supported (docs, query_apass). */
export const CHAIN = "monad";

const API_ID = process.env.CLEANVERSE_API_ID;
const API_KEY = process.env.CLEANVERSE_API_KEY;

export function credentialsPresent() {
  return Boolean(API_ID && API_KEY);
}

/**
 * The api-key as raw AES key material.
 *
 * Guarded rather than decoded inline: without this, an unset CLEANVERSE_API_KEY
 * surfaces as a bare `TypeError` from Buffer.from deep inside a crypto call,
 * which reads like a code fault rather than the configuration problem it is.
 */
function keyMaterial(caller) {
  if (!API_KEY) {
    throw new CleanverseError(
      "no-credentials",
      "CLEANVERSE_API_KEY is not set — cannot derive AES/HMAC key material",
      caller
    );
  }
  const key = Buffer.from(API_KEY, "base64");
  if (key.length !== 32) {
    throw new CleanverseError(
      "bad-credentials",
      `CLEANVERSE_API_KEY must Base64-decode to 32 bytes, got ${key.length}`,
      caller
    );
  }
  return key;
}

/**
 * AES-256-CBC, fixed 16-zero-byte IV, PKCS#5 padding, Base64 in and out.
 * Key is the Base64-decoded api-key (32 bytes — verified).
 *
 * The all-zero IV is mandated by the Cleanverse v5.6 spec (docs, Encryption),
 * not a Vera choice. Randomizing it — the usual correct instinct for CBC —
 * breaks interoperability with the gateway. Do not "fix" it.
 *
 * Only the mutating endpoints need this (generate_apass, validator/grant,
 * validator/register, rule mutations). Reads are plain JSON.
 */
export function encryptBody(plaintextObject) {
  const key = keyMaterial("encryptBody");
  const iv = Buffer.alloc(16, 0); // per Cleanverse spec — see above
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const json = JSON.stringify(plaintextObject);
  return cipher.update(json, "utf8", "base64") + cipher.final("base64");
}

export function decryptBody(base64Ciphertext) {
  const key = keyMaterial("decryptBody");
  const iv = Buffer.alloc(16, 0); // per Cleanverse spec — see encryptBody
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  const out =
    decipher.update(base64Ciphertext, "base64", "utf8") + decipher.final("utf8");
  return JSON.parse(out);
}

/**
 * Verify an A-Token apply webhook: HMAC-SHA256 of the raw body bytes, keyed by
 * the Base64-decoded api-key, compared to X-Cleanverse-Signature as lowercase
 * hex. Compare in constant time. Do not re-serialize the body before hashing.
 */
export function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;
  const key = keyMaterial("verifyWebhookSignature");
  const digest = crypto.createHmac("sha256", key).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(String(signatureHeader).toLowerCase(), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Cleanverse returns HTTP 200 with a business code; "0000" is success. */
export class CleanverseError extends Error {
  constructor(code, message, endpoint) {
    super(message || `Cleanverse ${endpoint} failed with code ${code}`);
    this.name = "CleanverseError";
    this.code = code;
    this.endpoint = endpoint;
  }
}

/**
 * "[CN_001]get apass err: apass not found for user 0x…" -> true
 *
 * Code "0002" on query_apass is the documented "record does not exist" answer,
 * so the code alone decides. The message is only consulted to rule out a "0002"
 * that plainly describes something else — an upstream rewording of "not found"
 * must not turn the ordinary anonymous wallet into a 502, which is what a strict
 * /not found/ match did.
 */
const NOT_FOUND_HINT = /not\s*_?found|no\s+(a-?pass|record)|does\s*not\s*exist|不存在/i;
const OTHER_0002_FAILURE = /forbidden|unauthor|denied|invalid|expired\s+token|rate\s*limit/i;

export function isNotFound(code, message = "") {
  if (code !== "0002") return false;
  const text = String(message ?? "");
  if (NOT_FOUND_HINT.test(text)) return true;
  // Unknown wording: assume the documented meaning of 0002 unless the message
  // names a different, unrelated failure.
  return !OTHER_0002_FAILURE.test(text);
}

/**
 * One attempt at an upstream call. Retries are handled by `call` below.
 *
 * `timeoutMs` is a per-attempt deadline, not a total budget.
 */
async function attempt(endpoint, { method = "POST", body, query, timeoutMs } = {}) {
  const url = new URL(BASE_URL + endpoint);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // The deadline has to cover reading the body too. Clearing it around `fetch`
  // alone leaves `res.json()` on a slow or stalled response unbounded, which is
  // the failure mode that actually hangs a route handler.
  try {
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "api-id": API_ID,
        "X-Request-ID": crypto.randomUUID(),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });

    // 403 covers a bad api-id, an unallowed IP, or a decryption failure.
    if (!res.ok) {
      throw new CleanverseError(String(res.status), `HTTP ${res.status} from ${endpoint}`, endpoint);
    }

    const json = await res.json();
    return { code: json.code, message: json.message, data: json.data };
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new CleanverseError("timeout", `${endpoint} timed out after ${timeoutMs}ms`, endpoint);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Codes worth trying again. A 403 or a business-code failure will not change. */
function isTransient(err) {
  if (err?.name === "CleanverseError") {
    return err.code === "timeout" || /^(408|429|5\d\d)$/.test(String(err.code));
  }
  // Undici connect/reset errors surface as TypeError with a cause.
  return err instanceof TypeError;
}

/**
 * Call Cleanverse, retrying transient failures.
 *
 * The sandbox is genuinely slow and intermittently stalls: measured on
 * 2026-08-08, /query_apass for one address took 2.3s, 6.0s and 3.5s on three
 * consecutive calls, and two of three /validator-backed CVA requests exceeded
 * the old single 12s attempt and returned `code: "timeout"`.
 *
 * That mattered far more than it looks. Compliance fails closed, so one slow
 * response left a wallet reading "check failed" with borrowing blocked — which
 * presents to a user as the app being broken immediately after connecting.
 * Retrying turns an intermittent stall into a slow success.
 *
 * The first deadline is deliberately short. A stalled sandbox request does not
 * recover, so waiting long before retrying spends the budget on a call that was
 * never going to answer; a fast first attempt catches the common case and fails
 * over quickly when it does not.
 *
 * `TOTAL_BUDGET_MS` bounds the whole chain, because a CVA request makes two of
 * these calls back to back — without it the worst case is the sum of both
 * chains, and a user watching a spinner does not care which upstream call is
 * slow. Better to give up at a known bound and let them retry.
 */
const ATTEMPT_DEADLINES_MS = [6000, 8000, 10000];
const TOTAL_BUDGET_MS = 20000;

async function call(endpoint, opts = {}) {
  if (!API_ID) throw new CleanverseError("no-credentials", "CLEANVERSE_API_ID is not set", endpoint);

  const started = Date.now();
  let last;

  for (let i = 0; i < ATTEMPT_DEADLINES_MS.length; i++) {
    const spent = Date.now() - started;
    const left = TOTAL_BUDGET_MS - spent;
    if (left <= 0) break;

    // Never let one attempt run past the overall budget.
    const deadline = Math.min(opts.timeoutMs ?? ATTEMPT_DEADLINES_MS[i], left);

    try {
      return await attempt(endpoint, { ...opts, timeoutMs: deadline });
    } catch (err) {
      last = err;
      if (!isTransient(err) || i === ATTEMPT_DEADLINES_MS.length - 1) throw err;
      // Brief, growing pause. The sandbox stalls rather than rate-limits, so
      // this is about letting a wedged connection go, not backing off politely.
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }

  throw last ?? new CleanverseError("timeout", `${endpoint} exceeded ${TOTAL_BUDGET_MS}ms`, endpoint);
}

/* ------------------------------------------------------------------ *
 *  Read cache
 * ------------------------------------------------------------------ */

/**
 * Short-lived cache over reads that succeeded.
 *
 * Retrying absorbs most sandbox stalls but not all: measured on 2026-08-08,
 * three of twenty-two /query_apass calls still exhausted the full 20s budget
 * and returned 502. Because compliance fails closed, each of those renders as
 * a wallet that cannot be assessed — and the same handful of addresses gets
 * looked up over and over as a page is reloaded, so the same stall keeps
 * costing the same answer.
 *
 * Only reads that actually completed land here. Most failures throw, so `run()`
 * never reaches the write; the ones that resolve to a value anyway — a validator
 * read that reports it could not run — are excluded by the `cacheable` predicate.
 * Either way a stall is never cached and never pins itself in place. Equally, a
 * failure is never answered from an older success — that would be the fail-closed
 * gate opening on error, which is the one thing it must not do. The cache shortens
 * repeat reads; it does not substitute for a check that did not run.
 *
 * The TTL is the cost side of that. `status` (1 activate / 2 freeze) lives in
 * the cached record, so a freeze upstream takes up to a minute to be reflected
 * here. A minute of staleness against a check that otherwise intermittently
 * does not complete at all is the better failure, but it is a real tradeoff and
 * not a free win.
 *
 * Per-instance and in-memory, like `rateLimit` — deliberately not shared state.
 */
const READ_TTL_MS = 60_000;
const reads = new Map(); // key -> { value, expires }

async function cachedRead(key, run, cacheable = () => true) {
  const now = Date.now();
  const hit = reads.get(key);
  if (hit && hit.expires > now) return hit.value;

  const value = await run();

  // Some answers resolve without being answers — a validator read that did not
  // complete comes back as a value, not a throw, because callers still need the
  // rest of the result. `cacheable` keeps those out without forcing them to be
  // errors.
  if (!cacheable(value)) return value;

  // Sweep expired entries rather than growing without bound. Keyed by address,
  // so the ceiling is "addresses seen in a minute" — small in practice, but a
  // long-running instance should not accumulate anyway.
  if (reads.size > 500) {
    for (const [k, v] of reads) if (v.expires <= now) reads.delete(k);
  }

  reads.set(key, { value, expires: now + READ_TTL_MS });
  return value;
}

/** Test seam — the cache is process-wide, so tests must be able to clear it. */
export function resetReadCache() {
  reads.clear();
}

/* ------------------------------------------------------------------ *
 *  CVI — A-Pass identity
 * ------------------------------------------------------------------ */

/**
 * POST /query_apass — A-Pass record for a wallet, or null when none exists.
 *
 * Response data (flat, no nested wallets object):
 *   cvRecordId, tier, subTier, group, subGroup, status, expirationTime, countries[], currentKycHash
 *   status: 1 = Activate, 2 = Freeze.  expirationTime: Unix seconds.
 */
export async function queryApass(address, chain = CHAIN) {
  // `null` is cached alongside real records: "this wallet has no A-Pass" is a
  // documented answer, not a miss, and it is half of the demo.
  return cachedRead(`apass:${chain}:${String(address).toLowerCase()}`, async () => {
    const { code, message, data } = await call("/query_apass", {
      body: { chain, address },
    });
    if (isNotFound(code, message)) return null;
    if (code !== "0000") throw new CleanverseError(code, message, "/query_apass");
    return data;
  });
}

/* ------------------------------------------------------------------ *
 *  CVA — on-chain compliance pool
 * ------------------------------------------------------------------ */

/** POST /validator/is_register — is a pool address registered on this chain. */
export async function isPoolRegistered(contractAddress, chain = CHAIN) {
  const { code, message, data } = await call("/validator/is_register", {
    body: { chain, contract_address: contractAddress },
  });
  if (code !== "0000") throw new CleanverseError(code, message, "/validator/is_register");
  return Boolean(data?.registered);
}

/** POST /validator/rules — the compliance rules configured for a pool. */
export async function poolRules(contractAddress, chain = CHAIN) {
  const { code, message, data } = await call("/validator/rules", {
    body: { chain, contract_address: contractAddress },
  });
  if (code !== "0000") throw new CleanverseError(code, message, "/validator/rules");
  return data?.rules ?? [];
}

/**
 * POST /validator/verify — does a wallet satisfy a pool's on-chain rules.
 *
 * Per the docs: HTTP 200 with code "0000" means the check *ran*. `valid: false`
 * is a compliance outcome, not an error. Code 12027 is a genuine read failure
 * (for example, verifying against a paused or unregistered pool).
 */
export async function verifyCompliance(userAddress, contractAddress, chain = CHAIN) {
  const user = String(userAddress).toLowerCase();
  const pool = String(contractAddress).toLowerCase();
  return cachedRead(
    `verify:${chain}:${pool}:${user}`,
    async () => {
      const { code, message, data } = await call("/validator/verify", {
        body: { chain, contract_address: contractAddress, user_address: userAddress },
      });
      if (code === "12027") {
        return { ran: false, valid: false, reason: message || "Validator read failed" };
      }
      if (code !== "0000") throw new CleanverseError(code, message, "/validator/verify");
      return { ran: true, valid: Boolean(data?.valid), reason: null };
    },
    // 12027 has to stay a returned value, not a throw: the CVA route answers a
    // throw with a blanket 502, which would discard the identity half of the
    // response, while `{ ran: false }` reaches `mergeCompliance` and renders as
    // an honest "compliance not checked". But it is still a read that did not
    // happen, so it must not be cached — a minute of "we could not check" pinned
    // in place would outlast the stall that caused it.
    (result) => result.ran
  );
}
