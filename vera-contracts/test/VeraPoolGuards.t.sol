// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {VeraPool} from "../src/VeraPool.sol";
import {VeraMath} from "../src/VeraMath.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {MockOracle} from "../src/MockOracle.sol";
import {IVeraOracle} from "../src/IVeraOracle.sol";

/// @notice An oracle that answers every query with zero.
/// @dev Distinct from a *dead* feed, which reverts and is already covered in
///      VeraPoolSecurity.t.sol. This one succeeds and lies, which is the harder
///      case: nothing about the call fails, so only an explicit check catches it.
///      {MockOracle} refuses to store a zero price, so the threat has to be
///      modelled with a non-conforming adapter — an owner-replaceable oracle is
///      exactly the place a non-conforming implementation can arrive.
contract ZeroPriceOracle is IVeraOracle {
    function getPrice(address) external pure returns (uint256) {
        return 0;
    }
}

/// @notice Has code, but no `decimals()`.
/// @dev `decimals()` is optional in ERC-20. A token that cannot answer must be
///      accepted on the deployer's word, or the pool could not list one.
contract SilentDecimalsToken {
    function totalSupply() external pure returns (uint256) {
        return 0;
    }
}

/// @notice Answers `decimals()` with a value far wider than `uint8`.
/// @dev The regression guard for narrowing before comparing. `(1 << 160) + 18`
///      truncates to exactly 18, so a `uint8(actual) != declared` check reads
///      this as agreeing with a declared 18 and accepts it.
contract WideDecimalsToken {
    function decimals() external pure returns (uint256) {
        return (uint256(1) << 160) + 18;
    }
}

