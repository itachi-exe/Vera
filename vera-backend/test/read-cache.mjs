/**
 * The read cache in src/cleanverse.js, proven against a stubbed upstream.
 *
 * The cache exists because the Cleanverse sandbox intermittently stalls past the
 * whole 20s retry budget, and the same few addresses get looked up again on every
 * reload. What makes it worth testing rather than reading is that it sits in front
 * of a fail-closed compliance gate: caching the wrong thing does not slow the app
 * down, it answers a question that was never asked. The three properties below are
 * the ones that keep that from happening.
 *
 * Not in lib/*.test.js on purpose — `npm test` runs plain `node --test`, and
 * cleanverse.js is `import "server-only"`, which throws without the
 * react-server condition.
 *
 *   npm --prefix vera-backend test
 */

// Set before the import: `call()` reads CLEANVERSE_API_ID at module scope and
// refuses to run without it. Fake values — every request is intercepted below,
// so nothing here is ever sent anywhere.
process.env.CLEANVERSE_API_ID = "test-api-id";
process.env.CLEANVERSE_API_KEY = Buffer.alloc(32, 7).toString("base64");

const { queryApass, verifyCompliance, resetReadCache } = await import(
  "../src/cleanverse.js"
);

let failed = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${actual}${ok ? "" : ` (want ${expected})`}`);
}

/**
 * Replace fetch with a counted script of responses.
 *
 * Each entry is consumed by one upstream call, so the count doubles as proof of
 * whether the cache served a request or the network did.
 */
let calls = 0;
let script = [];
globalThis.fetch = async () => {
  const next = script[calls] ?? script[script.length - 1];
  calls++;
  if (next instanceof Error) throw next;
  return { ok: true, json: async () => next };
};

const ADDR = "0x5702B24116718Dcf49314231222a33403E88Aff8";
const POOL = "0x0000000000000000000000000000000000000123";

function reset(nextScript) {
  resetReadCache();
  calls = 0;
  script = nextScript;
}

console.log("=== A COMPLETED READ IS CACHED ===");
reset([{ code: "0000", message: "ok", data: { cvRecordId: "cv-1", tier: 2, status: 1 } }]);
const a1 = await queryApass(ADDR);
const a2 = await queryApass(ADDR);
check("first lookup hits upstream", calls, 1);
check("second lookup is served from cache", calls, 1);
check("and returns the same record", a2?.cvRecordId, a1?.cvRecordId);

// A wallet with no A-Pass is the anonymous half of the demo, and it is the most
// repeated lookup there is. If `null` fell through as a miss, the case the cache
// most needs to cover would be the one case it never covered.
console.log("\n=== 'NO A-PASS' IS AN ANSWER, SO IT IS CACHED TOO ===");
reset([{ code: "0002", message: "[CN_001]get apass err: apass not found for user 0x…" }]);
const n1 = await queryApass(ADDR);
await queryApass(ADDR);
check("absence is cached, not re-fetched", calls, 1);
check("and is still reported as absent", n1, null);

console.log("\n=== ADDRESSES DO NOT SHARE AN ENTRY ===");
reset([
  { code: "0000", message: "ok", data: { cvRecordId: "cv-A" } },
  { code: "0000", message: "ok", data: { cvRecordId: "cv-B" } },
]);
const first = await queryApass("0x1111111111111111111111111111111111111111");
const second = await queryApass("0x2222222222222222222222222222222222222222");
check("a different address is a different read", calls, 2);
check("and gets its own record", `${first?.cvRecordId}/${second?.cvRecordId}`, "cv-A/cv-B");

// Case is not part of the identity of an address, but it is part of a Map key.
// Without normalising, a checksummed and a lowercase spelling of one wallet are
// two entries, and the cache quietly stops working for the mixed-case path.
console.log("\n=== CASE VARIANTS ARE THE SAME WALLET ===");
reset([{ code: "0000", message: "ok", data: { cvRecordId: "cv-1" } }]);
await queryApass(ADDR);
await queryApass(ADDR.toLowerCase());
check("checksummed and lowercase share one entry", calls, 1);

console.log("\n=== A FAILED READ IS NOT CACHED ===");
reset([{ code: "9999", message: "upstream exploded" }]);
await queryApass(ADDR).catch(() => {});
await queryApass(ADDR).catch(() => {});
check("every failure re-reads upstream", calls, 2);

// The whole point of the fail-closed gate: an error must never be answered with
// a stale success. If it were, a wallet frozen upstream would keep borrowing for
// up to a minute on the strength of a lookup that already stopped working.
console.log("\n=== A FAILURE IS NEVER ANSWERED FROM AN OLDER SUCCESS ===");
reset([
  { code: "0000", message: "ok", data: { cvRecordId: "cv-1" } },
  { code: "9999", message: "upstream exploded" },
]);
await queryApass(ADDR);
resetReadCache(); // stand in for the TTL expiring
let threw = false;
await queryApass(ADDR).catch(() => {
  threw = true;
});
check("the later failure surfaces as a failure", threw, true);

console.log("\n=== A VALIDATOR READ THAT DID NOT RUN IS NOT CACHED ===");
reset([{ code: "12027", message: "Validator read failed" }]);
const v1 = await verifyCompliance(ADDR, POOL);
const v2 = await verifyCompliance(ADDR, POOL);
// It stays a returned value rather than a throw because app/api/cva/route.js
// answers any throw with a blanket 502 — which would discard the identity half
// of the response. `{ ran: false }` reaches mergeCompliance and renders as an
// honest "compliance not checked" beside a score that did resolve.
check("12027 resolves rather than throwing", v1.ran, false);
check("and names why", v1.reason, "Validator read failed");
check("both calls reach upstream — nothing was cached", calls, 2);
check("still not cached on the second call", v2.ran, false);

console.log("\n=== A COMPLETED VALIDATOR READ IS CACHED ===");
reset([{ code: "0000", message: "ok", data: { valid: true } }]);
const ok1 = await verifyCompliance(ADDR, POOL);
const ok2 = await verifyCompliance(ADDR, POOL);
check("first verify hits upstream", calls, 1);
check("second verify is served from cache", calls, 1);
check("and agrees", `${ok1.ran}/${ok1.valid}/${ok2.valid}`, "true/true/true");

// `valid: false` is a compliance outcome, not an error — the check ran and the
// wallet did not pass. Treating it as unrunnable would re-read upstream forever
// for exactly the wallets the gate is meant to stop.
console.log("\n=== A FAILED COMPLIANCE CHECK IS STILL A COMPLETED READ ===");
reset([{ code: "0000", message: "ok", data: { valid: false } }]);
const bad1 = await verifyCompliance(ADDR, POOL);
await verifyCompliance(ADDR, POOL);
check("'ran but did not pass' is cached", calls, 1);
check("and is reported as not valid", `${bad1.ran}/${bad1.valid}`, "true/false");

console.log("\n=== USERS DO NOT SHARE A POOL'S ENTRY ===");
reset([
  { code: "0000", message: "ok", data: { valid: true } },
  { code: "0000", message: "ok", data: { valid: false } },
]);
const u1 = await verifyCompliance("0x1111111111111111111111111111111111111111", POOL);
const u2 = await verifyCompliance("0x2222222222222222222222222222222222222222", POOL);
check("same pool, different user is a different read", calls, 2);
check("and each gets its own verdict", `${u1.valid}/${u2.valid}`, "true/false");

console.log(failed === 0 ? "\nALL CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
