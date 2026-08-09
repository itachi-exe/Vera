import {
  CHAIN,
  CleanverseError,
  credentialsPresent,
  queryApass,
  verifyCompliance,
} from "@/lib/cleanverse-server";
import { complianceFrom, mergeCompliance } from "@/lib/apass";
import { rateLimit } from "@/lib/rateLimit";

/**
 * CVA — compliance screening.
 *
 * POST { address } -> normalized Compliance
 *
 * Two layers, both real:
 *
 *   1. The A-Pass attestation itself — frozen status, expiry, restricted
 *      country tags. Always available.
 *   2. The pool's on-chain rules via POST /validator/verify, when Vera's
 *      lending pool has been registered as a compliance pool.
 *
 * Layer 2 needs a deployed pool address in VERA_POOL_ADDRESS. Until then the
 * response says so rather than quietly passing.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const POOL = process.env.VERA_POOL_ADDRESS;

export async function POST(request) {
  // CVA can make two upstream calls per request, so the limit matters more here.
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
  // pattern, then reach upstream as an array — which came back as a 502 rather
  // than the 400 the input deserved.
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
    const attestation = complianceFrom(apass);

    // Only ask the chain when there is a registered pool to ask about, and only
    // when the attestation layer has already passed — a wallet with no A-Pass
    // has nothing for the pool rules to evaluate.
    //
    // Every branch assigns an explicit reason. Leaving `onChain` null in the
    // gaps let a misconfigured VERA_POOL_ADDRESS report itself as "no pool
    // registered", which is a different and much more reassuring claim than
    // "a pool is configured and we could not use it".
    let onChain;
    if (!POOL) {
      onChain = { ran: false, valid: false, reason: "No compliance pool registered yet" };
    } else if (!ADDRESS_RE.test(POOL)) {
      console.error("[cva] VERA_POOL_ADDRESS is set but is not a valid address");
      onChain = {
        ran: false,
        valid: false,
        reason: "Configured compliance pool address is malformed — on-chain layer not checked",
      };
    } else if (!attestation.cleared) {
      onChain = {
        ran: false,
        valid: false,
        reason: "Attestation layer already denied — pool rules not consulted",
      };
    } else {
      onChain = await verifyCompliance(address, POOL);
    }

    const merged = mergeCompliance(attestation, onChain);
    const poolChecked = merged.onChain?.checked === true;

    return Response.json({
      cleared: merged.cleared,
      status: merged.status,
      checkedAt: new Date().toISOString(),
      reasons: merged.reasons,
      ref: apass?.currentKycHash ?? null,
      chain: CHAIN,
      // Name only the calls that actually ran. Claiming validator/verify because
      // a pool happens to be configured misreports provenance on exactly the
      // paths where the on-chain layer was skipped.
      source: poolChecked
        ? "cleanverse:query_apass+validator/verify"
        : "cleanverse:query_apass",
      onChain: merged.onChain,
      pool: POOL ?? null,
    });
  } catch (err) {
    const detail = err instanceof CleanverseError ? `${err.code}: ${err.message}` : "upstream error";
    console.error("[cva] compliance check failed —", detail);
    return Response.json(
      {
        error: "CVA check failed",
        code: err instanceof CleanverseError ? err.code : "upstream-error",
      },
      { status: 502 }
    );
  }
}
