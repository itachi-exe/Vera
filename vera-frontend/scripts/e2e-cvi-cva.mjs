/**
 * End-to-end check of the CVI/CVA integration against the real sandbox.
 * Waits on content rather than fixed timeouts — the Cleanverse round trip
 * varies by a second or so and fixed sleeps make this flaky.
 *
 * Playwright is not a dependency of this app — it is test-only tooling, resolved
 * at run time by scripts/playwright.mjs.
 */
import { loadPlaywright } from "./playwright.mjs";

const { chromium } = await loadPlaywright();

// `npm run dev` serves 3000; `npm run lan` serves 3100. Override with VERA_URL.
const BASE = process.env.VERA_URL ?? 'http://localhost:3000';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });

const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

const fail = [];
const check = (label, actual, expected) => {
  const ok = String(actual) === String(expected);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`);
  if (!ok) fail.push(label);
};

await page.goto(`${BASE}/app`, { waitUntil: 'networkidle' });
// A headless browser injects no EIP-1193 provider, so "Connect wallet" can only
// fail here — correctly, with a named error. The sandbox wallets are what this
// script is actually asserting on, so take the demo path deliberately rather
// than relying on connect quietly succeeding, which is what it used to do.
await page.getByRole('button', { name: /demo mode/i }).first().click();

// Wait for the connected dashboard, then open the tab holding the CVI panel.
await page.waitForSelector('text=/NET POSITION/i', { timeout: 30000 });
await page.getByRole('button', { name: /^vera$/i }).first().click();
await page.waitForSelector('text=/Verified wallet|Unverified wallet/', { timeout: 30000 });

async function read() {
  const t = await page.evaluate(() => document.body.innerText);
  return {
    verified: t.includes('Verified wallet') && !t.includes('Unverified wallet'),
    score: t.match(/№(\d+)/)?.[1],
    identity: t.match(/Identity \(CVI\)\s*\n?\s*30%\s*\n?\s*(\d+)\/300/)?.[1],
    // The ref is a 66-char hash on the wire but is rendered through
    // shortAddr — "0x" + 4 hex, an ellipsis, then the last 4. Asserting on
    // the raw hash looked for 16 contiguous hex chars that are never on
    // screen, so this passed as a failure for as long as it existed.
    // Anchoring to the label also rules out the "none" fallback.
    hasRef: /CVI attestation\s*0x[a-f0-9]{4}…[a-f0-9]{4}/i.test(t),
  };
}

console.log('\n=== VERIFIED WALLET (holds a real A-Pass on Monad) ===');
await page.waitForFunction(() => document.body.innerText.includes('Verified wallet'), { timeout: 30000 });
let s = await read();
check('attestation recognised', s.verified, true);
// 0.3*680 + 0.45*800 + 0.25*700 = 204 + 360 + 175 = 739
check('trust score', s.score, 739);
check('identity component', s.identity, 204);
check('CVI reference shown', s.hasRef, true);

console.log('\n=== ANONYMOUS WALLET (genuinely has no A-Pass) ===');
await page.getByRole('button', { name: /anonymous|unverified/i }).first().click();
await page.waitForFunction(() => document.body.innerText.includes('Unverified wallet'), { timeout: 30000 });
s = await read();
check('attestation absent', s.verified, false);
// Same inputs, identity zeroed: 360 + 175 = 535
check('trust score', s.score, 535);
check('identity component zeroed', s.identity, 0);

console.log('\n=== CVA GATE ON THE BORROW PATH ===');
await page.getByRole('button', { name: /^home$/i }).first().click();
await page.getByRole('button', { name: /borrow|draw/i }).first().click();
await page.waitForSelector('button.sheet-cta', { timeout: 15000 });
const cta = page.locator('button.sheet-cta');
check('CTA label', (await cta.innerText()).trim(), 'Blocked by compliance');
check('CTA disabled', await cta.isDisabled(), true);

console.log(`\nconsole errors: ${errors.length ? errors.join('; ') : 'none'}`);
console.log(fail.length ? `\nFAILED: ${fail.join(', ')}` : '\nALL CHECKS PASSED');
await browser.close();
process.exit(fail.length ? 1 : 0);
