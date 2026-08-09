/**
 * Cleanverse integration boundary — CVI (identity) and CVA (compliance).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  STATUS: live against the Cleanverse sandbox.
 *
 *  These functions call Vera's own /api/cvi and /api/cva routes, which hold
 *  the credentials and call Cleanverse server-side. The browser never sees the
 *  api-id, and the api-key never leaves the server at all.
 *
 *  Endpoints and field names come from Cleanverse API v5.6 and were confirmed
 *  against https://uatapi.cleanverse.com/api/cooperate on 2026-08-06.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Normalized shapes this module guarantees to its callers:
 *
 *   Identity  { verified, score, issuer, attestedAt, subject, ref, apass }
 *   Compliance{ cleared, status, checkedAt, reasons[], ref, onChain }
 */

export const INTEGRATION_STATUS = {
  cvi: "live",  // POST /query_apass on Monad
  cva: "partial",  // attestation layer live; on-chain layer blocked on VERA_POOL_ADDRESS
  cvaDetail: {
    attestation: "live",
    onChain: "pending-deploy", // POST /validator/verify is wired and tested; needs a deployed pool
  },
  chain: "monad",
  note: "Sandbox (uatapi.cleanverse.com). Schemas from docs v5.6, verified live.",
};

/**
 * Demo wallets, both real records in the Cleanverse sandbox on Monad.
 *
 * VERIFIED holds an actual A-Pass; ANONYMOUS genuinely has none — query_apass
 * returns "apass not found" for it. The verified/anonymous toggle therefore
 * compares two real lookups rather than flipping a local boolean.
 */
export const DEMO_WALLET = "0x5702b24116718DCF49314231222A33403e88Aff8";
export const ANON_WALLET = "0xdEaD00000000000000000000000000000000bEEf";

/** Which wallet a given demo mode should look up. */
export const walletFor = (verified) => (verified ? DEMO_WALLET : ANON_WALLET);

async function post(path, address) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `${path} failed (${res.status})`);
  }
  return res.json();
}

/**
 * CVI — identity attestation for a wallet.
 * Server route: POST /api/cvi -> Cleanverse POST /query_apass
 */
export async function fetchIdentity(wallet, { verified = true } = {}) {
  const address = wallet ?? walletFor(verified);
  try {
    return await post("/api/cvi", address);
  } catch (err) {
    // Surface the failure instead of falling back to a flattering default —
    // an identity check that silently "passes" when the issuer is unreachable
    // is worse than one that visibly fails.
    return {
      verified: false,
      score: 0,
      issuer: null,
      attestedAt: null,
      subject: address,
      ref: null,
      apass: null,
      error: err.message,
    };
  }
}

/**
 * CVA — compliance standing for a wallet.
 * Server route: POST /api/cva -> Cleanverse POST /query_apass (+ /validator/verify)
 */
export async function fetchCompliance(wallet, { verified = true } = {}) {
  const address = wallet ?? walletFor(verified);
  try {
    return await post("/api/cva", address);
  } catch (err) {
    // Fail closed. A compliance gate that opens on error is not a gate.
    return {
      cleared: false,
      status: "check-failed",
      checkedAt: new Date().toISOString(),
      reasons: [`Compliance check could not be completed: ${err.message}`],
      ref: null,
      onChain: { checked: false, valid: null, note: "check failed" },
      error: err.message,
    };
  }
}

/**
 * On-chain history inputs.
 *
 * Still local: these come from Vera's own lending pool, which is not deployed
 * yet. Unlike the CVI and CVA paths above, there is no external source to read
 * them from — the protocol has to exist first.
 *
 * These match the Demo.s.sol baseline wallet so the frontend quote is identical
 * to the on-chain proof case (updated 2026-08-07).
 */
export function historyInputs() {
  return { history: 800, repayment: 700 };
}
