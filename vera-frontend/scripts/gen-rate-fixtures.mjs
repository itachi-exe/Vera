/**
 * Generate the rate table from the JavaScript the UI actually uses, so the
 * Solidity library can be checked against it rather than against a set of
 * numbers someone typed into a test twice.
 *
 * `vera-frontend/lib/vera.js` is the quote a borrower reads. `vera-contracts/src/VeraMath.sol`
 * is what the pool enforces. If they ever disagree, a wallet is charged a rate
 * it never agreed to — so the agreement is asserted, not assumed.
 *
 *   node scripts/gen-rate-fixtures.mjs
 *
 * Writes vera-contracts/test/fixtures/rates.json. Re-run it whenever vera.js changes;
 * VeraMathParity.t.sol will fail until the Solidity side is brought back in line.
 */

import {writeFileSync, mkdirSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

import {
  ltvFor,
  liquidationThreshold,
  borrowApr,
  supplyApy,
  computeTrustScore,
} from "../lib/vera.js";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "..", "vera-contracts", "test", "fixtures", "rates.json");

/** Percent with one decimal place -> basis points, without float dust. */
const toBps = (percent) => Math.round(percent * 100);

const scores = [];
const ltvVerified = [];
const ltvAnon = [];
const liqVerified = [];
const liqAnon = [];
const aprBps = [];
const apyBps = [];

for (let s = 0; s <= 1000; s++) {
  scores.push(s);
  ltvVerified.push(ltvFor(s, true));
  ltvAnon.push(ltvFor(s, false));
  liqVerified.push(liquidationThreshold(s, true));
  liqAnon.push(liquidationThreshold(s, false));
  aprBps.push(toBps(borrowApr(s)));
  apyBps.push(toBps(supplyApy(s)));
}

/**
 * A spread of trust-score inputs, including the boundaries where rounding is
 * most likely to split the two implementations.
 */
const scoreCases = [];
const grid = [0, 1, 2, 3, 137, 249, 250, 333, 500, 680, 731, 800, 999, 1000];
for (const identity of grid) {
  for (const history of grid) {
    for (const repayment of [0, 137, 500, 700, 1000]) {
      for (const verified of [true, false]) {
        scoreCases.push({
          identity,
          history,
          repayment,
          verified,
          expected: computeTrustScore({identity, history, repayment, verified}),
        });
      }
    }
  }
}

mkdirSync(dirname(out), {recursive: true});
writeFileSync(
  out,
  JSON.stringify(
    {
      _generatedBy: "vera-frontend/scripts/gen-rate-fixtures.mjs from vera-frontend/lib/vera.js",
      scores,
      ltvVerified,
      ltvAnon,
      liqVerified,
      liqAnon,
      aprBps,
      apyBps,
      scoreIdentity: scoreCases.map((c) => c.identity),
      scoreHistory: scoreCases.map((c) => c.history),
      scoreRepayment: scoreCases.map((c) => c.repayment),
      scoreVerified: scoreCases.map((c) => (c.verified ? 1 : 0)),
      scoreExpected: scoreCases.map((c) => c.expected),
    },
    null,
    2
  ) + "\n"
);

console.log(`wrote ${out}`);
console.log(`  ${scores.length} rate rows, ${scoreCases.length} trust-score cases`);
