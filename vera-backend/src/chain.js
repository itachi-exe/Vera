import "server-only";

/**
 * Read-only chain access for the deployed pool.
 *
 * Exists so the dashboard can show what the contracts actually hold rather than
 * a local baseline. Lives in the backend tier for the same reason the Cleanverse
 * client does: the RPC endpoint is configuration, and one cached read per second
 * serves every visitor instead of one per visitor per load.
 *
 * No web3 dependency. Every call here is a fixed selector over a single address
 * argument, which is a few lines of hex assembly and not worth pulling a package
 * for. Selectors are hardcoded rather than derived because deriving them needs
 * keccak256, and a wrong constant fails loudly on the first read.
 */

/** `cast sig` of each call. Verified against src/VeraPool.sol and IVeraOracle. */
const SEL = {
  totalSupplied: "0x630fd0ac",
  totalCollateral: "0x4ac8eb5f",
  totalDebt: "0xfc7b9c18",
  totalSupplyShares: "0xba7bde55",
  supplyShares: "0xe589253c",
  validatorPoolId: "0xbd1972f1",
  oracle: "0x7dc0d1d0",
  getPrice: "0x41976e09",
  balanceOf: "0x70a08231",
  positions: "0x55f57510",
  decimals: "0x313ce567",
};

const RPC_URL = process.env.MONAD_RPC_URL || "https://testnet-rpc.monad.xyz";
const TIMEOUT_MS = 8_000;

/** Left-pad a 20-byte address into a 32-byte ABI word. */
function word(address) {
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

/**
 * One `eth_call` per request. Batched as a JSON-RPC array so a screen's worth of
 * reads is a single round trip -- Monad testnet latency dominates otherwise.
 *
 * A batch is all-or-nothing at the transport level, but per-call reverts are
 * returned individually. A reverted call resolves to null rather than throwing,
 * because an unset oracle price must not take the whole dashboard down with it.
 */
export async function ethCallBatch(calls) {
  if (calls.length === 0) return [];

  const body = calls.map((c, i) => ({
    jsonrpc: "2.0",
    id: i,
    method: "eth_call",
    params: [{ to: c.to, data: c.data }, "latest"],
  }));

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`rpc ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error("rpc did not return a batch");

  // Batch responses may arrive out of order; id is the only ordering guarantee.
  const byId = new Map(json.map((r) => [r.id, r]));
  return calls.map((_, i) => {
    const r = byId.get(i);
    if (!r || r.error || typeof r.result !== "string") return null;
    return r.result;
  });
}

/** Decode a single uint256 return word. Null in, null out. */
export function toBigInt(hex) {
  if (!hex || hex === "0x" || hex.length < 3) return null;
  try {
    return BigInt(hex);
  } catch {
    return null;
  }
}

/**
 * Scale a raw integer by its decimals into a JS number.
 *
 * The dashboard renders these, so a number is the useful shape -- but the
 * division happens on BigInt first so a 1e18-scaled value never rides through
 * Number and loses its low bits before being scaled down.
 */
export function fromUnits(raw, decimals) {
  if (raw === null) return null;
  const d = BigInt(decimals);
  const base = 10n ** d;
  const whole = raw / base;
  const frac = raw % base;
  return Number(whole) + Number(frac) / Number(base);
}

/** Split the 6-word `positions(address)` tuple. Field order matches Position. */
export function decodePosition(hex) {
  if (!hex || hex.length < 2 + 64 * 6) return null;
  const w = (n) => BigInt("0x" + hex.slice(2 + n * 64, 2 + (n + 1) * 64));
  return {
    collateralRaw: w(0),
    debtRaw: w(1),
    score: Number(w(2)),
    verified: w(3) === 1n,
    complianceCleared: w(4) === 1n,
    lastAccrual: Number(w(5)),
  };
}

export { SEL, word, RPC_URL };
