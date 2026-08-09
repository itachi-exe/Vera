/**
 * Recapture the phone screenshots the landing page renders inside DeviceMock.
 *
 * The mockups on the landing page are not drawings of the product — they are
 * the product, screenshotted. That only stays true if this is re-run whenever
 * the app UI moves, so it is a script rather than something done by hand once.
 *
 * The capture viewport is 390x711 because that is the aspect of the image slot
 * inside the CSS device frame (250px wide screen, 456px below the status row).
 * Change one and the other has to follow, or the shots letterbox.
 *
 * Needs a server on BASE_URL — `npx next build && npx next start` — since the
 * shots must show real rendered output, not a dev overlay.
 *
 *   node scripts/shots.mjs
 */

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = new URL("../public/shots/", import.meta.url).pathname;
const VIEWPORT = { width: 390, height: 711 };
import { loadPlaywright } from "./playwright.mjs";

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();

try {
  // deviceScaleFactor 2 so the shot is still sharp scaled down into a 250px frame.
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });

  // Demo mode is the only way to a populated screen without a wallet. The
  // button is disabled until the client has hydrated and read the chain.
  const demo = page.getByRole("button", { name: /demo mode/i });
  await demo.waitFor({ state: "visible", timeout: 30000 });
  for (let i = 0; i < 60 && (await demo.isDisabled()); i++) await page.waitForTimeout(500);
  await demo.click();
  await page.getByRole("navigation").waitFor({ timeout: 30000 });
  await page.waitForTimeout(2500);

  const tab = async (name) => {
    await page.getByRole("button", { name: new RegExp(`^${name}$`, "i") }).first().click();
    await page.waitForTimeout(1200);
  };

  // Pin the attested wallet. Which demo wallet loads depends on what the CVI
  // sandbox answers, and the unattested one is a different product: a 45% line
  // it is already past, in warning orange. Without this the three shots can
  // disagree with each other between runs.
  await tab("Vera");
  await page.getByRole("button", { name: "Verified", exact: true }).click();
  await page.waitForTimeout(2500);

  const shoot = async (file) => {
    await page.screenshot({ path: `${OUT}${file}` });
    console.log(`  wrote public/shots/${file}`);
  };

  // dashboard — Hero. The position, the borrowing power, what is left to draw.
  await tab("Home");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await shoot("app-home.png");

  // record — AttestationPanel. Scrolled to the activity feed, which is the
  // claim that panel makes: a record that cannot be edited. The page bottom is
  // the natural stop, then it backs off far enough that whatever card the top
  // edge lands in is shown whole rather than sliced.
  await tab("Positions");
  await page.evaluate(() => {
    // html has scroll-behavior: smooth, so a scroll is animated and every rect
    // read straight after it is stale. Work in document coordinates and jump
    // once, instantly, at the end.
    const y0 = window.scrollY;
    const box = (e) => {
      const r = e.getBoundingClientRect();
      return { top: r.top + y0, bottom: r.bottom + y0 };
    };
    let y = document.documentElement.scrollHeight - window.innerHeight;
    // Whatever card the top edge lands in gets shown whole rather than sliced.
    const cut = [...document.querySelectorAll(".rows li, .terms, .risk-note, .risk-warn, .feed li")]
      .map(box)
      .filter((r) => r.top < y + 12 && r.bottom > y + 24)
      .sort((a, b) => b.top - a.top)[0];
    if (cut) y = Math.max(0, cut.top - 12);
    window.scrollTo({ top: y, behavior: "instant" });
  });
  await page.waitForTimeout(700);
  await shoot("app-record.png");

  // ask — Steps. The borrow sheet mid-draw, so the before/after health factor
  // is on screen rather than a row of zeroes.
  await tab("Home");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.locator(".promo").first().click();
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "50%" }).first().click();
  await page.waitForTimeout(800);
  await shoot("app-borrow.png");
} finally {
  await browser.close();
}
