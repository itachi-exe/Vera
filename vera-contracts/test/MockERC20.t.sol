// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";

contract MockERC20Test is Test {
    MockERC20 usdc;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    // 1,000,000 USDC at 6dp
    uint256 constant MAX_MINT = 1_000_000e6;

    function setUp() public {
        usdc = new MockERC20("Mock USD Coin", "mUSDC", 6, MAX_MINT);
    }

    function test_metadata() public view {
        assertEq(usdc.name(), "Mock USD Coin");
        assertEq(usdc.symbol(), "mUSDC");
        assertEq(usdc.decimals(), 6);
        assertEq(usdc.totalSupply(), 0);
    }

    function test_mintCreditsRecipientAndSupply() public {
        usdc.mint(alice, 500e6);
        assertEq(usdc.balanceOf(alice), 500e6);
        assertEq(usdc.totalSupply(), 500e6);
    }

    function test_mintRevertsAboveCeiling() public {
        vm.expectRevert(
            abi.encodeWithSelector(MockERC20.MintTooLarge.selector, MAX_MINT + 1, MAX_MINT)
        );
        usdc.mint(alice, MAX_MINT + 1);
    }

    function test_mintRejectsZeroAddress() public {
        vm.expectRevert(MockERC20.ZeroAddress.selector);
        usdc.mint(address(0), 1e6);
    }

    function test_faucetMintsTenPercentToCaller() public {
        vm.prank(alice);
        usdc.faucet();
        assertEq(usdc.balanceOf(alice), MAX_MINT / 10);
    }

    function test_transferMovesBalance() public {
        usdc.mint(alice, 100e6);
        vm.prank(alice);
        usdc.transfer(bob, 40e6);
        assertEq(usdc.balanceOf(alice), 60e6);
        assertEq(usdc.balanceOf(bob), 40e6);
    }

    function test_transferRevertsWhenShort() public {
        usdc.mint(alice, 10e6);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(MockERC20.InsufficientBalance.selector, 10e6, 11e6)
        );
        usdc.transfer(bob, 11e6);
    }

    function test_transferFromSpendsAllowance() public {
        usdc.mint(alice, 100e6);
        vm.prank(alice);
        usdc.approve(bob, 60e6);

        vm.prank(bob);
        usdc.transferFrom(alice, bob, 25e6);

        assertEq(usdc.balanceOf(bob), 25e6);
        assertEq(usdc.allowance(alice, bob), 35e6);
    }

    function test_infiniteAllowanceIsNotDecremented() public {
        usdc.mint(alice, 100e6);
        vm.prank(alice);
        usdc.approve(bob, type(uint256).max);

        vm.prank(bob);
        usdc.transferFrom(alice, bob, 25e6);

        assertEq(usdc.allowance(alice, bob), type(uint256).max);
    }

    function test_transferFromRevertsWithoutAllowance() public {
        usdc.mint(alice, 100e6);
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(MockERC20.InsufficientAllowance.selector, 0, 1e6)
        );
        usdc.transferFrom(alice, bob, 1e6);
    }

    function test_burnReducesSupply() public {
        usdc.mint(alice, 100e6);
        vm.prank(alice);
        usdc.burn(30e6);
        assertEq(usdc.balanceOf(alice), 70e6);
        assertEq(usdc.totalSupply(), 70e6);
    }

    /// Decimals differ per asset in the demo; make sure nothing is hardcoded.
    function test_decimalsAreIndependentPerToken() public {
        MockERC20 wbtc = new MockERC20("Mock Wrapped BTC", "mWBTC", 8, 100e8);
        MockERC20 weth = new MockERC20("Mock Ether", "mETH", 18, 1000e18);
        assertEq(wbtc.decimals(), 8);
        assertEq(weth.decimals(), 18);
    }

    function testFuzz_mintWithinCeilingAlwaysCredits(uint256 amount) public {
        amount = bound(amount, 0, MAX_MINT);
        usdc.mint(alice, amount);
        assertEq(usdc.balanceOf(alice), amount);
        assertEq(usdc.totalSupply(), amount);
    }
}
