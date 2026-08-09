/**
 * A-Pass interpretation — pure functions, no I/O.
 *
 * Turns a raw Cleanverse A-Pass record into the two things Vera cares about:
 * an identity score for the trust model, and a compliance verdict for the
 * borrow gate. Kept separate from the HTTP client so both are testable and so
 * the scoring rules are readable in one place, which is the point — a lending
 * protocol whose creditworthiness rules are unauditable is not trustworthy.
 *
 * Every field read here is documented in Cleanverse API v5.6 (query_apass).
 */

/** status enum, per the docs. */
export const APASS_STATUS = { ACTIVE: 1, FROZEN: 2 };

/**
 * Identity score, 0..1000. Feeds the 30% identity weight in the trust score.
 *
 * The shape of this is a deliberate choice: most of the value comes simply from
 * holding a live attestation, with tier and record completeness adding on top.
 * An unverified wallet scores 0 here, which is what makes verification worth
 * doing rather than merely decorative.
 *
 *   550  live, active, unexpired A-Pass
 *   250  tier, scaled 0..100
 *   120  subTier, scaled 0..100
 *    80  record completeness (group, subGroup)
 *   ---
 *  1000  maximum
 */
export function identityScoreFrom(apass, now = Date.now()) {
  if (!apass) return 0;
  if (!isActive(apass)) return 0;
  if (isExpired(apass, now)) return 0;

  const tier = clamp01(Number(apass.tier) / 100);
  const subTier = clamp01(Number(apass.subTier) / 100);

  let score = 550;
  score += 250 * (Number.isFinite(tier) ? tier : 0);
  score += 120 * (Number.isFinite(subTier) ? subTier : 0);
  if (nonEmpty(apass.group)) score += 40;
  if (nonEmpty(apass.subGroup)) score += 40;

  return Math.round(Math.min(1000, score));
}

/**
 * Jurisdictions Vera will not lend into. A production deployment should read
 * this from the pool's own on-chain rules instead — validator/rules returns
 * `countries` plus `is_black_list`, so the deny list belongs on chain where it
 * is auditable. This local list is the fallback for when no pool is registered.
 */
export const RESTRICTED_COUNTRIES = ["KP", "IR", "SY", "CU"];

/**
 * Compliance verdict from the A-Pass record alone.
 *
 * This is the layer that always works, because it needs nothing but the
 * attestation. The on-chain validator check layers on top of it — see
 * mergeCompliance.
 */
export function complianceFrom(apass, now = Date.now()) {
  if (!apass) {
    return {
      cleared: false,
      status: "unscreened",
      reasons: ["No A-Pass attestation exists for this wallet on Monad"],
    };
  }
  if (!isActive(apass)) {
    return {
      cleared: false,
      status: "frozen",
      reasons: ["A-Pass status is Freeze (2). Borrowing is blocked."],
    };
  }
  if (isExpired(apass, now)) {
    return {
      cleared: false,
      status: "expired",
      reasons: [`A-Pass expired ${new Date(apass.expirationTime * 1000).toISOString().slice(0, 10)}`],
    };
  }

  const hits = (apass.countries ?? []).filter((c) =>
    RESTRICTED_COUNTRIES.includes(String(c).toUpperCase())
  );
  if (hits.length > 0) {
    return {
      cleared: false,
      status: "restricted-jurisdiction",
      reasons: [`A-Pass carries a restricted country tag: ${hits.join(", ")}`],
    };
  }

  return { cleared: true, status: "cleared", reasons: [] };
}

/**
 * Combine the attestation verdict with the on-chain pool check.
 *
 * Both must pass. When no pool is registered yet the on-chain layer reports
 * that honestly rather than silently passing — a compliance gate that defaults
 * to "allow" when its checker is missing is not a gate.
 */
export function mergeCompliance(attestation, onChain) {
  if (!onChain || onChain.ran === false) {
    return {
      ...attestation,
      onChain: { checked: false, valid: null, note: onChain?.reason ?? "No compliance pool registered" },
    };
  }
  if (!onChain.valid) {
    return {
      cleared: false,
      status: "pool-rules-failed",
      reasons: [...attestation.reasons, "Wallet does not satisfy the pool's on-chain compliance rules"],
      onChain: { checked: true, valid: false, note: null },
    };
  }
  return { ...attestation, onChain: { checked: true, valid: true, note: null } };
}

/* ---------- small predicates ---------- */

export const isActive = (a) => Number(a?.status) === APASS_STATUS.ACTIVE;

export const isExpired = (a, now = Date.now()) =>
  Number.isFinite(Number(a?.expirationTime)) && Number(a.expirationTime) * 1000 <= now;

const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;
const clamp01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
