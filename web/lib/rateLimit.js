import "server-only";

/**
 * Per-client rate limiting for the routes that spend Cleanverse quota.
 *
 * `/api/cvi` and `/api/cva` are public endpoints that make credentialed calls to
 * a metered upstream. Without a limit, anyone who finds the URL can spend the
 * sandbox quota — the credentials stay safe, but the demo stops working, which
 * is the outcome that actually matters during judging.
 *
 * Fixed window, in memory, keyed by client address. Stated plainly: this is
 * per-instance state, so it bounds abuse from a single client against a single
 * server rather than providing a distributed guarantee. For a testnet demo on
 * one host that is the honest fit; a multi-instance deployment would move the
 * counters to shared storage and this module is the only thing that changes.
 */

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;

/** @type {Map<string, {count: number, resetAt: number}>} */
const hits = new Map();

/**
 * Best-effort client identity.
 *
 * `x-forwarded-for` is client-controlled and trivially spoofed, so this is a
 * throttle on casual abuse, not an access control. It is deliberately not used
 * for anything security-bearing.
 */
export function clientKey(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

/** Drop expired windows so the map cannot grow without bound. */
function sweep(now) {
  for (const [key, entry] of hits) {
    if (entry.resetAt <= now) hits.delete(key);
  }
}

/**
 * Consume one unit of the caller's budget.
 *
 * @returns {{allowed: boolean, remaining: number, retryAfterSec: number}}
 */
export function consume(request, { max = MAX_PER_WINDOW, windowMs = WINDOW_MS } = {}) {
  const now = Date.now();
  if (hits.size > 1000) sweep(now);

  const key = clientKey(request);
  const entry = hits.get(key);

  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: max - 1, retryAfterSec: 0 };
  }

  entry.count += 1;
  const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
  if (entry.count > max) {
    return { allowed: false, remaining: 0, retryAfterSec };
  }
  return { allowed: true, remaining: max - entry.count, retryAfterSec };
}

/**
 * Guard a route. Returns a 429 Response to return as-is, or null to proceed.
 */
export function rateLimit(request, options) {
  const { allowed, remaining, retryAfterSec } = consume(request, options);
  if (allowed) return null;

  return Response.json(
    { error: "Too many requests", code: "rate-limited" },
    {
      status: 429,
      headers: {
        "retry-after": String(retryAfterSec),
        "x-ratelimit-remaining": String(remaining),
      },
    }
  );
}

/** Test seam: forget all counters. */
export function resetRateLimit() {
  hits.clear();
}
