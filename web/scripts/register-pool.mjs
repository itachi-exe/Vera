/**
 * Register Vera's lending pool as a Cleanverse compliance pool.
 *
 * This is the step that closes the on-chain half of CVA. Until it runs,
 * /api/cva honestly reports `onChain: { checked: false }` rather than treating
 * an unrun check as a pass.
 *
 *   1. forge script script/SignRegistration.s.sol:SignRegistration --rpc-url monad
 *   2. node --conditions=react-server scripts/register-pool.mjs --dry-run
 *   3. node --conditions=react-server scripts/register-pool.mjs
 *
 * The `--conditions=react-server` flag is not optional: lib/cleanverse-server.js
 * is marked `import "server-only"`, which throws under the default condition.
 * Reusing that module rather than reimplementing AES here is the point — a
 * second copy of the cipher is a second thing that can drift from the spec.
 *
 * The deploy key is never read by this script. Signing happens in Foundry,
 * which loads .env itself, so the key stays out of argv and out of Node.
 */

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

try {
  process.loadEnvFile(resolve(ROOT, ".env"));
} catch {
  /* already in the environment, or no .env — credentialsPresent() reports it */
}

const { BASE_URL, CHAIN, credentialsPresent, encryptBody, isPoolRegistered, poolRules } =
  await import("../lib/cleanverse-server.js");

const DRY = process.argv.includes("--dry-run");
const CHAIN_ID = Number(process.env.MONAD_CHAIN_ID || 10143);

/**
 * The pool's initial compliance rule.
 *
 * Deliberately permissive: Vera's own gate is the trust score, and stacking a
 * narrow attestation filter underneath it would reject the sandbox wallets the
 * demo runs on for reasons that have nothing to do with the protocol.
 *
 * The country fields are omitted rather than sent empty. They are optional as
 * of v5.6, and `{ is_black_list: false, countries: [] }` is an *allow*-list
 * containing nothing — which reads as "no restrictions" and means the opposite.
 * Vera's jurisdiction list stays in apass.js until it can be set explicitly via
 * /validator/set_rule.
 */
const RULE = {
  allowed_group: process.env.VERA_RULE_GROUP ?? "oc",
  allowed_sub_group: process.env.VERA_RULE_SUB_GROUP ?? "",
  min_tier: Number(process.env.VERA_RULE_MIN_TIER ?? 1),
  min_sub_tier: Number(process.env.VERA_RULE_MIN_SUB_TIER ?? 0),
};

const die = (msg, hint) => {
  console.error(`\n  ${msg}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
};

/* ---------- inputs ---------- */

const sigPath = resolve(ROOT, `contracts/deployments/registration-${CHAIN_ID}.json`);
let signed;
try {
  signed = JSON.parse(readFileSync(sigPath, "utf8"));
} catch {
  die(
    `No signature receipt at contracts/deployments/registration-${CHAIN_ID}.json`,
    "Run: cd contracts && forge script script/SignRegistration.s.sol:SignRegistration --rpc-url monad"
  );
}

if (signed.chain !== CHAIN) {
  die(
    `Signature is for chain "${signed.chain}" but this client talks to "${CHAIN}"`,
    "The signed message commits to the chain slug, so a mismatch cannot be patched here."
  );
}
if (!/^0x[0-9a-f]{40}$/.test(signed.contract_address)) {
  die(`Pool address in the receipt is not a lowercase hex address: ${signed.contract_address}`);
}
if (!/^0x[0-9a-fA-F]{130}$/.test(signed.owner_signature)) {
  die("owner_signature is not a 65-byte hex signature");
}
if (signed.signed_message !== `${CHAIN}${signed.contract_address}`) {
  die(
    `Signed message does not match chain + address`,
    `signed: ${signed.signed_message}\n  expected: ${CHAIN}${signed.contract_address}`
  );
}

if (!credentialsPresent()) {
  die("Cleanverse credentials are not set", "CLEANVERSE_API_ID and CLEANVERSE_API_KEY live in .env");
}

const plaintext = {
  chain: CHAIN,
  contract_address: signed.contract_address,
  rule: RULE,
  owner_signature: signed.owner_signature,
};

console.log(`\n  pool     ${signed.contract_address}`);
console.log(`  owner    ${signed.owner}`);
console.log(`  chain    ${CHAIN} (id ${CHAIN_ID})`);
console.log(`  rule     ${JSON.stringify(RULE)}`);

/* ---------- don't register twice ---------- */

// Registration is an on-chain write. Asking first costs one cheap read and
// avoids paying for a duplicate, or worse, resetting a rule that was already
// tuned by hand.
let already = false;
try {
  already = await isPoolRegistered(signed.contract_address);
} catch (err) {
  console.log(`  note     could not check registration status (${err.code ?? "error"})`);
}
if (already) {
  console.log("\n  Already registered. Current rules:");
  try {
    console.log(`  ${JSON.stringify(await poolRules(signed.contract_address))}`);
  } catch {
    /* the rules read is a nicety, not the point */
  }
  console.log("\n  Nothing to do. Use /validator/set_rule to change the rule.\n");
  process.exit(0);
}

/* ---------- send ---------- */

const body = { data: encryptBody(plaintext) };

if (DRY) {
  console.log("\n  --dry-run: nothing sent.\n");
  console.log(`  POST ${BASE_URL}/validator/register`);
  console.log(`  plaintext  ${JSON.stringify(plaintext)}`);
  console.log(`  ciphertext ${body.data.length} base64 chars`);
  console.log("\n  Re-run without --dry-run to register.\n");
  process.exit(0);
}

const res = await fetch(`${BASE_URL}/validator/register`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "api-id": process.env.CLEANVERSE_API_ID,
    "X-Request-ID": randomUUID(),
  },
  body: JSON.stringify(body),
});

if (!res.ok) die(`HTTP ${res.status} from /validator/register`);

const json = await res.json();

// HTTP 200 with a business code, as everywhere else in this API.
if (json.code !== "0000") {
  const hint =
    /signature/i.test(json.message ?? "")
      ? "The signer must be pool.owner() on this chain. Re-run SignRegistration against the same RPC."
      : undefined;
  die(`Cleanverse returned ${json.code}: ${json.message}`, hint);
}

const txHash = json.data?.tx_hash ?? null;
console.log(`\n  Registered. tx ${txHash ?? "(no hash returned)"}\n`);

// The API returns a transaction hash and no pool identifier — there is no
// "pool id" field anywhere in the v5.6 reference. `setValidatorPoolId` takes a
// bytes32, so record the registration transaction: it is the on-chain fact that
// registration happened, and it is verifiable by anyone. Inventing an id would
// put a number on chain that corresponds to nothing.
console.log("  Next:");
if (txHash) {
  console.log(`    cast send ${signed.contract_address} 'setValidatorPoolId(bytes32)' ${txHash} \\`);
  console.log(`      --rpc-url monad --private-key $PRIVATE_KEY`);
}
console.log(`    echo 'VERA_POOL_ADDRESS=${signed.contract_address}' >> .env`);
console.log("    restart the web server so /api/cva picks up the pool\n");
