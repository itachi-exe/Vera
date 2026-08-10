/**
 * Capture the screenshot set that docs/SUBMISSION.md embeds.
 *
 * Distinct from scripts/shots.mjs, which recaptures the three *phone* shots the
 * landing page renders inside DeviceMock at a fixed 390x711 (that aspect is
 * load-bearing for the CSS device frame). This one captures the judge-facing
 * surface: desktop landing sections, and the connected app in both wallet
 * states — the verified/anonymous contrast is the whole claim, so it has to be
 * shown as two shots of the same screen, not described.
 *
 * Needs a production server on BASE_URL (`npx next start`). Playwright is
 * deliberately not a project dependency, so this resolves it the same way the
 * e2e suites do, via scripts/playwright.mjs.
 *
 *   node scripts/shots-submission.mjs
 */

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = new URL("../public/shots/", import.meta.url).pathname;
const EXEC = process.env.CHROME_PATH || undefined;

import { loadPlaywright } from "./playwright.mjs";

const { chromium } = await loadPlaywright();
const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});

const wrote = [];
const shoot = async (page, file, opts = {}) => {
  // Next renders its dev-tools button into a <nextjs-portal> shadow host, which
  // lands in the corner of every shot. It is a toolbar, not part of the product.
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
  await page.screenshot({ path: `${OUT}${file}`, ...opts });
  wrote.push(file);
  console.log(`  wrote public/shots/${file}`);
};

try {
  /* ---------- desktop landing ---------- */
  const desk = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  await desk.goto(BASE, { waitUntil: "networkidle" });
  // Reveal animations are IntersectionObserver-driven; a shot taken before they
  // settle catches half-faded sections. Scroll the page once to trigger them all,
  // then return to the top.
  await desk.evaluate(async () => {
    const step = window.innerHeight;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo({ top: y, behavior: "instant" });
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  await desk.waitForTimeout(1200);
  await shoot(desk, "landing-hero.png");

  await shoot(desk, "landing-full.png", { fullPage: true });

  /* ---------- connected app, both wallet states ---------- */
  // 430x932 keeps the app in its phone layout — the app is designed
  // mobile-first and a desktop viewport letterboxes it.
  const app = await browser.newPage({
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 2,
  });
  await app.goto(`${BASE}/app`, { waitUntil: "networkidle" });

  const demo = app.getByRole("button", { name: /demo mode/i });
  await demo.waitFor({ state: "visible", timeout: 30000 });
  for (let i = 0; i < 60 && (await demo.isDisabled()); i++) await app.waitForTimeout(500);
  await demo.click();
  await app.getByRole("navigation").waitFor({ timeout: 30000 });
  await app.waitForTimeout(2500);

  const tab = async (name) => {
    await app.getByRole("button", { name: new RegExp(`^${name}$`, "i") }).first().click();
    await app.waitForTimeout(1200);
  };
  const persona = async (name) => {
    await tab("Vera");
    await app.getByRole("button", { name, exact: true }).click();
    // The CVI/CVA round trip is live against the sandbox, which stalls; give it
    // room rather than catching a half-loaded chip.
    await app.waitForTimeout(4000);
  };
  const top = async () => {
    await app.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await app.waitForTimeout(400);
  };

  // The CVI and CVA verdict chips sit below the fold on the Vera tab, so the
  // viewport shots crop them. They are the Cleanverse integration made visible,
  // so capture the pair as an element shot rather than asking a judge to scroll
  // a full-page image.
  const chips = async (file) => {
    await tab("Vera");
    const duo = app.locator(".duo").first();
    await duo.scrollIntoViewIfNeeded();
    await app.waitForTimeout(600);
    await app.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
    await duo.screenshot({ path: `${OUT}${file}` });
    wrote.push(file);
    console.log(`  wrote public/shots/${file}`);
  };

  // The borrow sheet is where the trust score stops being a number and becomes
  // money: the amount field's ceiling is the borrowing power the score bought,
  // and the terms list underneath is the price. Press Max when there is headroom
  // so the figure is stated rather than implied. On the anonymous wallet there
  // is none — the same collateral at 45% LTV no longer covers the same debt, so
  // the chip is disabled and the sheet says so. That refusal is the claim, so
  // capture it as it stands rather than forcing a click that cannot happen.
  const borrowSheet = async (file) => {
    await tab("Home");
    await top();
    await app.getByRole("button", { name: "Actions" }).click();
    const menu = app.getByRole("dialog", { name: "Actions" });
    await menu.getByRole("button", { name: /^Borrow/ }).click();
    await app.waitForTimeout(900);
    const maxChip = app.getByRole("button", { name: "Max", exact: true });
    if (await maxChip.isEnabled().catch(() => false)) {
      await maxChip.click();
      await app.waitForTimeout(700);
    }
    await shoot(app, file);
    await app.keyboard.press("Escape");
    await app.waitForTimeout(500);
  };

  // Verified: the score panel, then the terms it buys.
  await persona("Verified");
  await top();
  await shoot(app, "app-vera-verified.png");
  await shoot(app, "app-vera-verified-full.png", { fullPage: true });
  await chips("app-chips-verified.png");

  await borrowSheet("app-borrow-verified.png");

  await tab("Home");
  await top();
  await shoot(app, "app-home-verified.png");

  await tab("Markets");
  await top();
  await shoot(app, "app-markets.png");

  await tab("Positions");
  await top();
  await shoot(app, "app-positions.png");

  // Anonymous: same screens, no A-Pass. This is the other half of the claim.
  await persona("Anonymous");
  await top();
  await shoot(app, "app-vera-anon.png");
  await shoot(app, "app-vera-anon-full.png", { fullPage: true });
  await chips("app-chips-anon.png");

  await borrowSheet("app-borrow-anon.png");

  await tab("Home");
  await top();
  await shoot(app, "app-home-anon.png");
} finally {
  await browser.close();
  console.log(`\n${wrote.length} shots written to public/shots/`);
}
