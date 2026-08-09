import { rateLimit } from "@/lib/rateLimit";

/**
 * Live prices for the Monad ecosystem assets shown on the Markets screen.
 *
 * GET -> { ok, asOf, source, prices: { MON: { usd, change24h }, ... } }
 *
 * These are quotes, not protocol inputs. The three pool assets price off
 * `ASSETS` in `useVera.js`, which the Solidity fixtures mirror and `Demo.s.sol`
 * asserts on chain; wiring a moving price into that would desync the UI from the
 * pool. So this feed is confined to the rows that are not yet listed, where a
 * real number is honest and a stale one costs nothing.
 *
 * Server-side for the same reason as the Cleanverse routes: one upstream call
 * per minute for every visitor, rather than one per visitor per load.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** CoinGecko id -> the ticker the market rows render. */
const IDS = {
  monad: "MON",
  "apriori-monad-lst": "aprMON",
  shmonad: "shMON",
};

const UPSTREAM =
  "https://api.coingecko.com/api/v3/simple/price" +
  `?ids=${Object.keys(IDS).join(",")}&vs_currencies=usd&include_24hr_change=true`;

const TIMEOUT_MS = 12_000;
const TTL_MS = 60_000;

/**
 * One shared answer per minute, held in module scope.
 *
 * Deliberately not Next's fetch cache: this is the same shape as the read cache
 * over Cleanverse, and it is the failure behaviour that matters. A failed fetch
 * is never written, so a later error can never be answered from it as if fresh
 * -- but unlike the compliance gate, a *stale* price is better than none, so a
 * failure falls back to the last good payload and says how old it is.
 */
let cached = null;

function fresh(now) {
  return cached && now - cached.at < TTL_MS ? cached : null;
}

export async function GET(request) {
  // Public endpoint hitting a metered third party. Same guard as the routes
  // that spend Cleanverse quota, with a wider window: this one is cheap.
  const limited = rateLimit(request, { max: 60 });
  if (limited) return limited;

  const now = Date.now();
  const hit = fresh(now);
  if (hit) {
    return Response.json({ ...hit.body, cached: true });
  }

  try {
    const res = await fetch(UPSTREAM, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`coingecko ${res.status}`);

    const raw = await res.json();
    const prices = {};
    for (const [id, symbol] of Object.entries(IDS)) {
      const row = raw?.[id];
      if (!row || typeof row.usd !== "number" || !Number.isFinite(row.usd)) continue;
      prices[symbol] = {
        usd: row.usd,
        change24h: Number.isFinite(row.usd_24h_change) ? row.usd_24h_change : null,
      };
    }

    // An empty map means the upstream answered but named none of our assets.
    // That is a failure of this feed, not a set of zero prices.
    if (Object.keys(prices).length === 0) throw new Error("no known ids in response");

    const body = {
      ok: true,
      source: "coingecko:simple/price",
      asOf: new Date(now).toISOString(),
      prices,
    };
    cached = { at: now, body };
    return Response.json({ ...body, cached: false });
  } catch (err) {
    console.error("[prices] coingecko failed:", err?.message ?? "unknown error");

    // Fail soft, and say so. These rows are informational, so a dead feed should
    // render as "price unavailable" rather than taking the screen down. Stale is
    // offered with its own timestamp so the UI can label it.
    if (cached) {
      return Response.json({ ...cached.body, ok: false, stale: true, cached: true });
    }
    return Response.json({
      ok: false,
      stale: false,
      source: "coingecko:simple/price",
      asOf: null,
      prices: {},
    });
  }
}