contract VeraPoolGuardsTest is Test {
    VeraPool pool;
    MockERC20 usdc;
    MockERC20 weth;
    MockOracle oracle;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address keeper = address(0xC4A11E);

    uint256 constant USDC_UNIT = 1e6;
    uint256 constant ETH_UNIT = 1e18;

    /// Score for the (680, 800, 700, verified) profile used throughout.
    uint256 constant BASE_SCORE = 739;

    function setUp() public {
        // Start at a realistic epoch. The staleness checks compare against
        // `block.timestamp`, and at Foundry's default of 1 a 30-day window
        // cannot be stepped back from.
        vm.warp(1_750_000_000);

        usdc = new MockERC20("Mock USD Coin", "mUSDC", 6, 1_000_000 * USDC_UNIT);
        weth = new MockERC20("Mock Ether", "mETH", 18, 1000 * ETH_UNIT);
        oracle = new MockOracle();
        oracle.setPrice(address(weth), 3000e18);
        oracle.setPrice(address(usdc), 1e18);

        pool = new VeraPool(address(weth), address(usdc), address(oracle), 18, 6);

        usdc.mint(alice, 200_000 * USDC_UNIT);
        usdc.mint(keeper, 200_000 * USDC_UNIT);
        usdc.mint(bob, 100_000 * USDC_UNIT);
        weth.mint(bob, 100 * ETH_UNIT);

        vm.prank(alice);
        usdc.approve(address(pool), type(uint256).max);
        vm.prank(keeper);
        usdc.approve(address(pool), type(uint256).max);
        vm.prank(bob);
        weth.approve(address(pool), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(pool), type(uint256).max);
    }

    function _openPosition(uint256 collateral, uint256 debt) private {
        vm.prank(alice);
        pool.supply(50_000 * USDC_UNIT);
        vm.prank(bob);
        pool.depositCollateral(collateral);
        pool.setCreditProfile(bob, 680, 800, 700, true, true);
        vm.prank(bob);
        pool.borrow(debt);
    }

    /* ================================================================
       guard 1 — a zero price is not a price
       ================================================================ */

    function test_zeroPriceOracleCannotValueCollateral() public {
        _openPosition(3 * ETH_UNIT, 5_000 * USDC_UNIT);
        assertGt(pool.healthFactor(bob), VeraMath.WAD);

        pool.setOracle(address(new ZeroPriceOracle()));

        // The failure this prevents: valuing collateral at zero reports every
        // open position as liquidatable. Reverting is the only honest answer.
        vm.expectRevert(abi.encodeWithSelector(VeraPool.NoPrice.selector, address(weth)));
        pool.healthFactor(bob);
    }

    function test_zeroPriceOracleBlocksBorrowAndLiquidate() public {
        _openPosition(3 * ETH_UNIT, 5_000 * USDC_UNIT);
        pool.setOracle(address(new ZeroPriceOracle()));

        // `_requireWithinLTV` values the debt before the collateral, in separate
        // statements, so the token reached first here is fixed.
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(VeraPool.NoPrice.selector, address(usdc)));
        pool.borrow(1 * USDC_UNIT);

        // Without the check this would succeed against collateral valued at
        // nothing, seizing a healthy borrower's deposit.
        //
        // Matched on the selector alone: the health factor passes both
        // valuations as arguments to one call, and Solidity does not promise
        // which is evaluated first. That the call refuses to proceed is the
        // guarantee; which side of the position it noticed first is not.
        vm.prank(keeper);
        vm.expectPartialRevert(VeraPool.NoPrice.selector);
        pool.liquidate(bob, 1_000 * USDC_UNIT);
    }

    /// The guard must not fire on a working feed.
    function test_liveOracleValuesCollateralNormally() public {
        _openPosition(3 * ETH_UNIT, 5_000 * USDC_UNIT);
        assertGt(pool.healthFactor(bob), VeraMath.WAD);
        assertGt(pool.maxBorrow(bob), 0);
    }

    /* ================================================================
       guard 2 — collateral and debt cannot be the same asset
       ================================================================ */

    function test_constructorRejectsSameTokenOnBothSides() public {
        vm.expectRevert(VeraPool.SameToken.selector);
        new VeraPool(address(usdc), address(usdc), address(oracle), 6, 6);
    }

    function test_constructorAcceptsTwoDistinctTokens() public {
        VeraPool fresh = new VeraPool(address(weth), address(usdc), address(oracle), 18, 6);
        assertEq(fresh.collateralToken(), address(weth));
        assertEq(fresh.debtToken(), address(usdc));
    }

    /* ================================================================
       guard 3 — declared decimals must match the token
       ================================================================ */

    function test_constructorRejectsWrongCollateralDecimals() public {
        // weth answers 18. Declaring 6 would value every deposit at a
        // millionth of its size.
        vm.expectRevert(
            abi.encodeWithSelector(VeraPool.DecimalsMismatch.selector, address(weth), 6, 18)
        );
        new VeraPool(address(weth), address(usdc), address(oracle), 6, 6);
    }

    function test_constructorRejectsWrongDebtDecimals() public {
        vm.expectRevert(
            abi.encodeWithSelector(VeraPool.DecimalsMismatch.selector, address(usdc), 18, 6)
        );
        new VeraPool(address(weth), address(usdc), address(oracle), 18, 18);
    }

    /// The comparison is done at full width. Narrowing first would truncate
    /// this token's answer to 18 and accept it.
    function test_constructorRejectsDecimalsWiderThanUint8() public {
        WideDecimalsToken wide = new WideDecimalsToken();
        vm.expectRevert(
            abi.encodeWithSelector(
                VeraPool.DecimalsMismatch.selector, address(wide), 18, (uint256(1) << 160) + 18
            )
        );
        new VeraPool(address(wide), address(usdc), address(oracle), 18, 6);
    }

    /// A token that does not implement `decimals()` is taken on trust — the
    /// check exists to catch a wrong answer, not to require an answer.
    function test_constructorAcceptsTokenWithNoDecimalsFunction() public {
        SilentDecimalsToken silent = new SilentDecimalsToken();
        VeraPool fresh = new VeraPool(address(silent), address(usdc), address(oracle), 18, 6);
        assertEq(fresh.collateralToken(), address(silent));
    }

    /* ================================================================
       guard 4 — the oracle setter cannot brick the pool
       ================================================================ */

    function test_setOracleRejectsCodelessAddress() public {
        vm.expectRevert(VeraPool.NotAContract.selector);
        pool.setOracle(alice);
    }

    function test_setOracleRejectsZeroAddress() public {
        vm.expectRevert(VeraPool.ZeroAddress.selector);
        pool.setOracle(address(0));
    }

    function test_setOracleIsOwnerOnly() public {
        MockOracle replacement = new MockOracle();
        vm.prank(bob);
        vm.expectRevert(VeraPool.Unauthorized.selector);
        pool.setOracle(address(replacement));
    }

    /// Swapping a broken feed for a working one is the pool's safety valve and
    /// must keep working.
    function test_setOracleAcceptsAContract() public {
        MockOracle replacement = new MockOracle();
        replacement.setPrice(address(weth), 2500e18);
        replacement.setPrice(address(usdc), 1e18);

        vm.expectEmit(true, true, false, false);
        emit VeraPool.OracleUpdated(address(oracle), address(replacement));
        pool.setOracle(address(replacement));

        assertEq(address(pool.oracle()), address(replacement));
    }

    /* ================================================================
       guard 5 — a score upgrade cannot rescue an underwater position
       ================================================================ */

    /// Drop the collateral price until bob's position is below 1.0.
    function _sinkBob() private {
        _openPosition(3 * ETH_UNIT, 5_000 * USDC_UNIT);
        oracle.setPrice(address(weth), 2000e18);
        assertLt(pool.healthFactor(bob), VeraMath.WAD);
    }

    function test_scoreUpgradeCannotLiftAnUnderwaterPosition() public {
        _sinkBob();
        uint256 hf = pool.healthFactor(bob);

        // 739 -> 1000 raises the liquidation threshold from 79% to 95%, which
        // would put the position back above 1.0 without a token moving.
        vm.expectRevert(abi.encodeWithSelector(VeraPool.WouldRescueUnhealthy.selector, hf));
        pool.setCreditProfile(bob, 1000, 1000, 1000, true, true);
    }

    /// Liquidation must remain reachable, which is the whole point of the guard.
    function test_underwaterPositionStaysLiquidatableAfterAttemptedRescue() public {
        _sinkBob();

        vm.expectRevert(
            abi.encodeWithSelector(VeraPool.WouldRescueUnhealthy.selector, pool.healthFactor(bob))
        );
        pool.setCreditProfile(bob, 1000, 1000, 1000, true, true);

        vm.prank(keeper);
        (uint256 repaid, uint256 seized) = pool.liquidate(bob, 1_000 * USDC_UNIT);
        assertGt(repaid, 0);
        assertGt(seized, 0);
    }

    /// A score is still allowed to fall out from under an open position.
    function test_scoreDowngradeIsAllowedWhileUnderwater() public {
        _sinkBob();
        uint256 score = pool.setCreditProfile(bob, 100, 100, 100, true, true);
        assertEq(score, 100);
        (,, uint16 stored,,,) = pool.positions(bob);
        assertEq(stored, 100);
    }

    /// The guard is scoped to unhealthy positions, not to upgrades in general.
    function test_scoreUpgradeIsAllowedWhileHealthy() public {
        _openPosition(3 * ETH_UNIT, 5_000 * USDC_UNIT);
        assertGt(pool.healthFactor(bob), VeraMath.WAD);

        uint256 score = pool.setCreditProfile(bob, 1000, 1000, 1000, true, true);
        assertEq(score, 1000);
    }

    /// No debt, no position to rescue — and no oracle read, so this keeps
    /// working while a feed is down.
    function test_debtFreeWalletCanBeUpgradedWithADeadOracle() public {
        pool.setOracle(address(new ZeroPriceOracle()));
        uint256 score = pool.setCreditProfile(alice, 1000, 1000, 1000, true, true);
        assertEq(score, 1000);
    }

    /// Reacting to an outage means writing downgrades during it.
    function test_downgradeWorksWithADeadOracle() public {
        _openPosition(3 * ETH_UNIT, 5_000 * USDC_UNIT);
        pool.setOracle(address(new ZeroPriceOracle()));

        uint256 score = pool.setCreditProfile(bob, 100, 100, 100, true, true);
        assertEq(score, 100);
    }

    /* ================================================================
       guard 6 — a new borrow needs a fresh trust profile
       ================================================================ */

    function test_borrowRevertsOnStaleProfile() public {
        vm.prank(alice);
        pool.supply(50_000 * USDC_UNIT);
        vm.prank(bob);
        pool.depositCollateral(3 * ETH_UNIT);
        pool.setCreditProfile(bob, 680, 800, 700, true, true);

        uint40 writtenAt = pool.profileUpdatedAt(bob);
        assertEq(writtenAt, uint40(block.timestamp));

        skip(30 days + 1);

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(VeraPool.ProfileExpired.selector, writtenAt + 30 days)
        );
        pool.borrow(1_000 * USDC_UNIT);
    }

    /// The boundary is inclusive: expiry is `>` the deadline, not `>=`.
    function test_borrowWorksAtExactlyMaxAge() public {
        vm.prank(alice);
        pool.supply(50_000 * USDC_UNIT);
        vm.prank(bob);
        pool.depositCollateral(3 * ETH_UNIT);
        pool.setCreditProfile(bob, 680, 800, 700, true, true);

        skip(30 days);

        vm.prank(bob);
        pool.borrow(1_000 * USDC_UNIT);
        assertEq(pool.debtOf(bob), 1_000 * USDC_UNIT);
    }

    /// Staleness gates new credit only. A borrower must always be able to get
    /// out of a position, and a liquidator must always be able to close one.
    function test_staleProfileStillAllowsRepayWithdrawAndLiquidate() public {
        _openPosition(3 * ETH_UNIT, 5_000 * USDC_UNIT);
        skip(400 days);

        vm.prank(bob);
        uint256 paid = pool.repay(1_000 * USDC_UNIT);
        assertEq(paid, 1_000 * USDC_UNIT);

        vm.prank(bob);
        pool.withdrawCollateral(1 wei);

        // And the position is still closeable by a third party.
        oracle.setPrice(address(weth), 1500e18);
        assertLt(pool.healthFactor(bob), VeraMath.WAD);
        vm.prank(keeper);
        (uint256 repaid,) = pool.liquidate(bob, 500 * USDC_UNIT);
        assertGt(repaid, 0);
    }

    function test_rewritingProfileClearsStaleness() public {
        vm.prank(alice);
        pool.supply(50_000 * USDC_UNIT);
        vm.prank(bob);
        pool.depositCollateral(3 * ETH_UNIT);
        pool.setCreditProfile(bob, 680, 800, 700, true, true);

        skip(60 days);

        // Same numbers, new timestamp — the scorer re-attesting the wallet.
        pool.setCreditProfile(bob, 680, 800, 700, true, true);
        assertEq(pool.profileUpdatedAt(bob), uint40(block.timestamp));

        vm.prank(bob);
        pool.borrow(1_000 * USDC_UNIT);
        assertEq(pool.debtOf(bob), 1_000 * USDC_UNIT);
    }

    function test_zeroMaxAgeDisablesTheStalenessCheck() public {
        vm.prank(alice);
        pool.supply(50_000 * USDC_UNIT);
        vm.prank(bob);
        pool.depositCollateral(3 * ETH_UNIT);
        pool.setCreditProfile(bob, 680, 800, 700, true, true);

        pool.setProfileMaxAge(0);
        skip(3650 days);

        vm.prank(bob);
        pool.borrow(1_000 * USDC_UNIT);
        assertEq(pool.debtOf(bob), 1_000 * USDC_UNIT);
    }

    function test_setProfileMaxAgeEmitsAndStores() public {
        assertEq(pool.profileMaxAge(), 30 days);

        vm.expectEmit(false, false, false, true);
        emit VeraPool.ProfileMaxAgeUpdated(uint40(30 days), uint40(7 days));
        pool.setProfileMaxAge(uint40(7 days));

        assertEq(pool.profileMaxAge(), 7 days);
    }

    function test_setProfileMaxAgeIsOwnerOnly() public {
        vm.prank(bob);
        vm.expectRevert(VeraPool.Unauthorized.selector);
        pool.setProfileMaxAge(uint40(1 days));
    }

    /* ================================================================
       guard 7 — interest accrued with no shareholders is not a gift
       ================================================================ */

    /// Drain the supply side to zero shares while a borrower still owes, then
    /// let a year of interest accrue against nobody.
    ///
    /// Exiting fully needs more idle liquidity than the pool holds once bob has
    /// drawn, so the shortfall is donated directly. That is not a contrivance:
    /// `availableLiquidity()` reads the token balance, so any stray transfer to
    /// the pool reaches this state on a live deployment.
    function _emptyTheSupplySideWithDebtOutstanding() private {
        _openPosition(3 * ETH_UNIT, 5_000 * USDC_UNIT);

        vm.prank(keeper);
        usdc.transfer(address(pool), 10_000 * USDC_UNIT);

        // Read the balance before arming the prank: an argument expression is
        // evaluated first, so `pool.supplyShares(alice)` inline here would spend
        // the prank on the view call and run the withdrawal as this contract.
        uint256 aliceShares = pool.supplyShares(alice);
        vm.prank(alice);
        pool.withdrawSupply(aliceShares);

        assertEq(pool.totalSupplyShares(), 0);
        assertEq(pool.totalSupplied(), 0);
        assertGt(pool.debtOf(bob), 0);
    }

    function test_interestAccruedWithNoSharesIsNotPaidToTheNextSupplier() public {
        _emptyTheSupplySideWithDebtOutstanding();

        skip(365 days);

        uint256 deposit = 1_000 * USDC_UNIT;
        vm.prank(keeper);
        uint256 shares = pool.supply(deposit);

        // Without the guard, `_accrueGlobal` credits a year of bob's interest
        // to a pool with no shareholders; the next supplier mints 1:1 against
        // it and owns the lot.
        assertEq(shares, deposit);
        assertEq(pool.totalSupplied(), deposit);

        vm.prank(keeper);
        uint256 out = pool.withdrawSupply(shares);
        assertEq(out, deposit, "supplier withdrew more than they put in");
    }

    /// The dropped interest stays with the pool rather than being credited to
    /// anyone, so it is still there to cover the borrower's balance.
    function test_borrowerStillOwesInterestAccruedOverTheEmptyPeriod() public {
        _emptyTheSupplySideWithDebtOutstanding();
        uint256 before = pool.debtOf(bob);

        skip(365 days);

        assertGt(pool.debtOf(bob), before, "borrower stopped accruing");
    }

    /// The guard must not skip accrual when there *are* shareholders.
    function test_interestIsStillCreditedWhenSharesExist() public {
        _openPosition(3 * ETH_UNIT, 5_000 * USDC_UNIT);
        uint256 before = pool.totalSupplied();

        skip(365 days);

        vm.prank(keeper);
        pool.supply(1 * USDC_UNIT);

        // A year of borrow interest, plus the 1 unit just added.
        assertGt(pool.totalSupplied(), before + 1 * USDC_UNIT);
    }

    /// Sanity: the profile the other tests lean on scores what they assume.
    function test_baseProfileScoresAsExpected() public {
        uint256 score = pool.setCreditProfile(bob, 680, 800, 700, true, true);
        assertEq(score, BASE_SCORE);
    }
}
