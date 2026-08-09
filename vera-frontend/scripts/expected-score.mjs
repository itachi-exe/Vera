/**
 * The trust score the app *should* be showing, derived from the A-Pass the
 * sandbox is serving right now.
 *
 * The e2e suites used to assert a literal 739. That number came from a real
 * measurement, but it is not a property of Vera — it is a property of whatever
 * A-Pass Cleanverse currently has on file for the demo wallet. When they
 * re-issued that record (tier 20 -> 50, subTier 1 -> 9, group "oc" -> ""), the
 * identity score moved 681 -> 726 and three suites failed for a change on their
 * side. A hardcoded expectation cannot tell that apart from a real regression,
 * which is the one job it had.
 *
 * What is worth asserting is that the screen agrees with the API, and that the
 * weighting still zeroes identity for an unattested wallet. Both survive the
 * record changing underneath.
 */
import { borrowApr, computeTrustScore, ltvFor, WEIGHTS } from "../lib/vera.js";
import { DEMO_WALLET, historyInputs } from "../lib/cleanverse.js";

/**
 * @param {string} base    origin of a running Vera server
 * @param {string} address wallet to score; defaults to the demo A-Pass holder
 */
export async function expectedScore(base, address = DEMO_WALLET) {
  const res = await fetch(`${base}/api/cvi`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });
  if (!res.ok) throw new Error(`/api/cvi returned HTTP ${res.status}`);

  const live = await res.json();
  const { history, repayment } = historyInputs();
  const inputs = { identity: live.score, history, repayment };

  const verified = computeTrustScore({ ...inputs, verified: true });
  const anonymous = computeTrustScore({ ...inputs, verified: false });

  return {
    identity: live.score,
    verified,
    anonymous,
    identityPoints: Math.round(WEIGHTS.identity * live.score),
    // The terms the CTA quotes for each state. Same reason the score is derived:
    // these move with the A-Pass, so asserting them as literals only pins the
    // sandbox's current mood.
    ltv: ltvFor(verified, true),
    apr: borrowApr(verified),
    anonLtv: ltvFor(anonymous, false),
    anonApr: borrowApr(anonymous),
  };
}
