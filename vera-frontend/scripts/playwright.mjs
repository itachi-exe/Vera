/**
 * Resolve Playwright without depending on where it happens to be installed.
 *
 * The browser suites are dev tooling, not part of the shipped app, so Playwright
 * is deliberately not a dependency in package.json — installing it downloads
 * browser binaries that nothing in production needs.
 *
 * Resolution order:
 *
 *   1. $PLAYWRIGHT_PATH   explicit override, wins over everything
 *   2. "playwright"       a normal local or global install
 *   3. $PLAYWRIGHT_HOME   a checkout elsewhere on the machine
 *
 * If none resolve, the caller gets an actionable message rather than a bare
 * ERR_MODULE_NOT_FOUND naming a path that means nothing to the reader.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export async function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_PATH,
    "playwright",
    process.env.PLAYWRIGHT_HOME && `${process.env.PLAYWRIGHT_HOME}/index.mjs`,
  ].filter(Boolean);

  for (const spec of candidates) {
    for (const load of [() => import(require.resolve(spec)), () => import(spec)]) {
      try {
        const mod = await load();
        /*
         * Playwright is CommonJS. Node usually detects its named exports, but
         * when it is resolved from outside the project (PLAYWRIGHT_PATH, a
         * global install) that detection can fail and every named export comes
         * back undefined — which surfaces at the call site as
         * "Cannot read properties of undefined (reading 'launch')", naming
         * `chromium` rather than the resolution that actually went wrong.
         * Unwrap the default interop object so callers always get the real one.
         */
        if (mod?.chromium) return mod;
        if (mod?.default?.chromium) return mod.default;
      } catch {}
    }
  }

  throw new Error(
    "Playwright not found. Install it (npm i -D playwright && npx playwright install chromium), " +
      "or point PLAYWRIGHT_PATH at an existing install."
  );
}

/** Convenience for the common `const { chromium } = ...` case. */
export async function chromium() {
  const { chromium: c } = await loadPlaywright();
  return c;
}
