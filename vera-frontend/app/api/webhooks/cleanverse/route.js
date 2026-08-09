import {
  credentialsPresent,
  invalidateAddress,
  verifyWebhookSignature,
} from "@vera/backend/cleanverse";

/**
 * Cleanverse A-Pass status webhook.
 *
 * POST (raw body, signed) -> { ok, dropped }
 *
 * Closes the staleness window the read cache buys. `status` (1 activate,
 * 2 freeze) lives inside the cached A-Pass record, so a wallet frozen upstream
 * keeps borrowing on a stale record for up to the 60s TTL. That window is an
 * acceptable tradeoff against a sandbox that intermittently does not answer at
 * all — but it does not have to be waited out when Cleanverse tells us the
 * record moved.
 *
 * This endpoint only ever *forgets* things. It cannot raise a score, clear a
 * wallet, or write a record: the next read goes to Cleanverse the same way it
 * always does. The worst a forged call can achieve is making us re-fetch, which
 * is why the failure mode of a rejected signature is a 401 and not an outage.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/** Pull the wallet out of the payload without assuming one field name. */
function addressFrom(payload) {
  const candidate =
    payload?.address ?? payload?.user_address ?? payload?.wallet ?? payload?.data?.address;
  return typeof candidate === "string" && ADDRESS_RE.test(candidate) ? candidate : null;
}

export async function POST(request) {
  if (!credentialsPresent()) {
    // Without the key there is nothing to verify a signature against, so this
    // cannot be answered safely. Say so rather than accepting unsigned calls.
    return Response.json(
      { error: "Cleanverse credentials are not configured on the server" },
      { status: 503 }
    );
  }

  // The raw bytes, not a re-serialized object. HMAC is over exactly what was
  // sent; JSON.parse followed by JSON.stringify reorders keys and changes
  // whitespace, and the digest stops matching for reasons that look like a
  // credential problem and are not.
  const raw = await request.text();

  const signature =
    request.headers.get("x-cleanverse-signature") ?? request.headers.get("X-Cleanverse-Signature");

  if (!verifyWebhookSignature(raw, signature)) {
    return Response.json({ error: "Bad signature" }, { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const address = addressFrom(payload);
  if (!address) {
    return Response.json({ error: "No wallet address in payload" }, { status: 400 });
  }

  const dropped = invalidateAddress(address);

  // Deliberately does not echo the payload back. A webhook receiver that
  // reflects what it was sent is a convenient way to confirm a signing key by
  // guessing at it.
  return Response.json({ ok: true, dropped });
}

/** A signed POST is the only thing this endpoint does. */
export async function GET() {
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
