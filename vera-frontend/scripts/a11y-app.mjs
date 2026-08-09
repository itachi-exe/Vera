/**
 * Accessibility sweep of the connected app screen.
 *
 * Focused on the things that a design this dark and this low-contrast is most
 * likely to get wrong, and that no unit test can see: text that does not meet
 * WCAG AA against what is actually painted behind it, controls with no accessible
 * name, and state that is carried by colour alone.
 *
 * That last one is why this exists at all. The verdict chips render a coloured
 * dot per state, and after adding the "Unknown" state there are three of them.
 * If the dot were the only difference, a red/green colour-blind user could not
 * tell "Cleared" from "Blocked" — the exact distinction the protocol turns on.
 *
 *   node scripts/a11y-app.mjs
 */

const BASE = process.env.BASE_URL || "http://localhost:3000";
import { loadPlaywright } from "./playwright.mjs";

let failed = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${actual}${ok ? "" : ` (want ${expected})`}`);
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();

try {
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });

  // Demo mode reaches the connected screen without a wallet, which is where all
  // the state chips and controls live. The connect screen has almost nothing on it.
  await page.getByRole("button", { name: /demo mode/i }).click();
  await page.getByRole("navigation").waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: /^vera$/i }).click();
  await page.waitForFunction(
    () => !/not checked yet/.test(document.body.innerText),
    { timeout: 30000 }
  );

  /**
   * Contrast against what is actually painted, not against the nearest ancestor
   * with a declared background.
   *
   * Walking up for the first non-transparent background is the part that matters:
   * this UI stacks translucent panels on a dark page, so an element's own computed
   * background is usually `rgba(0,0,0,0)` and naive samplers silently compare the
   * text to black and report a passing ratio that nobody can actually read.
   */
  const audit = await page.evaluate(() => {
    const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number);

    const lum = ([r, g, b]) => {
      const f = (v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };

    const over = (fg, bg) => {
      const a = fg[3] ?? 1;
      return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
    };

    /**
     * Every colour an element's background may actually paint.
     *
     * A gradient lives in `background-image`, leaving `backgroundColor`
     * transparent — so treating colour as the only source walks straight past a
     * solid-looking button to the dark page behind it and reports ~1:1 on text
     * that is in fact high contrast. Each gradient stop is returned separately
     * and the caller scores against the worst one, since the text crosses all of
     * them.
     */
    const ownBackgrounds = (node) => {
      const s = getComputedStyle(node);
      const own = parse(s.backgroundColor);
      const out = [];
      if (own.length && (own[3] ?? 1) > 0) out.push(own);
      const img = s.backgroundImage;
      if (img && img !== "none") {
        for (const m of img.matchAll(/rgba?\(([^)]+)\)/g)) {
          const c = m[1].split(",").map(Number);
          if (c.length >= 3 && (c[3] ?? 1) > 0) out.push(c);
        }
      }
      return out;
    };

    const backdrops = (el) => {
      let node = el;
      const stack = [];
      while (node && node !== document.documentElement) {
        const own = ownBackgrounds(node);
        if (own.length) stack.push(own);
        node = node.parentElement;
      }
      stack.push([[0, 0, 0]]);
      // Compose far-to-near so translucent panels layer the way they paint,
      // branching wherever a layer offers more than one candidate colour.
      return stack.reverse().reduce(
        (accs, layer) => accs.flatMap((acc) => layer.map((c) => over(c, acc))),
        [[0, 0, 0]]
      );
    };

    const ratio = (a, b) => {
      const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
      return (hi + 0.05) / (lo + 0.05);
    };

    const low = [];
    const unnamed = [];

    for (const el of document.querySelectorAll("*")) {
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) continue;
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height) continue;

      // Own text only — otherwise every ancestor inherits its children's text and
      // gets audited against a background it does not paint.
      const text = [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .join(" ")
        .trim();

      if (text) {
        const fg = parse(s.color);
        // Score against the worst candidate background: text over a gradient has
        // to stay readable across every stop it crosses, not just the kindest one.
        const cands = backdrops(el);
        let bg = cands[0];
        let r = Infinity;
        for (const c of cands) {
          const rr = ratio(over(fg, c), c);
          if (rr < r) {
            r = rr;
            bg = c;
          }
        }
        const px = parseFloat(s.fontSize);
        const bold = Number(s.fontWeight) >= 700;
        // WCAG AA: 3.0 for large text (>=24px, or >=18.66px bold), else 4.5.
        const need = px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5;
        if (r < need) {
          low.push({
            text: text.slice(0, 42),
            ratio: Math.round(r * 100) / 100,
            need,
            px: Math.round(px * 10) / 10,
            tag: el.tagName.toLowerCase(),
            cls: el.className?.toString().slice(0, 30),
            // The pair that scored worst, so a failure can be reproduced in a
            // contrast checker without re-deriving what was painted behind it.
            fg: s.color,
            bg: `rgb(${bg.map((n) => Math.round(n)).join(", ")})`,
          });
        }
      }

      if (el.matches("button, a[href], input, select, textarea")) {
        const name = (
          el.getAttribute("aria-label") ||
          el.innerText ||
          el.getAttribute("title") ||
          el.getAttribute("alt") ||
          ""
        ).trim();
        if (!name) unnamed.push(`${el.tagName.toLowerCase()}.${el.className?.toString().slice(0, 30)}`);
      }
    }

    // Every verdict chip: does the wording alone carry the state?
    const chips = [...document.querySelectorAll(".chk")].map((el) => ({
      cls: el.className,
      text: el.innerText.replace(/\s+/g, " ").trim(),
      dot: getComputedStyle(el.querySelector(".chk-dot")).backgroundColor,
    }));

    return { low, unnamed, chips, imgsNoAlt: document.querySelectorAll("img:not([alt])").length };
  });

  console.log("=== TEXT CONTRAST (WCAG AA) ===");
  for (const f of audit.low) {
    console.log(
      `     ${f.ratio}:1 (need ${f.need}) ${f.px}px  ${f.fg} on ${f.bg}\n` +
        `        <${f.tag} class="${f.cls}"> "${f.text}"`
    );
  }
  check("elements below AA", audit.low.length, 0);

  console.log("\n=== ACCESSIBLE NAMES ===");
  for (const u of audit.unnamed) console.log(`     unnamed: ${u}`);
  check("controls with no accessible name", audit.unnamed.length, 0);
  check("images missing an alt attribute", audit.imgsNoAlt, 0);

  console.log("\n=== STATE IS NOT CARRIED BY COLOUR ALONE ===");
  for (const c of audit.chips) console.log(`     [${c.dot}] ${c.text}`);
  const verdicts = audit.chips.map((c) => c.text.split("\n").pop());
  check("every chip states its verdict in words", verdicts.every(Boolean), true);
  check("chips found", audit.chips.length > 0, true);

  console.log("\n=== KEYBOARD REACHABILITY ===");
  const reachable = await page.evaluate(() => {
    const sel = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const all = [...document.querySelectorAll(sel)].filter((el) => {
      const s = getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden" && el.getBoundingClientRect().width;
    });
    return {
      total: all.length,
      removed: all.filter((el) => el.getAttribute("tabindex") === "-1").length,
      disabled: all.filter((el) => el.disabled).length,
    };
  });
  console.log(`     ${reachable.total} focusable controls, ${reachable.disabled} disabled`);
  check("no visible control removed from the tab order", reachable.removed, 0);
} finally {
  await browser.close();
}

console.log(failed === 0 ? "\nALL CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
