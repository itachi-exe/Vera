// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {VeraMath} from "../src/VeraMath.sol";

/// @notice VeraMath must agree with `vera-frontend/lib/vera.js`, which is what the UI quotes.
/// @dev The expected values below were computed from that file, not from this
///      library — otherwise the test would only prove the code agrees with itself.
///      The two sandbox-measured wallets (731 verified, 527 anonymous) are pinned
///      explicitly because they are the numbers in the demo and the writeup.
contract VeraMathTest is Test {
    /* ---------- trust score ---------- */

    function test_scoreMatchesTheVerifiedSandboxWallet() public pure {
        // identity 680, history 800, repayment 700, verified
        // 0.3*680 + 0.45*800 + 0.25*700 = 204 + 360 + 175 = 739
        assertEq(VeraMath.trustScore(680, 800, 700, true), 739);
    }

    function test_identityIsZeroedWhenUnverified() public pure {
        // Same inputs, unverified: identity contributes nothing.
        // 0.45*800 + 0.25*700 = 360 + 175 = 535
        assertEq(VeraMath.trustScore(680, 800, 700, false), 535);
    }

    function test_verificationIsTheOnlyDifference() public pure {
        uint256 on = VeraMath.trustScore(680, 800, 700, true);
        uint256 off = VeraMath.trustScore(680, 800, 700, false);
        // The gap is exactly the identity weight applied to the identity score.
        assertEq(on - off, 204);
    }

    function test_scoreBounds() public pure {
        assertEq(VeraMath.trustScore(0, 0, 0, true), 0);
        assertEq(VeraMath.trustScore(1000, 1000, 1000, true), 1000);
        assertEq(VeraMath.trustScore(1000, 1000, 1000, false), 700);
    }

    function test_scoreClampsOversizedComponents() public pure {
        // A component above 1000 must not inflate the total past the max.
        assertEq(VeraMath.trustScore(5000, 5000, 5000, true), 1000);
    }

    function test_scoreRoundsHalfUp() public pure {
        // 0.45 * 1 = 0.45 -> 0;  history 2 -> 0.9 -> 1
        assertEq(VeraMath.trustScore(0, 1, 0, true), 0);
        assertEq(VeraMath.trustScore(0, 2, 0, true), 1);
    }

    function testFuzz_scoreNeverExceedsMax(
        uint256 identity,
        uint256 history,
        uint256 repayment,
        bool verified
    ) public pure {
        assertLe(VeraMath.trustScore(identity, history, repayment, verified), 1000);
    }

    function testFuzz_verifyingNeverLowersScore(
        uint256 identity,
        uint256 history,
        uint256 repayment
    ) public pure {
        assertGe(
            VeraMath.trustScore(identity, history, repayment, true),
            VeraMath.trustScore(identity, history, repayment, false)
        );
    }

    /* ---------- LTV ---------- */

    function test_ltvMatchesTheDemoWallets() public pure {
        // round(731 * 0.096) = round(70.176) = 70
        assertEq(VeraMath.ltvPct(731, true), 70);
        // round(527 * 0.096) = round(50.592) = 51, capped to 45 by the anon rule.
        assertEq(VeraMath.ltvPct(527, false), 45);
    }

    function test_anonCapBindsEvenOnAPerfectScore() public pure {
        assertEq(VeraMath.ltvPct(1000, false), 45);
    }

    function test_ltvFloorAndCeiling() public pure {
        assertEq(VeraMath.ltvPct(0, true), 20); // floor
        assertEq(VeraMath.ltvPct(1000, true), 90); // round(96) -> capped at 90
    }

    function test_ltvIsMonotonicInScore() public pure {
        uint256 prev = 0;
        for (uint256 s = 0; s <= 1000; s += 25) {
            uint256 ltv = VeraMath.ltvPct(s, true);
            assertGe(ltv, prev);
            prev = ltv;
        }
    }

    function testFuzz_ltvRespectsBounds(uint256 score, bool verified) public pure {
        score = bound(score, 0, 1000);
        uint256 ltv = VeraMath.ltvPct(score, verified);
        assertGe(ltv, 20);
        assertLe(ltv, verified ? 90 : 45);
    }

    /* ---------- liquidation threshold ---------- */

    function test_thresholdSitsEightPointsAboveLtv() public pure {
        assertEq(VeraMath.liquidationThresholdPct(731, true), 78);
        assertEq(VeraMath.liquidationThresholdPct(527, false), 53);
    }

    function test_thresholdIsCappedAt95() public pure {
        // 90 + 8 = 98, capped.
        assertEq(VeraMath.liquidationThresholdPct(1000, true), 95);
    }

    function testFuzz_thresholdAlwaysAboveLtv(uint256 score, bool verified) public pure {
        score = bound(score, 0, 1000);
        assertGt(
            VeraMath.liquidationThresholdPct(score, verified), VeraMath.ltvPct(score, verified)
        );
    }

    /* ---------- rates ---------- */

    function test_borrowAprMatchesTheDemoWallets() public pure {
        // 10.6 - 731*0.00665 = 10.6 - 4.86115 = 5.73885 -> 5.7%
        assertEq(VeraMath.borrowAprBps(731), 570);
        // 10.6 - 527*0.00665 = 10.6 - 3.50455 = 7.09545 -> 7.1%
        assertEq(VeraMath.borrowAprBps(527), 710);
    }

    function test_borrowAprBounds() public pure {
        assertEq(VeraMath.borrowAprBps(0), 1060); // 10.6%
        // 10.6 - 6.65 = 3.95 -> 4.0% at the top score; floor never binds in range.
        assertEq(VeraMath.borrowAprBps(1000), 400);
    }

    function test_betterScoreNeverCostsMore() public pure {
        uint256 prev = type(uint256).max;
        for (uint256 s = 0; s <= 1000; s += 10) {
            uint256 apr = VeraMath.borrowAprBps(s);
            assertLe(apr, prev);
            prev = apr;
        }
    }

    function test_supplyApyTracksBorrowApr() public pure {
        // 5.7 * 0.79 = 4.503 -> 4.5%
        assertEq(VeraMath.supplyApyBps(731), 450);
        // 7.1 * 0.79 = 5.609 -> 5.6%
        assertEq(VeraMath.supplyApyBps(527), 560);
    }

    function test_supplyApyIsAlwaysBelowBorrowApr() public pure {
        // The spread is what makes the pool solvent; it must never invert.
        for (uint256 s = 0; s <= 1000; s += 50) {
            assertLt(VeraMath.supplyApyBps(s), VeraMath.borrowAprBps(s));
        }
    }

    function testFuzz_ratesStayInBand(uint256 score) public pure {
        score = bound(score, 0, 1000);
        uint256 apr = VeraMath.borrowAprBps(score);
        assertGe(apr, 350);
        assertLe(apr, 1200);
        uint256 apy = VeraMath.supplyApyBps(score);
        assertGe(apy, 100);
        assertLe(apy, 1000);
    }

    function testFuzz_ratesQuantiseToTenBps(uint256 score) public pure {
        score = bound(score, 0, 1000);
        // The UI shows one decimal place of a percent; the contract must not be
        // more precise than the quote a borrower agreed to.
        assertEq(VeraMath.borrowAprBps(score) % 10, 0);
        assertEq(VeraMath.supplyApyBps(score) % 10, 0);
    }

    /* ---------- health factor ---------- */

    function test_healthFactorAtExactlyOne() public pure {
        // 1000 collateral, 78% threshold, 780 debt -> exactly 1.0
        assertEq(VeraMath.healthFactorWad(1000e18, 780e18, 78), 1e18);
    }

    function test_healthFactorBelowOneWhenUnderwater() public pure {
        assertLt(VeraMath.healthFactorWad(1000e18, 800e18, 78), 1e18);
    }

    function test_noDebtIsInfinitelyHealthy() public pure {
        assertEq(VeraMath.healthFactorWad(1000e18, 0, 78), type(uint256).max);
    }

    function test_maxDebtFor() public pure {
        assertEq(VeraMath.maxDebtFor(1000e18, 70), 700e18);
        assertEq(VeraMath.maxDebtFor(1000e18, 45), 450e18);
        assertEq(VeraMath.maxDebtFor(0, 70), 0);
    }

    /* ---------- the demo claim, end to end ---------- */

    /// The product demo is one wallet shown two ways with identical collateral.
    /// This is that claim, as arithmetic.
    function test_attestationAloneMovesTheTerms() public pure {
        uint256 identity = 680;
        uint256 history = 620;
        uint256 repayment = 700;

        uint256 attested = VeraMath.trustScore(identity, history, repayment, true);
        uint256 anon = VeraMath.trustScore(identity, history, repayment, false);

        uint256 collateral = 10_000e18;

        uint256 attestedBorrow =
            VeraMath.maxDebtFor(collateral, VeraMath.ltvPct(attested, true));
        uint256 anonBorrow = VeraMath.maxDebtFor(collateral, VeraMath.ltvPct(anon, false));

        assertGt(attestedBorrow, anonBorrow);
        assertLt(VeraMath.borrowAprBps(attested), VeraMath.borrowAprBps(anon));
    }
}
