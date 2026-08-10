// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {VeraPool} from "../src/VeraPool.sol";
import {VeraMath} from "../src/VeraMath.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {MockOracle} from "../src/MockOracle.sol";
import {IVeraOracle} from "../src/IVeraOracle.sol";

/// @notice An oracle that has no price for anything. Stands in for a dead feed.
contract DeadOracle is IVeraOracle {
    error NoPrice(address token);

    function getPrice(address token) external pure returns (uint256) {
        revert NoPrice(token);
    }
}

/// @notice A token that tries to re-enter the pool from inside `transfer`.
/// @dev Records whether the re-entrant call went through, so the test asserts on
///      the attack's own report rather than on a revert string.
contract ReenterToken {
    string public name = "Reenter";
    string public symbol = "RE";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    VeraPool public pool;
    bool public armed;
    bool public reentrySucceeded;
    bool public attempted;

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
    }

    function setPool(VeraPool p) external {
        pool = p;
    }

    function arm() external {
        armed = true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        _maybeReenter();
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        _maybeReenter();
        return true;
    }

    function _maybeReenter() private {
        if (!armed) return;
        armed = false;
        attempted = true;
        // Try to drain by re-entering the withdraw path mid-transfer.
        try pool.withdrawCollateral(1) {
            reentrySucceeded = true;
        } catch {
            reentrySucceeded = false;
        }
    }
}

