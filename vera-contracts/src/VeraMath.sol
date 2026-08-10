// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title VeraMath
/// @notice The protocol's credit rules, on chain and readable.
/// @dev Every function here is the integer mirror of `vera-frontend/lib/vera.js`. That file
///      is what the UI quotes; this library is what the pool enforces. They must
///      not diverge, so the numbers are derived the same way and the test suite
///      pins them against values measured on the real Cleanverse sandbox.
///
///      JS rounds APR and APY to one decimal place of a percent. That is 10 bps
///      of granularity, so the integer path quantises to 10 bps too rather than
///      being "more precise" and disagreeing with the quote a borrower was shown.
library VeraMath {
    uint256 internal constant BPS = 10_000;
    uint256 internal constant SCORE_MAX = 1000;

    /// Score component weights in bps. Published, and they must sum to BPS.
    uint256 internal constant W_IDENTITY = 3_000;
    uint256 internal constant W_HISTORY = 4_500;
    uint256 internal constant W_REPAYMENT = 2_500;

    /// Loan-to-value floor, and the ceiling for a wallet with no CVI attestation.
    uint256 internal constant MIN_LTV_PCT = 20;
    uint256 internal constant ANON_LTV_CAP_PCT = 45;
    uint256 internal constant MAX_LTV_PCT = 90;

    /// Liquidation threshold sits this far above LTV, and never above the cap.
    uint256 internal constant LIQ_BUFFER_PCT = 8;
    uint256 internal constant MAX_LIQ_THRESHOLD_PCT = 95;

    uint256 internal constant MIN_BORROW_APR_BPS = 350;
    uint256 internal constant MAX_BORROW_APR_BPS = 1_200;
    uint256 internal constant MIN_SUPPLY_APY_BPS = 100;
    uint256 internal constant MAX_SUPPLY_APY_BPS = 1_000;

    uint256 internal constant WAD = 1e18;

    /// @notice Weighted trust score, 0..1000.
    /// @dev Without a live attestation the identity component contributes nothing.
    ///      That is the entire argument for verifying, so it is not a soft penalty.
    function trustScore(uint256 identity, uint256 history, uint256 repayment, bool verified)
        internal
        pure
        returns (uint256)
    {
        uint256 id = verified ? _min(identity, SCORE_MAX) : 0;
        uint256 sum = W_IDENTITY * id + W_HISTORY * _min(history, SCORE_MAX)
            + W_REPAYMENT * _min(repayment, SCORE_MAX);
        // +BPS/2 rounds half up, matching Math.round on the weighted sum.
        return _min((sum + BPS / 2) / BPS, SCORE_MAX);
    }

    /// @notice Loan-to-value ceiling for this score, in whole percent.
    /// @dev An unverified wallet is capped however good its on-chain history is.
    function ltvPct(uint256 score, bool verified) internal pure returns (uint256) {
        uint256 earned = (score * 96 + 500) / 1000; // round(score * 0.096)
        uint256 cap = verified ? MAX_LTV_PCT : ANON_LTV_CAP_PCT;
        return _clamp(earned, MIN_LTV_PCT, cap);
    }

    /// @notice Liquidation threshold, in whole percent.
    function liquidationThresholdPct(uint256 score, bool verified) internal pure returns (uint256) {
        return _min(ltvPct(score, verified) + LIQ_BUFFER_PCT, MAX_LIQ_THRESHOLD_PCT);
    }

    /// @notice Borrow APR in bps, quantised to 10 bps. A better score borrows cheaper.
    /// @dev percent = 10.6 - score * 0.00665. Held in thousandths of a bp so the
    ///      rounding step is exact rather than an artefact of integer division.
    function borrowAprBps(uint256 score) internal pure returns (uint256) {
        uint256 s = _min(score, SCORE_MAX);
        uint256 milliBps = 1_060_000 - s * 665; // s <= 1000, so this cannot underflow
        uint256 bps = ((milliBps + 5_000) / 10_000) * 10;
        return _clamp(bps, MIN_BORROW_APR_BPS, MAX_BORROW_APR_BPS);
    }

    /// @notice Supply APY in bps, quantised to 10 bps. Tracks borrow demand.
    /// @dev Derived from the already-rounded borrow APR, exactly as the UI does,
    ///      so a supplier and a borrower never read two different spreads.
    function supplyApyBps(uint256 score) internal pure returns (uint256) {
        uint256 milliBps = borrowAprBps(score) * 790; // * 0.79, scaled by 1000
        uint256 bps = ((milliBps + 5_000) / 10_000) * 10;
        return _clamp(bps, MIN_SUPPLY_APY_BPS, MAX_SUPPLY_APY_BPS);
    }

    /// @notice Health factor, scaled by 1e18. Below 1e18 the position is liquidatable.
    /// @dev Returns max uint when there is no debt — nothing to be unhealthy about.
    function healthFactorWad(uint256 collateralUsd, uint256 debtUsd, uint256 thresholdPct)
        internal
        pure
        returns (uint256)
    {
        if (debtUsd == 0) return type(uint256).max;
        return (collateralUsd * thresholdPct * WAD) / (100 * debtUsd);
    }

    /// @notice Largest debt this collateral supports at `ltvPct`, same units in and out.
    function maxDebtFor(uint256 collateralUsd, uint256 ltv) internal pure returns (uint256) {
        return (collateralUsd * ltv) / 100;
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }

    function _clamp(uint256 n, uint256 lo, uint256 hi) private pure returns (uint256) {
        if (n < lo) return lo;
        return n > hi ? hi : n;
    }
}
