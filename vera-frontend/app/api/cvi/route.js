import { CHAIN, CleanverseError, credentialsPresent, queryApass } from "@/lib/cleanverse-server";
import { identityScoreFrom, isActive, isExpired } from "@/lib/apass";
import { rateLimit } from "@/lib/rateLimit";

/**
 * CVI — identity attestation lookup.
 *
 * POST { address } -> normalized Identity
 *
 * Runs on the server so the api-id never reaches the browser. The client calls
 * this; it does not call Cleanverse.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export async function POST(request) {
  // Before anything that costs upstream quota.
  const limited = rateLimit(request);
  if (limited) return limited;

  let address;
  try {
    ({ address } = await request.json());
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  // Check the type before the regex. RegExp.test coerces its argument, so a
  // one-element array stringifies to the address it wraps and would pass the
  // pattern, then reach upstream as an array.
  if (typeof address !== "string" || !ADDRESS_RE.test(address)) {
    return Response.json({ error: "address must be a 20-byte hex address" }, { status: 400 });
  }

  if (!credentialsPresent()) {
    return Response.json(
      { error: "Cleanverse credentials are not configured on the server" },
      { status: 503 }
    );
  }

  try {
    const apass = await queryApass(address);

    // No attestation is a normal, expected answer — it is the anonymous case,
    // not an error. The UI needs to render it as a state, so return 200.
    if (!apass) {
      return Response.json({
        verified: false,
        score: 0,
        issuer: null,
        attestedAt: null,
        subject: address,
        ref: null,
        chain: CHAIN,
        source: "cleanverse:query_apass",
        apass: null,
      });
    }

    return Response.json({
      verified: isActive(apass) && !isExpired(apass),
      score: identityScoreFrom(apass),
      issuer: "Cleanverse CVI (A-Pass)",
      attestedAt: null, // query_apass returns expiry, not issue time
      subject: address,
      ref: apass.currentKycHash ?? null,
      chain: CHAIN,
      source: "cleanverse:query_apass",
      // The raw attestation, so the UI can show what the score was built from.
      apass: {
        cvRecordId: apass.cvRecordId ?? null,
        tier: apass.tier ?? null,
        subTier: apass.subTier ?? null,
        group: apass.group ?? null,
        subGroup: apass.subGroup ?? null,
        status: apass.status ?? null,
        expirationTime: apass.expirationTime ?? null,
        countries: apass.countries ?? [],
        currentKycHash: apass.currentKycHash ?? null,
      },
    });
  } catch (err) {
    // Log server-side only. Never echo credentials or raw upstream bodies — the
    // response carries the machine-readable code and nothing written upstream.
    const detail = err instanceof CleanverseError ? `${err.code}: ${err.message}` : "upstream error";
    console.error("[cvi] query_apass failed —", detail);
    return Response.json(
      {
        error: "CVI lookup failed",
        code: err instanceof CleanverseError ? err.code : "upstream-error",
      },
      { status: 502 }
    );
  }
}