contract VeraPoolSecurityTest is Test {
    VeraPool pool;
    MockERC20 usdc;
    MockERC20 weth;
    MockOracle oracle;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address keeper = address(0xC4A11E);

    uint256 constant USDC_UNIT = 1e6;
    uint256 constant ETH_UNIT = 1e18;

    function setUp() public {
        usdc = new MockERC20("Mock USD Coin", "mUSDC", 6, 1_000_000 * USDC_UNIT);
        weth = new MockERC20("Mock Ether", "mETH", 18, 1000 * ETH_UNIT);
        oracle = new MockOracle();
        oracle.setPrice(address(weth), 3000e18);
        oracle.setPrice(address(usdc), 1e18);

        pool = new VeraPool(address(weth), address(usdc), address(oracle), 18, 6);

        usdc.mint(alice, 100_000 * USDC_UNIT);
        usdc.mint(keeper, 100_000 * USDC_UNIT);
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

    /* ---------- oracle failure must not mass-liquidate ---------- */

    /// The draft version of this pool returned 0 from its price helper on a failed
    /// call. That valued all collateral at zero, which put every open position below
    /// the liquidation threshold at once. This is the regression test for that.
    function test_deadOracleDoesNotMakeHealthyPositionsLiquidatable() public {
        _openPosition(3 * ETH_UNIT, 5_000 * USDC_UNIT);
        assertGt(pool.healthFactor(bob), VeraMath.WAD);

        pool.setOracle(address(new DeadOracle()));

        // Reading health must fail loudly, not report "unhealthy".
        vm.expectRevert();
        pool.healthFactor(bob);

        // And the liquidation attempt must fail too.
        vm.prank(keeper);
        vm.expectRevert();
        pool.liquidate(bob, 1_000 * USDC_UNIT);

        // Nothing was taken.
        (uint256 coll, uint256 debt,,,,) = pool.positions(bob);
        assertEq(coll, 3 * ETH_UNIT);
        assertEq(debt, 5_000 * USDC_UNIT);
    }

    function test_deadOracleAlsoBlocksNewBorrowing() public {
        _openPosition(3 * ETH_UNIT, 1_000 * USDC_UNIT);
        pool.setOracle(address(new DeadOracle()));

        vm.prank(bob);
        vm.expectRevert();
        pool.borrow(1 * USDC_UNIT);
    }

    function test_unsetPriceRevertsRatherThanReturningZero() public {
        MockOracle fresh = new MockOracle();
        vm.expectRevert(abi.encodeWithSelector(MockOracle.NoPrice.selector, address(weth)));
        fresh.getPrice(address(weth));
    }

    /* ---------- reentrancy ---------- */

    function test_reentrantTokenCannotDrainCollateral() public {
        ReenterToken evil = new ReenterToken();
        MockOracle o = new MockOracle();
        o.setPrice(address(evil), 3000e18);
        o.setPrice(address(usdc), 1e18);

        VeraPool p = new VeraPool(address(evil), address(usdc), address(o), 18, 6);
        evil.setPool(p);
        evil.mint(bob, 10 * ETH_UNIT);

        vm.prank(bob);
        evil.approve(address(p), type(uint256).max);
        vm.prank(bob);
        p.depositCollateral(5 * ETH_UNIT);

        // Withdrawal triggers transfer, which re-enters withdrawCollateral.
        evil.arm();
        vm.prank(bob);
        p.withdrawCollateral(1 * ETH_UNIT);

        assertTrue(evil.attempted(), "the attack should have been attempted");
        assertFalse(evil.reentrySucceeded(), "guard must reject the re-entrant call");

        // Exactly one withdrawal took effect.
        (uint256 coll,,,,,) = p.positions(bob);
        assertEq(coll, 4 * ETH_UNIT);
        assertEq(p.totalCollateral(), 4 * ETH_UNIT);
    }

    /* ---------- compliance is enforced on chain, not only in the UI ---------- */

    function test_revokingComplianceBlocksFurtherBorrowing() public {
        _openPosition(5 * ETH_UNIT, 5_000 * USDC_UNIT);

        pool.setCreditProfile(bob, 680, 800, 700, true, false);

        vm.prank(bob);
        vm.expectRevert(VeraPool.ComplianceBlocked.selector);
        pool.borrow(1 * USDC_UNIT);
    }

    /// Revoking compliance must not strand an existing borrower: they can still
    /// repay and retrieve collateral. A gate that traps capital is a different bug.
    function test_revokedBorrowerCanStillRepayAndExit() public {
        _openPosition(5 * ETH_UNIT, 5_000 * USDC_UNIT);

        uint256 debtBefore = pool.debtOf(bob);
        assertGt(debtBefore, 0, "position should have debt");

        pool.setCreditProfile(bob, 680, 800, 700, true, false);

        // Read the balance first: vm.prank applies to the very next call, so a view
        // in between would consume it and `repay` would run as the test contract.
        uint256 owed = pool.debtOf(bob);
        vm.prank(bob);
        pool.repay(owed);

        (, uint256 debt,,,,) = pool.positions(bob);
        assertEq(debt, 0);

        vm.prank(bob);
        pool.withdrawCollateral(5 * ETH_UNIT);
        assertEq(weth.balanceOf(bob), 100 * ETH_UNIT);
    }

    function test_nonScorerCannotGrantItselfCredit() public {
        vm.prank(bob);
        vm.expectRevert(VeraPool.Unauthorized.selector);
        pool.setCreditProfile(bob, 1000, 1000, 1000, true, true);
    }

    function test_scoreComponentsAboveMaxAreRejected() public {
        vm.expectRevert(abi.encodeWithSelector(VeraPool.ScoreOutOfRange.selector, 1001));
        pool.setCreditProfile(bob, 1001, 0, 0, true, true);
    }

    /* ---------- score downgrade is a live risk signal ---------- */

    function test_downgradeCanMakeAPositionLiquidatable() public {
        _openPosition(3 * ETH_UNIT, 6_000 * USDC_UNIT);
        assertGt(pool.healthFactor(bob), VeraMath.WAD);

        // Attestation lapses: same on-chain history, no identity credit.
        pool.setCreditProfile(bob, 680, 800, 700, false, true);

        assertLt(pool.healthFactor(bob), VeraMath.WAD);

        vm.prank(keeper);
        (uint256 repaid,) = pool.liquidate(bob, 3_000 * USDC_UNIT);
        assertGt(repaid, 0);
    }

    /* ---------- bad debt is reported, not hidden ---------- */

    function test_badDebtIsFlaggedWhenCollateralCannotCoverTheBonus() public {
        _openPosition(2 * ETH_UNIT, 4_000 * USDC_UNIT);

        // Collapse the collateral well below the debt.
        oracle.setPrice(address(weth), 500e18); // 2 ETH = $1000 vs $4000 debt

        vm.prank(keeper);
        vm.recordLogs();
        (, uint256 seized) = pool.liquidate(bob, 2_000 * USDC_UNIT);

        // The seizure is capped by what is actually there.
        assertEq(seized, 2 * ETH_UNIT);

        (uint256 coll, uint256 debt,,,,) = pool.positions(bob);
        assertEq(coll, 0);
        assertGt(debt, 0, "residual debt remains and is visible");
    }

    /* ---------- accounting invariants ---------- */

    function test_poolNeverPaysOutMoreDebtTokenThanItHolds() public {
        _openPosition(5 * ETH_UNIT, 10_000 * USDC_UNIT);

        assertEq(usdc.balanceOf(address(pool)), 40_000 * USDC_UNIT);
        assertEq(pool.availableLiquidity(), 40_000 * USDC_UNIT);

        vm.prank(alice);
        vm.expectRevert(VeraPool.InsufficientLiquidity.selector);
        pool.withdrawSupply(45_000 * USDC_UNIT);
    }

    function test_collateralTotalTracksTheSumOfPositions() public {
        vm.prank(bob);
        pool.depositCollateral(7 * ETH_UNIT);
        vm.prank(bob);
        pool.withdrawCollateral(2 * ETH_UNIT);

        (uint256 coll,,,,,) = pool.positions(bob);
        assertEq(coll, pool.totalCollateral());
        assertEq(weth.balanceOf(address(pool)), pool.totalCollateral());
    }

    function testFuzz_borrowNeverExceedsTheLtvCeiling(uint256 collateral, uint256 draw) public {
        collateral = bound(collateral, 1e15, 50 * ETH_UNIT);
        draw = bound(draw, 1, 200_000 * USDC_UNIT);

        vm.prank(alice);
        pool.supply(100_000 * USDC_UNIT);
        usdc.mint(address(this), 0);

        vm.prank(bob);
        pool.depositCollateral(collateral);
        pool.setCreditProfile(bob, 680, 800, 700, true, true);

        vm.prank(bob);
        try pool.borrow(draw) {
            // If it succeeded, the resulting debt must sit inside the ceiling.
            (uint256 coll, uint256 debt,,,,) = pool.positions(bob);
            uint256 valueWad = (coll * 3000e18) / ETH_UNIT;
            uint256 ceiling = (valueWad * VeraMath.ltvPct(739, true)) / 100;
            uint256 debtValue = (debt * 1e18) / USDC_UNIT;
            assertLe(debtValue, ceiling);
        } catch {
            // Refusing is always an acceptable outcome.
        }
    }

    function testFuzz_healthyPositionsAreNeverLiquidatable(uint256 draw) public {
        vm.prank(alice);
        pool.supply(50_000 * USDC_UNIT);
        vm.prank(bob);
        pool.depositCollateral(5 * ETH_UNIT);
        pool.setCreditProfile(bob, 680, 800, 700, true, true);

        // 5 ETH * 3000 * 71% = 10650 ceiling.
        draw = bound(draw, 1 * USDC_UNIT, 10_000 * USDC_UNIT);
        vm.prank(bob);
        pool.borrow(draw);

        if (pool.healthFactor(bob) >= VeraMath.WAD) {
            vm.prank(keeper);
            vm.expectRevert();
            pool.liquidate(bob, draw);
        }
    }
}
