/*
 * Accessibility audit. Reports, does not assert.
 *
 * Contrast is measured from rendered pixels rather than from the computed
 * `background-color`, because the parts of this page most likely to fail are
 * the ones sitting on gradients and on the hero video — and for those, the
 * computed background of the text's own element is `transparent`, which a
 * naive walker reads as "no contrast problem here".
 *
 *   node scripts/a11y-audit.mjs [url]
 */

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3000";
const ROUTES = ["/", "/app"];

/* ---------- contrast maths (WCAG 2.1) ---------- */

function srgbToLinear(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrast(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

function parseRgb(str) {
  const m = str.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(/[,/]/).map((p) => parseFloat(p.trim()));
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
  return { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 };
}

/** Composite a possibly-translucent foreground over an opaque backdrop. */
function flatten(fg, alpha, backdrop) {
  return fg.map((c, i) => Math.round(c * alpha + backdrop[i] * (1 - alpha)));
}

/* ---------- pixel sampling ---------- */

/**
 * The effective backdrop behind an element, sampled from a real screenshot with
 * that element's own text hidden. This is the only way to get an honest answer
 * over a gradient, an image, or video.
 */
async function backdropAt(page, handle) {
  // Sampling below the fold: `clip` is in page coordinates but the screenshot
  // is only the viewport, so anything off-screen clips to nothing and throws.
  await handle.scrollIntoViewIfNeeded().catch(() => {});
  const box = await handle.boundingBox();
  if (!box || box.width < 1 || box.height < 1) return null;

  /*
   * Sample the content box, not the border box. `boundingBox()` returns the
   * outer rectangle, so on a small element with a contrasting border the ring
   * dominates the average and the result describes the border rather than the
   * surface the text sits on. The dashboard's notification badge is 18x17 with
   * a 2px --bg border: 40% of its outer box is that ring, which dragged an
   * 8.55:1 pill down to a reported 2.72:1.
   */
  const inset = await handle.evaluate((el) => {
    const cs = getComputedStyle(el);
    const px = (v) => parseFloat(v) || 0;
    return {
      top: px(cs.borderTopWidth) + px(cs.paddingTop),
      right: px(cs.borderRightWidth) + px(cs.paddingRight),
      bottom: px(cs.borderBottomWidth) + px(cs.paddingBottom),
      left: px(cs.borderLeftWidth) + px(cs.paddingLeft),
    };
  });
  // Only inset while something is left to measure; a pill that is mostly
  // padding would otherwise inset to nothing.
  const innerW = box.width - inset.left - inset.right;
  const innerH = box.height - inset.top - inset.bottom;
  const inner =
    innerW >= 2 && innerH >= 2
      ? { x: box.x + inset.left, y: box.y + inset.top, width: innerW, height: innerH }
      : box;

  const view = page.viewportSize() ?? { width: 1440, height: 900 };
  // Intersect the element with the viewport before clipping.
  const x = Math.max(0, Math.min(inner.x, view.width - 1));
  const y = Math.max(0, Math.min(inner.y, view.height - 1));
  const width = Math.min(inner.width, 400, view.width - x);
  const height = Math.min(inner.height, 40, view.height - y);
  if (width < 1 || height < 1) return null;

  // Hide only the text, not the element: hiding the element would also remove
  // the background we are trying to measure.
  await handle.evaluate((el) => {
    el.dataset.a11yPrev = el.style.color;
    el.style.color = "transparent";
  });

  let buf;
  try {
    buf = await page.screenshot({ clip: { x, y, width, height } });
  } catch {
    buf = null;
  }

  await handle.evaluate((el) => {
    el.style.color = el.dataset.a11yPrev ?? "";
    delete el.dataset.a11yPrev;
  });

  return buf ? await meanColour(page, buf) : null;
}

/** Average a PNG's pixels by decoding it in the browser, which already has a decoder. */
async function meanColour(page, buf) {
  const b64 = buf.toString("base64");
  return await page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const { data: px } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let r = 0;
    let g = 0;
    let b = 0;
    const n = px.length / 4;
    for (let i = 0; i < px.length; i += 4) {
      r += px[i];
      g += px[i + 1];
      b += px[i + 2];
    }
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  }, b64);
}

/* ---------- checks ---------- */

