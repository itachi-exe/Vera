/**
 * EIP-6963 multi-wallet discovery, in a real browser.
 *
 * The legacy path is already covered by e2e-wallet.mjs, whose stub sets only
 * `window.ethereum`. This covers what that cannot: two wallets announcing
 * themselves, and the guarantee that clicking one connects *that* wallet rather
 * than whichever extension happened to win the `window.ethereum` race.
 *
 * Run with a server already up:  node scripts/e2e-eip6963.mjs
 */
import { createRequire } from "node:module";

// `localhost`, not `127.0.0.1`: Next 16 blocks cross-origin dev resources by
// default, and reaching the dev server by IP trips that — chunks 403, hydration
// never runs, and the page sits on "Starting…" looking like a product bug.
const BASE = process.env.BASE_URL || "http://localhost:3000";

const require = createRequire(import.meta.url);
async function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_PATH,
    "playwright",
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      return await import(require.resolve(c));
    } catch {
      try {
        return await import(c);
      } catch {}
    }
  }
  throw new Error("playwright not found — set PLAYWRIGHT_PATH");
}

let failed = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${actual}`);
}

/**
 * Announce two wallets per EIP-6963 and record which one was asked to connect.
 *
 * `window.ethereum` is deliberately pointed at Bob's provider while the UI is
 * expected to connect Alice's: if the picker were cosmetic and the code fell
 * through to the injected global, the address would come back as Bob and this
 * test would catch it.
 */
function twoWallets() {
  const PX =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3C/svg%3E";

  // Declared inside: Playwright serializes this function and runs it in the
  // browser, so anything it closes over from Node module scope is undefined
  // there. A ReferenceError inside `request` surfaces as a failed connection,
  // which reads like an app bug.
  const CHAIN = "0x279f";

  const make = (account) => ({
    isMetaMask: true,
    _calls: [],
    async request({ method }) {
      this._calls.push(method);
      if (method === "eth_requestAccounts") return [account];
      if (method === "eth_accounts") return [];
      if (method === "eth_chainId") return CHAIN;
      return null;
    },
    on() {},
    removeListener() {},
  });

  const alice = make("0x5702b24116718dcf49314231222a33403e88aff8");
  const bob = make("0xdead00000000000000000000000000000000beef");

  window.__alice = alice;
  window.__bob = bob;
  window.ethereum = bob; // the wrong one, on purpose

  const providers = [
    { info: { uuid: "u-1", name: "Alpha Wallet", icon: PX, rdns: "com.alpha" }, provider: alice },
    { info: { uuid: "u-2", name: "Beta Wallet", icon: PX, rdns: "com.beta" }, provider: bob },
  ];

  window.addEventListener("eip6963:requestProvider", () => {
    for (const d of providers) {
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", { detail: Object.freeze(d) })
      );
    }
  });
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(twoWallets);
  await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });

  console.log("=== BOTH WALLETS OFFERED ===");
  await page.getByRole("group", { name: /choose a wallet/i }).waitFor({ timeout: 20000 });
  const opts = page.locator(".wallet-opt");
  check("offers exactly two wallets", await opts.count(), 2);
  check("names the first", (await opts.nth(0).innerText()).trim(), "Alpha Wallet");
  check("names the second", (await opts.nth(1).innerText()).trim(), "Beta Wallet");
  check(
    "generic connect button is replaced",
    await page.getByRole("button", { name: /^connect wallet$/i }).count(),
    0
  );
  check(
    "wallet icons are decorative, not announced",
    await opts.nth(0).locator("img[alt='']").count(),
    1
  );

  console.log("\n=== PICKING ONE CONNECTS THAT ONE ===");
  await opts.nth(0).click();
  await page.waitForFunction(() => /0x5702/.test(document.body.innerText), { timeout: 30000 });

  // Case-insensitive on purpose: `eth_requestAccounts` returns a lowercase
  // address in MetaMask, so the header renders lowercase even though the demo
  // constants are checksummed.
  check(
    "connected the wallet that was clicked",
    /0x5702…aff8/i.test(await page.innerText("body")),
    true
  );
  check("prompted Alpha, not the injected global", await page.evaluate(() => window.__alice._calls.includes("eth_requestAccounts")), true);
  check("never prompted Beta", await page.evaluate(() => window.__bob._calls.includes("eth_requestAccounts")), false);
} finally {
  await browser.close();
}

console.log(failed === 0 ? "\nALL CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
