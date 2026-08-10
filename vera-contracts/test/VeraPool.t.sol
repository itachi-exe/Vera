// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {VeraPool} from "../src/VeraPool.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {MockOracle} from "../src/MockOracle.sol";

contract VeraPoolTest is Test {
    VeraPool pool;
    MockERC20 usdc;
    MockERC20 weth;
    MockOracle oracle;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address charlie = address(0xC4A11E);

    uint256 constant USDC_UNIT = 1e6;
    uint256 constant ETH_UNIT = 1e18;

    function setUp() public {
        usdc = new MockERC20("Mock USD Coin", "mUSDC", 6, 1_000_000 * USDC_UNIT);
        weth = new MockERC20("Mock Ether", "mETH", 18, 1000 * ETH_UNIT);
        oracle = new MockOracle();

        // ETH = $3000, USDC = $1
        oracle.setPrice(address(weth), 3000e18);
        oracle.setPrice(address(usdc), 1e18);

        pool = new VeraPool(address(weth), address(usdc), address(oracle), 18, 6);

        // Fund test wallets
        usdc.mint(alice, 50_000 * USDC_UNIT);
        usdc.mint(bob, 50_000 * USDC_UNIT);
        weth.mint(alice, 10 * ETH_UNIT);
        weth.mint(bob, 10 * ETH_UNIT);
        weth.mint(charlie, 10 * ETH_UNIT);

        // Approvals
        vm.prank(alice);
        usdc.approve(address(pool), type(uint256).max);
        vm.prank(alice);
        weth.approve(address(pool), type(uint256).max);

        vm.prank(bob);
        usdc.approve(address(pool), type(uint256).max);
        vm.prank(bob);
        weth.approve(address(pool), type(uint256).max);

        vm.prank(charlie);
        weth.approve(address(pool), type(uint256).max);
    }

    /* ---------- supply ---------- */

    function test_supplyMintsSharesOneForOne() public {
        vm.prank(alice);
        uint256 shares = pool.supply(10_000 * USDC_UNIT);

        assertEq(shares, 10_000 * USDC_UNIT);
        assertEq(pool.supplyShares(alice), 10_000 * USDC_UNIT);
        assertEq(pool.totalSupplied(), 10_000 * USDC_UNIT);
    }

    /// @dev Driven by real borrower interest rather than by poking storage, so the
    ///      test also proves interest actually reaches the supply side.
    function test_supplyExchangeRateRisesWithInterest() public {
        vm.prank(alice);
        pool.supply(10_000 * USDC_UNIT);

        vm.prank(bob);
        pool.depositCollateral(3 * ETH_UNIT);
        pool.setCreditProfile(bob, 680, 800, 700, true, true);
        vm.prank(bob);
        pool.borrow(5_000 * USDC_UNIT);

        vm.warp(block.timestamp + 365 days);

        // Poke the position so the accrued interest is written to totalSupplied.
        vm.prank(bob);
        pool.repay(1);

        // 5.7% on 5000 for a year = 285 USDC of interest, all of it supplier yield.
        uint256 supplied = pool.totalSupplied();
        assertApproxEqAbs(supplied, 10_285 * USDC_UNIT, 5 * USDC_UNIT);

        // A later supplier now pays more than 1:1 for a share.
        vm.prank(charlie);
        usdc.mint(charlie, 10_285 * USDC_UNIT);
        vm.prank(charlie);
        usdc.approve(address(pool), type(uint256).max);
        vm.prank(charlie);
        uint256 shares = pool.supply(10_285 * USDC_UNIT);

        assertLt(shares, 10_285 * USDC_UNIT);
        // Alice's original shares are now worth more than she put in.
        assertGt(
            (pool.supplyShares(alice) * pool.totalSupplied()) / pool.totalSupplyShares(),
            10_000 * USDC_UNIT
        );
    }

    function test_withdrawSupplyBurnsShares() public {
        vm.prank(alice);
        pool.supply(10_000 * USDC_UNIT);

        vm.prank(alice);
        uint256 amount = pool.withdrawSupply(5_000 * USDC_UNIT);

        assertEq(amount, 5_000 * USDC_UNIT);
        assertEq(pool.supplyShares(alice), 5_000 * USDC_UNIT);
        assertEq(usdc.balanceOf(alice), 45_000 * USDC_UNIT);
    }

    function test_withdrawRevertsWhenInsufficientLiquidity() public {
        vm.prank(alice);
        pool.supply(10_000 * USDC_UNIT);

        // Bob borrows most of it
        vm.prank(bob);
        pool.depositCollateral(3 * ETH_UNIT);
        pool.setCreditProfile(bob, 680, 800, 700, true, true);
        vm.prank(bob);
        pool.borrow(6_000 * USDC_UNIT);

        // Alice tries to withdraw more than the 4000 left idle
        vm.prank(alice);
        vm.expectRevert(VeraPool.InsufficientLiquidity.selector);
        pool.withdrawSupply(5_000 * USDC_UNIT);
    }

    /* ---------- collateral ---------- */

    function test_depositCollateralCreditsPosition() public {
        vm.prank(alice);
        pool.depositCollateral(2 * ETH_UNIT);

        (uint256 coll,,,,, ) = pool.positions(alice);
        assertEq(coll, 2 * ETH_UNIT);
        assertEq(pool.totalCollateral(), 2 * ETH_UNIT);
    }

    function test_withdrawCollateralRevertsIfHealthBreaks() public {
        vm.prank(alice);
        pool.supply(20_000 * USDC_UNIT);

        vm.prank(bob);
        pool.depositCollateral(3 * ETH_UNIT);
        pool.setCreditProfile(bob, 680, 800, 700, true, true);
        vm.prank(bob);
        pool.borrow(6_000 * USDC_UNIT); // 70% LTV of 9000 = 6300, so 6000 is under

        // Withdrawing 0.5 ETH leaves 2.5 * 3000 = 7500, max debt 5250, current 6000 — breaks
        vm.prank(bob);
        vm.expectRevert();
        pool.withdrawCollateral(ETH_UNIT / 2);
    }

    function test_withdrawIdleCollateralSucceeds() public {
        vm.prank(alice);
        pool.depositCollateral(5 * ETH_UNIT);

        vm.prank(alice);
        pool.withdrawCollateral(2 * ETH_UNIT);

        (uint256 coll,,,,, ) = pool.positions(alice);
        assertEq(coll, 3 * ETH_UNIT);
    }

    /* ---------- borrow ---------- */

    function test_borrowRevertsWhenComplianceBlocked() public {
        vm.prank(alice);
        pool.supply(10_000 * USDC_UNIT);

        vm.prank(bob);
        pool.depositCollateral(2 * ETH_UNIT);

        // No credit profile set -> complianceCleared defaults to false
        vm.prank(bob);
        vm.expectRevert(VeraPool.ComplianceBlocked.selector);
        pool.borrow(1000 * USDC_UNIT);
    }

    function test_borrowSucceedsWhenCompliant() public {
        vm.prank(alice);
        pool.supply(10_000 * USDC_UNIT);

        vm.prank(bob);
        pool.depositCollateral(3 * ETH_UNIT);

        pool.setCreditProfile(bob, 680, 800, 700, true, true);

        vm.prank(bob);
        pool.borrow(6_000 * USDC_UNIT);

        (, uint256 debt,,,, ) = pool.positions(bob);
        assertEq(debt, 6_000 * USDC_UNIT);
        assertEq(usdc.balanceOf(bob), 56_000 * USDC_UNIT);
    }

    function test_borrowRevertsWhenExceedsLTV() public {
        vm.prank(alice);
        pool.supply(20_000 * USDC_UNIT);

        vm.prank(bob);
        pool.depositCollateral(3 * ETH_UNIT);
        pool.setCreditProfile(bob, 680, 800, 700, true, true);

        // 3 ETH * 3000 = 9000, score 739 -> LTV 71% -> max 6390
        vm.prank(bob);
        vm.expectRevert();
        pool.borrow(7_000 * USDC_UNIT);
    }

    function test_unverifiedWalletIsCappedAt45Percent() public {
        vm.prank(alice);
        pool.supply(10_000 * USDC_UNIT);

        vm.prank(bob);
        pool.depositCollateral(2 * ETH_UNIT);

        // Same scores but verified=false
        pool.setCreditProfile(bob, 680, 800, 700, false, true);

        // 2 ETH * 3000 = 6000, anon cap 45% -> max 2700
        vm.prank(bob);
        pool.borrow(2_700 * USDC_UNIT);

        (, uint256 debt,,,, ) = pool.positions(bob);
        assertEq(debt, 2_700 * USDC_UNIT);

        // One more dollar fails
        vm.prank(bob);
        vm.expectRevert();
        pool.borrow(1 * USDC_UNIT);
    }

    /* ---------- repay ---------- */

    function test_repayReducesDebt() public {
        vm.prank(alice);
        pool.supply(10_000 * USDC_UNIT);

        vm.prank(bob);
        pool.depositCollateral(3 * ETH_UNIT);
        pool.setCreditProfile(bob, 680, 800, 700, true, true);
        vm.prank(bob);
        pool.borrow(5_000 * USDC_UNIT);

        vm.prank(bob);
        pool.repay(2_000 * USDC_UNIT);

        (, uint256 debt,,,, ) = pool.positions(bob);
        assertEq(debt, 3_000 * USDC_UNIT);
    }

    function test_repayTrimsOverpayment() public {
        vm.prank(alice);
        pool.supply(10_000 * USDC_UNIT);

        vm.prank(bob);
        pool.depositCollateral(3 * ETH_UNIT);
        pool.setCreditProfile(bob, 680, 800, 700, true, true);
        vm.prank(bob);
        pool.borrow(1_000 * USDC_UNIT);

        vm.prank(bob);
        uint256 paid = pool.repay(5_000 * USDC_UNIT);

        assertEq(paid, 1_000 * USDC_UNIT);
        (, uint256 debt,,,, ) = pool.positions(bob);
        assertEq(debt, 0);
    }

    /* ---------- interest ---------- */

    function test_interestAccruesOverTime() public {
        vm.prank(alice);
        pool.supply(10_000 * USDC_UNIT);

        vm.prank(bob);
        pool.depositCollateral(3 * ETH_UNIT);
        pool.setCreditProfile(bob, 680, 800, 700, true, true);
        vm.prank(bob);
        pool.borrow(5_000 * USDC_UNIT);

        uint256 t0 = pool.debtOf(bob);

        vm.warp(block.timestamp + 365 days);

        uint256 t1 = pool.debtOf(bob);
        // APR is 5.7% on score 739, so roughly 285 USDC interest on 5000
        assertGt(t1, t0);
        assertApproxEqAbs(t1, t0 + 285 * USDC_UNIT, 5 * USDC_UNIT);
    }

    function test_accrualHappensBeforeScoreChange() public {
        vm.prank(alice);
        pool.supply(10_000 * USDC_UNIT);

        vm.prank(bob);
        pool.depositCollateral(3 * ETH_UNIT);
        pool.setCreditProfile(bob, 680, 800, 700, true, true);
        vm.prank(bob);
        pool.borrow(5_000 * USDC_UNIT);

        vm.warp(block.timestamp + 180 days);

        // Downgrade score — interest at the old rate is charged first
        uint256 debtBefore = pool.debtOf(bob);
        pool.setCreditProfile(bob, 400, 600, 500, true, true);
        (, uint256 debtAfter,,,, ) = pool.positions(bob);

        assertEq(debtAfter, debtBefore);
    }

    /* ---------- liquidation ---------- */

    function test_liquidationRevertsWhenHealthy() public {
        vm.prank(alice);
        pool.supply(10_000 * USDC_UNIT);

        vm.prank(bob);
        pool.depositCollateral(3 * ETH_UNIT);
        pool.setCreditProfile(bob, 680, 800, 700, true, true);
        vm.prank(bob);
        pool.borrow(5_000 * USDC_UNIT);

        vm.prank(charlie);
        vm.expectRevert();
        pool.liquidate(bob, 1_000 * USDC_UNIT);
    }

    function test_liquidationSucceedsWhenUnderwater() public {
        vm.prank(alice);
        pool.supply(10_000 * USDC_UNIT);

        vm.prank(bob);
        pool.depositCollateral(3 * ETH_UNIT);
        pool.setCreditProfile(bob, 680, 800, 700, true, true);
        vm.prank(bob);
        pool.borrow(6_000 * USDC_UNIT);

        // Crash ETH to $2000
        oracle.setPrice(address(weth), 2000e18);

        // Position now: 3 ETH * 2000 = 6000 collateral, 6000 debt
        // Liquidation threshold 78%, so 6000 * 0.78 = 4680 < 6000 -> underwater

        usdc.mint(charlie, 10_000 * USDC_UNIT);
        vm.prank(charlie);
        usdc.approve(address(pool), type(uint256).max);

        vm.prank(charlie);
        (uint256 repaid, uint256 seized) = pool.liquidate(bob, 3_000 * USDC_UNIT);

        assertEq(repaid, 3_000 * USDC_UNIT);
        // 3000 debt value + 5% bonus = 3150, at $2000/ETH = 1.575 ETH seized
        assertEq(seized, 1575 * ETH_UNIT / 1000);
    }

    function test_closeFactorLimitsOneCall() public {
        vm.prank(alice);
        pool.supply(10_000 * USDC_UNIT);

        vm.prank(bob);
        pool.depositCollateral(2 * ETH_UNIT);
        pool.setCreditProfile(bob, 680, 800, 700, true, true);
        vm.prank(bob);
        pool.borrow(4_000 * USDC_UNIT);

        oracle.setPrice(address(weth), 2100e18);

        usdc.mint(charlie, 10_000 * USDC_UNIT);
        vm.prank(charlie);
        usdc.approve(address(pool), type(uint256).max);

        vm.prank(charlie);
        (uint256 repaid, ) = pool.liquidate(bob, 10_000 * USDC_UNIT);

        // Close factor 50%, so max 2000 repaid despite passing 10k
        assertEq(repaid, 2_000 * USDC_UNIT);
    }

    /* ---------- views ---------- */

    function test_maxBorrowRespectsCompliance() public {
        vm.prank(alice);
        pool.supply(20_000 * USDC_UNIT);

        vm.prank(bob);
        pool.depositCollateral(3 * ETH_UNIT);

        assertEq(pool.maxBorrow(bob), 0); // no profile

        pool.setCreditProfile(bob, 680, 800, 700, true, false); // verified but compliance blocked
        assertEq(pool.maxBorrow(bob), 0);

        pool.setCreditProfile(bob, 680, 800, 700, true, true);
        assertGt(pool.maxBorrow(bob), 0);
    }

    function test_healthFactorReturnsMaxWhenNoDebt() public {
        vm.prank(bob);
        pool.depositCollateral(3 * ETH_UNIT);

        assertEq(pool.healthFactor(bob), type(uint256).max);
    }

    function test_accountSummaryReturnsAllFields() public {
        vm.prank(bob);
        pool.depositCollateral(2 * ETH_UNIT);
        pool.setCreditProfile(bob, 680, 800, 700, true, true);

        (
            uint256 score,
            bool verified,
            bool cleared,
            uint256 coll,
            uint256 debt,
            uint256 ltv,
            uint256 liq,
            uint256 apr,
            uint256 hf
        ) = pool.accountSummary(bob);

        assertEq(score, 739);
        assertTrue(verified);
        assertTrue(cleared);
        assertEq(coll, 2 * ETH_UNIT);
        assertEq(debt, 0);
        assertEq(ltv, 71);
        assertEq(liq, 79);
        assertEq(apr, 570);
        assertEq(hf, type(uint256).max);
    }

    /* ---------- ownership ---------- */

    function test_onlyOwnerCanSetOracle() public {
        MockOracle newOracle = new MockOracle();

        vm.prank(alice);
        vm.expectRevert(VeraPool.Unauthorized.selector);
        pool.setOracle(address(newOracle));

        pool.setOracle(address(newOracle));
        assertEq(address(pool.oracle()), address(newOracle));
    }

    function test_onlyOwnerCanSetScorer() public {
        vm.prank(alice);
        vm.expectRevert(VeraPool.Unauthorized.selector);
        pool.setScorer(alice);

        pool.setScorer(alice);
        assertEq(pool.scorer(), alice);
    }

    function test_onlyScorerCanSetCreditProfile() public {
        vm.prank(alice);
        vm.expectRevert(VeraPool.Unauthorized.selector);
        pool.setCreditProfile(bob, 680, 800, 700, true, true);

        pool.setCreditProfile(bob, 680, 800, 700, true, true);
        (,, uint16 score,,,) = pool.positions(bob);
        assertEq(score, 739);
    }

    function test_transferOwnership() public {
        pool.transferOwnership(alice);
        assertEq(pool.owner(), alice);
    }
}
