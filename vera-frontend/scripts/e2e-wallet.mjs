/**
 * End-to-end check of the live wallet path.
 *
 * The demo path is covered by e2e-cvi-cva.mjs. This covers the half that only
 * exists once a real provider is injected, which is exactly the half no manual
 * click-through reaches without four different wallet states to hand: no
 * provider, a rejected prompt, the wrong network, and the right one.
 *
 * The provider here is a stub, but nothing else is: the address it returns is a
 * real wallet, the CVI/CVA lookups run against the live Cleanverse sandbox, and
 * the score asserted below is computed from what comes back.
 *
 *   node scripts/e2e-wallet.mjs          # against http://localhost:3000
 *   VERA_URL=http://localhost:3100 node scripts/e2e-wallet.mjs
 */

import { loadPlaywright } from "./playwright.mjs";

const { chromium } = await loadPlaywright();

const BASE = process.env.VERA_URL ?? 'http://localhost:3000';

const MONAD = '0x279f'; // 10143
const ETH_MAINNET = '0x1';
// The two sandbox wallets, used here as the addresses a wallet would return.
const ATTESTED = '0x5702b24116718DCF49314231222A33403e88Aff8';
const ANON = '0xdEaD00000000000000000000000000000000bEEf';

const fail = [];
const check = (label, actual, expected) => {
  const ok = String(actual) === String(expected);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`);
  if (!ok) fail.push(label);
};

const browser = await chromium.launch({ headless: true });

/**
 * A page with an injected EIP-1193 stub. `opts.reject` makes eth_requestAccounts
 * throw 4001 the way a closed MetaMask prompt does; `opts.accounts: []` is a
 * provider that is present but not authorised.
 */
async function pageWith(opts) {
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  page.on('pageerror', (e) => fail.push('PAGEERROR: ' + e.message));

  if (opts) {
    await page.addInitScript((o) => {
      const listeners = {};
      window.__walletCalls = [];
      window.ethereum = {
        isMetaMask: true,
        request: async ({ method, params }) => {
          window.__walletCalls.push(method);
          if (method === 'eth_requestAccounts') {
            if (o.reject) {
              const err = new Error('User rejected the request.');
              err.code = 4001;
              throw err;
            }
            return o.accounts;
          }
          if (method === 'eth_accounts') return o.authorised ? o.accounts : [];
          if (method === 'eth_chainId') return window.__chainId ?? o.chainId;
          if (method === 'wallet_switchEthereumChain') {
            window.__chainId = params[0].chainId;
            listeners.chainChanged?.forEach((f) => f(params[0].chainId));
            return null;
          }
          throw new Error('unstubbed method ' + method);
        },
        on: (ev, fn) => ((listeners[ev] ??= []).push(fn), undefined),
        removeListener: (ev, fn) => {
          listeners[ev] = (listeners[ev] ?? []).filter((f) => f !== fn);
        },
      };
      // Test hook: fire the event MetaMask fires when the user swaps accounts.
      window.__switchAccount = (a) => {
        window.__accounts = [a];
        listeners.accountsChanged?.forEach((f) => f([a]));
      };
    }, opts);
  }

  await page.goto(`${BASE}/app`, { waitUntil: 'networkidle' });
  return page;
}

const text = (page) => page.evaluate(() => document.body.innerText);

// ── 1. No provider ──────────────────────────────────────────────────────────
console.log('\n=== NO WALLET INSTALLED ===');
{
  const page = await pageWith(null);
  await page.getByRole('button', { name: /^connect wallet$/i }).click();
  await page.waitForSelector('[role=alert]', { timeout: 5000 });
  const t = await text(page);
  check('names the missing provider', /No wallet detected/i.test(t), true);
  check('offers the demo path', /Continue in demo mode/i.test(t), true);
  check('does not claim to be connected', /Wrong network/i.test(t), false);
  await page.close();
}

// ── 2. User closes the prompt ───────────────────────────────────────────────
console.log('\n=== PROMPT REJECTED (4001) ===');
{
  const page = await pageWith({ accounts: [ATTESTED], chainId: MONAD, reject: true });
  await page.getByRole('button', { name: /^connect wallet$/i }).click();
  await page.waitForSelector('[role=alert]', { timeout: 5000 });
  const t = await text(page);
  check('reads as a rejection, not a fault', /Connection rejected/i.test(t), true);
  check('stays on the connect screen', /reputation/i.test(t), true);
  await page.close();
}

// ── 3. Connected, wrong network ─────────────────────────────────────────────
console.log('\n=== WRONG NETWORK ===');
{
  const page = await pageWith({ accounts: [ATTESTED], chainId: ETH_MAINNET });
  await page.getByRole('button', { name: /^connect wallet$/i }).click();
  await page.waitForSelector('.chain-warn', { timeout: 10000 });
  check('warns about the network', await page.locator('.chain-warn').isVisible(), true);
  check(
    'still shows which wallet connected',
    /0x5702…Aff8/.test(await page.locator('.wallet').innerText()),
    true
  );
  check('no demo chip in live mode', await page.locator('.wallet-tag').count(), 0);

  await page.getByRole('button', { name: /switch network/i }).click();
  await page.waitForSelector('.chain-warn', { state: 'detached', timeout: 10000 });
  check('warning clears after the switch', await page.locator('.chain-warn').count(), 0);
  check(
    'asked the wallet to switch',
    (await page.evaluate(() => window.__walletCalls)).includes('wallet_switchEthereumChain'),
    true
  );
  await page.close();
}

// ── 4. Connected on Monad — the score is the connected wallet's ─────────────
console.log('\n=== CONNECTED ON MONAD ===');
{
  const page = await pageWith({ accounts: [ATTESTED], chainId: MONAD });
  await page.getByRole('button', { name: /^connect wallet$/i }).click();
  await page.waitForSelector('text=/NET POSITION/i', { timeout: 30000 });
  check('no network warning', await page.locator('.chain-warn').count(), 0);
  check('header shows the connected address', await page.locator('.wallet').innerText(), '0x5702…Aff8');

  await page.getByRole('button', { name: /^vera$/i }).first().click();
  await page.waitForFunction(() => document.body.innerText.includes('Verified wallet'), {
    timeout: 30000,
  });
  const t = await text(page);
  // 739 is computed from the live A-Pass for THIS address — proof the lookup
  // follows the connected wallet rather than the demo toggle.
  check('scores the connected wallet', t.match(/№(\d+)/)?.[1], 739);
  check('demo toggle is gone in live mode', /Use demo wallets/.test(t), true);

  // ── 5. The user swaps accounts in MetaMask ───────────────────────────────
  console.log('\n=== ACCOUNT SWITCHED IN THE WALLET ===');
  await page.evaluate((a) => window.__switchAccount(a), ANON);
  await page.waitForFunction(() => document.body.innerText.includes('Unverified wallet'), {
    timeout: 30000,
  });
  const t2 = await text(page);
  check('re-scores without a reload', t2.match(/№(\d+)/)?.[1], 535);
  check('header follows the new wallet', await page.locator('.wallet').innerText(), '0xdEaD…bEEf');
  await page.close();
}

// ── 6. Session restore, no prompt ───────────────────────────────────────────
console.log('\n=== ALREADY-AUTHORISED SESSION ===');
{
  const page = await pageWith({ accounts: [ATTESTED], chainId: MONAD, authorised: true });
  await page.waitForSelector('text=/NET POSITION/i', { timeout: 30000 });
  const calls = await page.evaluate(() => window.__walletCalls);
  check('restored without clicking connect', await page.locator('.wallet').innerText(), '0x5702…Aff8');
  check('never opened the wallet prompt', calls.includes('eth_requestAccounts'), false);
  await page.close();
}

console.log(fail.length ? `\nFAILED: ${fail.join(', ')}` : '\nALL CHECKS PASSED');
await browser.close();
process.exit(fail.length ? 1 : 0);
