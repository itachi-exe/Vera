// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {VeraMath} from "../src/VeraMath.sol";

/// @notice Proves {VeraMath} agrees with `vera-frontend/lib/vera.js` across the whole curve.
/// @dev The fixtures are generated from the UI library itself by
///      `vera-frontend/scripts/gen-rate-fixtures.mjs`, not from this contract, so this is a
///      real cross-implementation check rather than the code agreeing with itself.
///
///      Why it matters: `vera.js` produces the number a borrower is shown, and
///      {VeraMath} produces the number the pool enforces. Any divergence means a
///      wallet is charged terms it never agreed to. Regenerate the fixtures after
///      touching either side; this suite fails until they match again.
contract VeraMathParityTest is Test {
    using stdJson for string;

    string json;

    uint256[] ltvVerified;
    uint256[] ltvAnon;
    uint256[] liqVerified;
    uint256[] liqAnon;
    uint256[] aprBps;
    uint256[] apyBps;

    uint256[] scoreIdentity;
    uint256[] scoreHistory;
    uint256[] scoreRepayment;
    uint256[] scoreVerified;
    uint256[] scoreExpected;

    function setUp() public {
        json = vm.readFile("test/fixtures/rates.json");

        ltvVerified = json.readUintArray("$.ltvVerified");
        ltvAnon = json.readUintArray("$.ltvAnon");
        liqVerified = json.readUintArray("$.liqVerified");
        liqAnon = json.readUintArray("$.liqAnon");
        aprBps = json.readUintArray("$.aprBps");
        apyBps = json.readUintArray("$.apyBps");

        scoreIdentity = json.readUintArray("$.scoreIdentity");
        scoreHistory = json.readUintArray("$.scoreHistory");
        scoreRepayment = json.readUintArray("$.scoreRepayment");
        scoreVerified = json.readUintArray("$.scoreVerified");
        scoreExpected = json.readUintArray("$.scoreExpected");
    }

    /// Guards against a truncated or stale fixture silently shrinking coverage.
    function test_fixturesCoverTheWholeScoreRange() public view {
        assertEq(ltvVerified.length, 1001, "expected one row per score 0..1000");
        assertEq(ltvAnon.length, 1001);
        assertEq(liqVerified.length, 1001);
        assertEq(liqAnon.length, 1001);
        assertEq(aprBps.length, 1001);
        assertEq(apyBps.length, 1001);
        assertGt(scoreExpected.length, 0, "trust-score cases missing");
        assertEq(scoreIdentity.length, scoreExpected.length);
        assertEq(scoreHistory.length, scoreExpected.length);
        assertEq(scoreRepayment.length, scoreExpected.length);
        assertEq(scoreVerified.length, scoreExpected.length);
    }

    /* ---------- rate curves, every score 0..1000 ---------- */

    function test_ltvParityVerified() public view {
        for (uint256 s = 0; s < ltvVerified.length; s++) {
            assertEq(VeraMath.ltvPct(s, true), ltvVerified[s], _at("ltv verified", s));
        }
    }

    function test_ltvParityAnonymous() public view {
        for (uint256 s = 0; s < ltvAnon.length; s++) {
            assertEq(VeraMath.ltvPct(s, false), ltvAnon[s], _at("ltv anon", s));
        }
    }

    function test_liquidationThresholdParityVerified() public view {
        for (uint256 s = 0; s < liqVerified.length; s++) {
            assertEq(
                VeraMath.liquidationThresholdPct(s, true), liqVerified[s], _at("liq verified", s)
            );
        }
    }

    function test_liquidationThresholdParityAnonymous() public view {
        for (uint256 s = 0; s < liqAnon.length; s++) {
            assertEq(VeraMath.liquidationThresholdPct(s, false), liqAnon[s], _at("liq anon", s));
        }
    }

    function test_borrowAprParity() public view {
        for (uint256 s = 0; s < aprBps.length; s++) {
            assertEq(VeraMath.borrowAprBps(s), aprBps[s], _at("borrow apr bps", s));
        }
    }

    function test_supplyApyParity() public view {
        for (uint256 s = 0; s < apyBps.length; s++) {
            assertEq(VeraMath.supplyApyBps(s), apyBps[s], _at("supply apy bps", s));
        }
    }

    /* ---------- trust score, every generated case ---------- */

    function test_trustScoreParity() public view {
        for (uint256 i = 0; i < scoreExpected.length; i++) {
            assertEq(
                VeraMath.trustScore(
                    scoreIdentity[i],
                    scoreHistory[i],
                    scoreRepayment[i],
                    scoreVerified[i] == 1
                ),
                scoreExpected[i],
                _at("trust score case", i)
            );
        }
    }

    function _at(string memory what, uint256 i) private pure returns (string memory) {
        return string.concat(what, " mismatch at index ", vm.toString(i));
    }
}
