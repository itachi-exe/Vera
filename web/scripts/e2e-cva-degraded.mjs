/**
 * Does Vera tell the truth when compliance cannot be checked?
 *
 * Forces /api/cva to 502 (the real sandbox-stall failure) and asserts three
 * things: the chip reads as unknown rather than accusing the wallet, the
 * attestation is still honoured (a CVA failure must not silently re-price an
 * attested wallet as anonymous), and the draw is still refused with the real
 * reason. Waits on resolved state, never a fixed delay — the identity lookup
 * takes seconds against the live sandbox and sampling early reads as unattested
 * by design.
 */
let chromium;
for (const spec of [
  process.env.PLAYWRIGHT_PATH,
  'playwright',
]) {
  if (!spec) continue;
  try { ({ chromium } = await import(spec)); break } catch { /* next */ }
}

const URL = process.env.VERA_URL || 'http://localhost:3000';
const ATTESTED = '0x5702b24116718DCF49314231222A33403e88Aff8';

const browser = await chromium.launch();
const page = await browser.newPage();
let failures = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${got}${ok ? '' : ` (want ${want})`}`);
};

await page.addInitScript((addr) => {
  window.ethereum = {
    isMetaMask: true,
    request: async ({ method }) => {
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [addr];
      if (method === 'eth_chainId') return '0x279f';
      return null;
    },
    on: () => {}, removeListener: () => {},
  };
}, ATTESTED);

await page.route('**/api/cva', (route) =>
  route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"upstream error"}' })
);

await page.goto(`${URL}/app`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: /^vera$/i }).first().click();

// Wait for the lookups to actually resolve. Waiting on "a 3-digit score" does
// NOT work: the pre-lookup state renders 535 (unattested, the conservative
// default), so that matches immediately and samples the unresolved UI. The CVA
// chip's own status text is the honest signal — it only leaves "not checked
// yet" once fetchCompliance settles.
await page.waitForFunction(() => {
  const el = [...document.querySelectorAll('.chk')].find((n) => n.innerText.includes('CVA'));
  return el && !/not checked yet/.test(el.innerText);
}, { timeout: 40000 });

console.log('\n=== CVA UNREACHABLE, IDENTITY FINE ===');

const chip = await page.evaluate(() => {
  const el = [...document.querySelectorAll('.chk')].find((n) => n.innerText.includes('CVA'));
  return { text: el.innerText.replace(/\n/g, ' | '), cls: el.className };
});
console.log(`  chip: ${chip.text}   [${chip.cls}]`);
check('reads as unknown', /Unknown/.test(chip.text), true);
check('does not accuse the wallet', /Blocked/.test(chip.text), false);
check('names the real status', /check-failed/.test(chip.text), true);

const body = await page.evaluate(() => document.body.innerText);
check('attestation still honoured', /№\s*739/.test(body), true);

// Assert on the draw CTA, which quotes the terms this wallet is actually being
// offered. Do NOT scan the whole page: ScoreSimulator has a "Without an
// attestation" toggle label with its own local state, so body-wide text matches
// the simulator's control rather than anything about the connected wallet.
const cta = await page.evaluate(
  () => [...document.querySelectorAll('button')].find((b) => /Draw against your score/i.test(b.innerText))?.innerText ?? ''
);
console.log(`  cta: ${cta.replace(/\n/g, ' ')}`);
check('quotes attested LTV', /71%\s*LTV/.test(cta), true);
check('quotes attested APR', /5\.7%\s*APR/.test(cta), true);
// Boundaries matter here: a bare /7% APR/ also matches inside "5.7% APR",
// which is the attested rate — the assertion would fail on correct output.
check('not re-priced as anonymous', /(?<![\d.])45%\s*LTV|(?<![\d.])7%\s*APR/.test(cta), false);

console.log('\n=== THE DRAW MUST STILL BE REFUSED (fail closed) ===');
await page.getByRole('button', { name: /Draw against your score/i }).first().click();
await page.waitForTimeout(1500);
const sheet = await page.evaluate(() => document.body.innerText);
check('CTA refuses the draw', /Blocked by compliance/.test(sheet), true);
check('explains it could not check', /could not reach CVA/i.test(sheet), true);
check('does not claim non-compliance', /has not cleared compliance/.test(sheet), false);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
