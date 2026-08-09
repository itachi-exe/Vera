/**
 * Tests for A-Pass interpretation.
 *
 *   node --test lib/apass.test.js
 *
 * These cover the scoring and gating rules, which are the parts where a quiet
 * mistake turns into mispriced credit rather than a visible crash. Fixtures are
 * real response shapes captured from the Cleanverse sandbox on 2026-08-06.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  APASS_STATUS,
  complianceFrom,
  identityScoreFrom,
  isExpired,
  mergeCompliance,
  RESTRICTED_COUNTRIES,
} from "./apass.js";

/**
 * Real sandbox record for 0x5702b24116718DCF49314231222A33403e88Aff8 on monad,
 * captured 2026-08-09. Cleanverse re-issues these: the previous capture had
 * tier 20 / subTier 1 / group "oc" and scored 681. Re-capture when it moves —
 * the point of this fixture is that the scoring maths is pinned, so a change
 * here should be a deliberate edit and never a silent drift.
 */
const LIVE = {
  subTier: 9,
  tier: "50",
  expirationTime: 1817749017, // 2027-08-07
  subGroup: "CD",
  cvRecordId: "339",
  countries: ["US"],
  currentKycHash: "0x0e3819435569f8595d8a7928f0884cea1ba66621d4ad81c997e190d722778cd3",
  group: "",
  status: 1,
};

const NOW = Date.UTC(2026, 7, 6); // 2026-08-06, before LIVE expires

test("no attestation scores zero", () => {
  assert.equal(identityScoreFrom(null, NOW), 0);
  assert.equal(identityScoreFrom(undefined, NOW), 0);
});

test("live sandbox record scores from its real fields", () => {
  // 550 base + 250*0.50 + 120*0.09 + 0 (group empty) + 40 (subGroup) = 725.8 -> 726
  assert.equal(identityScoreFrom(LIVE, NOW), 726);
});

test("a frozen A-Pass scores zero however good its tier", () => {
  const frozen = { ...LIVE, tier: "100", subTier: 100, status: APASS_STATUS.FROZEN };
  assert.equal(identityScoreFrom(frozen, NOW), 0);
});

test("an expired A-Pass scores zero", () => {
  const expired = { ...LIVE, expirationTime: Math.floor(NOW / 1000) - 1 };
  assert.equal(identityScoreFrom(expired, NOW), 0);
  assert.ok(isExpired(expired, NOW));
});

test("score is bounded at 1000 and never negative", () => {
  const maxed = { ...LIVE, tier: "100", subTier: 100, group: "g", subGroup: "s" };
  assert.equal(identityScoreFrom(maxed, NOW), 1000);

  const junk = { ...LIVE, tier: "-500", subTier: -9 };
  const s = identityScoreFrom(junk, NOW);
  assert.ok(s >= 0 && s <= 1000, `expected 0..1000, got ${s}`);
});

test("non-numeric tier degrades instead of producing NaN", () => {
  // group/subGroup are set explicitly rather than inherited from LIVE: this test
  // is about tier parsing, and spreading the fixture made the expected total
  // move when Cleanverse blanked the group on their side.
  const weird = { ...LIVE, tier: "premium", subTier: null, group: "oc", subGroup: "AB" };
  const s = identityScoreFrom(weird, NOW);
  assert.ok(Number.isFinite(s), "score must be finite");
  assert.equal(s, 630); // 550 base + 40 group + 40 subGroup, both tiers ignored
});

test("higher tier always scores at least as high", () => {
  const low = identityScoreFrom({ ...LIVE, tier: "10" }, NOW);
  const high = identityScoreFrom({ ...LIVE, tier: "80" }, NOW);
  assert.ok(high > low, `expected ${high} > ${low}`);
});

/* ---------- compliance ---------- */

test("a wallet with no A-Pass is not cleared", () => {
  const c = complianceFrom(null, NOW);
  assert.equal(c.cleared, false);
  assert.equal(c.status, "unscreened");
  assert.ok(c.reasons.length > 0);
});

test("a live A-Pass with no restricted tags clears", () => {
  const c = complianceFrom(LIVE, NOW);
  assert.equal(c.cleared, true);
  assert.equal(c.status, "cleared");
  assert.deepEqual(c.reasons, []);
});

test("a frozen A-Pass is blocked", () => {
  const c = complianceFrom({ ...LIVE, status: APASS_STATUS.FROZEN }, NOW);
  assert.equal(c.cleared, false);
  assert.equal(c.status, "frozen");
});

test("an expired A-Pass is blocked", () => {
  const c = complianceFrom({ ...LIVE, expirationTime: Math.floor(NOW / 1000) - 1 }, NOW);
  assert.equal(c.cleared, false);
  assert.equal(c.status, "expired");
});

test("a restricted country tag blocks, case-insensitively", () => {
  const country = RESTRICTED_COUNTRIES[0];
  const upper = complianceFrom({ ...LIVE, countries: [country] }, NOW);
  assert.equal(upper.cleared, false);
  assert.equal(upper.status, "restricted-jurisdiction");

  const lower = complianceFrom({ ...LIVE, countries: [country.toLowerCase()] }, NOW);
  assert.equal(lower.cleared, false, "lowercase tag must block too");
});

test("an unrestricted country tag clears", () => {
  const c = complianceFrom({ ...LIVE, countries: ["SG", "GB"] }, NOW);
  assert.equal(c.cleared, true);
});

/* ---------- merge with the on-chain layer ---------- */

test("no registered pool leaves the attestation verdict standing, marked unchecked", () => {
  const merged = mergeCompliance(complianceFrom(LIVE, NOW), { ran: false, reason: "no pool" });
  assert.equal(merged.cleared, true);
  assert.equal(merged.onChain.checked, false);
  assert.equal(merged.onChain.valid, null);
});

test("failing the pool rules blocks a wallet that passed the attestation layer", () => {
  const merged = mergeCompliance(complianceFrom(LIVE, NOW), { ran: true, valid: false });
  assert.equal(merged.cleared, false);
  assert.equal(merged.status, "pool-rules-failed");
  assert.equal(merged.onChain.checked, true);
});

test("both layers passing clears", () => {
  const merged = mergeCompliance(complianceFrom(LIVE, NOW), { ran: true, valid: true });
  assert.equal(merged.cleared, true);
  assert.equal(merged.onChain.valid, true);
});

test("the on-chain layer cannot rescue a wallet the attestation layer rejected", () => {
  const merged = mergeCompliance(complianceFrom(null, NOW), { ran: true, valid: true });
  assert.equal(merged.cleared, false, "no A-Pass must stay blocked");
});