async function auditContrast(page) {
  const targets = await page.evaluate(() => {
    const out = [];
    const seen = new Set();
    for (const el of document.querySelectorAll("body *")) {
      // Only elements holding their own visible text.
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .join(" ")
        .trim();
      if (!own) continue;

      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) < 0.05) {
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;

      const size = parseFloat(cs.fontSize);
      const weight = parseInt(cs.fontWeight, 10) || 400;
      // WCAG "large text": >=24px, or >=18.66px when bold.
      const large = size >= 24 || (size >= 18.66 && weight >= 700);

      const key = `${el.tagName}|${cs.color}|${Math.round(size)}|${own.slice(0, 24)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      el.dataset.a11yId = String(out.length);
      out.push({
        id: out.length,
        tag: el.tagName.toLowerCase(),
        cls: (el.className || "").toString().split(/\s+/).filter(Boolean).slice(0, 2).join("."),
        text: own.slice(0, 46),
        color: cs.color,
        opacity: parseFloat(cs.opacity),
        size,
        large,
        required: large ? 3.0 : 4.5,
      });
    }
    return out;
  });

  const failures = [];
  for (const t of targets) {
    const handle = await page.$(`[data-a11y-id="${t.id}"]`);
    if (!handle) continue;

    const backdrop = await backdropAt(page, handle);
    if (!backdrop) continue;

    const fg = parseRgb(t.color);
    if (!fg) continue;

    // Element opacity dilutes the text toward its own backdrop as well.
    const effAlpha = fg.alpha * (Number.isFinite(t.opacity) ? t.opacity : 1);
    const flat = flatten(fg.rgb, effAlpha, backdrop);
    const ratio = contrast(flat, backdrop);

    if (ratio < t.required) {
      failures.push({ ...t, ratio: Math.round(ratio * 100) / 100, backdrop });
    }
  }
  return failures;
}

async function auditSemantics(page) {
  return await page.evaluate(() => {
    const problems = [];
    const name = (el) => {
      const aria = el.getAttribute("aria-label");
      if (aria?.trim()) return aria.trim();
      const labelledby = el.getAttribute("aria-labelledby");
      if (labelledby) {
        const t = labelledby
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
          .join(" ")
          .trim();
        if (t) return t;
      }
      if (el.tagName === "IMG") return el.getAttribute("alt")?.trim() ?? "";
      const title = el.getAttribute("title");
      if (title?.trim()) return title.trim();
      const text = el.textContent?.trim();
      if (text) return text;
      const svgTitle = el.querySelector("svg [aria-label], svg title");
      return svgTitle?.textContent?.trim() ?? svgTitle?.getAttribute?.("aria-label") ?? "";
    };

    for (const el of document.querySelectorAll("button, a[href], [role='button']")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      if (!name(el)) {
        problems.push({ kind: "no-accessible-name", tag: el.tagName.toLowerCase(), html: el.outerHTML.slice(0, 110) });
      }
    }

    for (const img of document.querySelectorAll("img")) {
      if (img.getAttribute("alt") === null) {
        problems.push({ kind: "img-missing-alt", html: img.outerHTML.slice(0, 110) });
      }
    }

    for (const el of document.querySelectorAll("input, select, textarea")) {
      if (el.type === "hidden") continue;
      const labelled =
        el.labels?.length > 0 ||
        el.getAttribute("aria-label")?.trim() ||
        el.getAttribute("aria-labelledby")?.trim();
      if (!labelled) {
        problems.push({ kind: "input-unlabelled", html: el.outerHTML.slice(0, 110) });
      }
    }

    // Clickable but not focusable.
    for (const el of document.querySelectorAll("div[onclick], span[onclick]")) {
      problems.push({ kind: "clickable-not-focusable", html: el.outerHTML.slice(0, 110) });
    }

    const levels = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => ({
      level: Number(h.tagName[1]),
      text: h.textContent.trim().slice(0, 40),
    }));
    let prev = 0;
    for (const h of levels) {
      if (prev && h.level > prev + 1) {
        problems.push({ kind: "heading-skip", detail: `h${prev} -> h${h.level}`, text: h.text });
      }
      prev = h.level;
    }
    const h1s = levels.filter((h) => h.level === 1).length;
    if (h1s !== 1) problems.push({ kind: "h1-count", detail: String(h1s) });

    if (!document.querySelector("main")) problems.push({ kind: "no-main-landmark" });

    return { problems, headings: levels };
  });
}

async function auditKeyboard(page) {
  const issues = [];
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("Tab");
    // The page sets `scroll-behavior: smooth`, so focusing an element below the
    // fold starts an animated scroll. Measuring immediately reports the element
    // as still off-screen and every stop looks hidden. Let the scroll land.
    await page.waitForTimeout(220);
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const focusVisible = (() => {
        try {
          return el.matches(":focus-visible");
        } catch {
          return false;
        }
      })();
      const ring =
        cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0
          ? `outline ${cs.outlineWidth}`
          : cs.boxShadow !== "none"
            ? "box-shadow"
            : null;
      return {
        tag: el.tagName.toLowerCase(),
        name: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40),
        offscreen: r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight * 40,
        hidden: cs.visibility === "hidden" || cs.display === "none",
        ring,
        focusVisible,
      };
    });
    if (!info) break;
    const key = `${info.tag}|${info.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (info.hidden || info.offscreen) {
      issues.push({ kind: "focus-on-hidden", ...info });
    } else if (!info.ring) {
      issues.push({ kind: "no-focus-indicator", ...info });
    }
  }
  return { stops: seen.size, issues };
}

/* ---------- run ---------- */

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

/*
 * Measure the settled page, not the page mid-animation.
 *
 * Two animations otherwise race every measurement this file takes. The page
 * sets `scroll-behavior: smooth`, so a clip screenshot taken while the view is
 * still gliding captures whichever section happened to be passing by, and an
 * element just scrolled to still reports as off-screen. And `.reveal` fades
 * elements in over 0.7s with a per-element delay, so an element screenshotted
 * the instant it enters the viewport is still transparent — the sample comes
 * back as the page background, which reads as a contrast failure against markup
 * that is fine. Both showed up that way: the nav button "failed" at 1.38:1
 * against a backdrop sampled mid-flight, the hero buttons at 1.04:1 against
 * --bg seen straight through them.
 *
 * Waiting longer only makes the race less likely. Freezing the animations and
 * forcing `.reveal` to its end state makes every measurement deterministic, and
 * that end state is the one a real user reads — a mid-fade element is
 * transiently low-contrast by design, which is not a WCAG finding.
 */
const FREEZE_ANIMATION = `
  html, body, * { scroll-behavior: auto !important; }
  *, *::before, *::after {
    transition: none !important;
    animation: none !important;
  }
  .js-reveal .reveal, .reveal {
    opacity: 1 !important;
    transform: none !important;
  }
`;

for (const route of ROUTES) {
  console.log(`\n${"=".repeat(64)}\n${route}\n${"=".repeat(64)}`);
  await page.goto(BASE + route, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: FREEZE_ANIMATION });

  if (route === "/app") {
    const demo = page.getByRole("button", { name: /demo mode/i }).first();
    if (await demo.count()) {
      await demo.click();
      await page.waitForTimeout(1200);
    }
  }
  // Let the scroll-reveal animation settle, or everything measures as hidden.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(700);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);

  const contrastFails = await auditContrast(page);
  console.log(`\n-- contrast (${contrastFails.length} below AA) --`);
  for (const f of contrastFails) {
    console.log(
      `  ${f.ratio}:1 (needs ${f.required}) ${f.tag}${f.cls ? "." + f.cls : ""} ${f.size}px  "${f.text}"\n` +
        `      colour ${f.color} on rgb(${f.backdrop.join(",")})`
    );
  }

  const sem = await auditSemantics(page);
  console.log(`\n-- semantics (${sem.problems.length}) --`);
  for (const p of sem.problems) {
    console.log(`  ${p.kind}${p.detail ? " " + p.detail : ""} ${p.html ?? p.text ?? ""}`);
  }

  const kb = await auditKeyboard(page);
  console.log(`\n-- keyboard (${kb.stops} stops, ${kb.issues.length} issues) --`);
  for (const i of kb.issues) {
    console.log(`  ${i.kind}: <${i.tag}> "${i.name}" ring=${i.ring}`);
  }
}

await browser.close();
