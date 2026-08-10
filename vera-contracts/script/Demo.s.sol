// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {MockOracle} from "../src/MockOracle.sol";
import {VeraPool} from "../src/VeraPool.sol";
import {VeraMath} from "../src/VeraMath.sol";

/// @notice The product claim, executed on chain: one collateral position, two
///         identity states, and the terms move.
/// @dev Run against a fresh local chain:
///
///        anvil --chain-id 10143 --silent &
///        forge script script/Demo.s.sol:Demo --rpc-url http://127.0.0.1:8545 \
///          --broadcast --private-key $ANVIL_KEY
///
///      The two score inputs are the ones measured on the real Cleanverse sandbox
///      and recorded in VERA.md: an attested wallet scores 218/300 on identity,
///      a wallet with no A-Pass scores 0/300. Everything else is held equal, so
///      the difference on screen is the attestation and nothing else.
contract Demo is Script {
    // 726 is what `identityScoreFrom` returns for the A-Pass the sandbox served on
    // 2026-08-09 (550 base + 250*0.50 tier + 120*0.09 subTier + 0 group + 40 subGroup),
    // pinned in vera-frontend/lib/apass.test.js.
    //
    // A Solidity constant cannot follow a live attestation, and it should not try:
    // the demo has to be reproducible against a fresh chain months from now. What
    // matters is that it is the *same* number the UI quotes, because the claim being
    // proved is that the pool and the screen agree. Cleanverse re-issued this record
    // once already (tier 20 -> 50, identity 681 -> 726) and the constant sat stale at
    // 680 for a while, reading identically on screen because both weight to the same
    // trust score — which is exactly why it went unnoticed. Re-capture when the
    // fixture in apass.test.js moves; the assertions below are relational and pass
    // either way, so nothing here fails to warn you.
    uint256 constant IDENTITY_ATTESTED = 726; // -> 218 of the 300-point identity weight
    uint256 constant HISTORY = 800;
    uint256 constant REPAYMENT = 700;

    uint256 constant GAS_STIPEND = 0.05 ether;

    uint256 constant COLLATERAL = 3e18; // 3 mETH, identical for both wallets
    uint256 constant ETH_USD = 3000e18;

    // Borrower keys are hardcoded so the run is reproducible: a judge gets the
    // same two addresses every time and can look them up on the explorer.
    uint256 constant ATTESTED_KEY = 0xA11CE;
    uint256 constant UNATTESTED_KEY = 0xB0B;

    function run() external {
        address attested = vm.addr(ATTESTED_KEY);
        address unattested = vm.addr(UNATTESTED_KEY);

        vm.startBroadcast();

        MockERC20 usdc = new MockERC20("Mock USD Coin", "mUSDC", 6, 1_000_000e6);
        MockERC20 weth = new MockERC20("Mock Ether", "mETH", 18, 1000e18);

        MockOracle oracle = new MockOracle();
        oracle.setPrice(address(usdc), 1e18);
        oracle.setPrice(address(weth), ETH_USD);

        VeraPool pool = new VeraPool(address(weth), address(usdc), address(oracle), 18, 6);

        // Liquidity so both wallets could actually draw.
        usdc.mint(msg.sender, 100_000e6);
        usdc.approve(address(pool), 100_000e6);
        pool.supply(100_000e6);

        // Identical collateral for both.
        weth.mint(attested, COLLATERAL);
        weth.mint(unattested, COLLATERAL);

        vm.stopBroadcast();

        // Borrower wallets post their own collateral, so they need gas. On a
        // fresh chain they start at zero. This has to be a real transfer, not
        // vm.deal — a cheatcode only rewrites simulation state, so the
        // broadcast would still hit "insufficient funds" on the live chain.
        _gas(attested);
        _gas(unattested);

        _fund(pool, weth, ATTESTED_KEY);
        _fund(pool, weth, UNATTESTED_KEY);

        vm.startBroadcast();
        // The only difference: one holds a live A-Pass, one does not.
        pool.setCreditProfile(attested, IDENTITY_ATTESTED, HISTORY, REPAYMENT, true, true);
        pool.setCreditProfile(unattested, 0, HISTORY, REPAYMENT, false, true);
        vm.stopBroadcast();

        _print(pool, attested, unattested);
    }

    /// @dev Enough for approve + depositCollateral on either chain, no more.
    ///      Sent from the deployer as a broadcast transaction so the funds are
    ///      really there when the borrower's own transactions run.
    function _gas(address to) private {
        vm.startBroadcast();
        payable(to).transfer(GAS_STIPEND);
        vm.stopBroadcast();
    }

    function _fund(VeraPool pool, MockERC20 weth, uint256 privKey) private {
        vm.startBroadcast(privKey);
        weth.approve(address(pool), COLLATERAL);
        pool.depositCollateral(COLLATERAL);
        vm.stopBroadcast();
    }

    function _print(VeraPool pool, address attested, address unattested) private view {
        (
            uint256 sA,
            ,
            ,
            ,
            ,
            uint256 ltvA,
            uint256 liqA,
            uint256 aprA,

        ) = pool.accountSummary(attested);
        (
            uint256 sN,
            ,
            ,
            ,
            ,
            uint256 ltvN,
            uint256 liqN,
            uint256 aprN,

        ) = pool.accountSummary(unattested);

        console.log("");
        console.log("Same wallet shape. Same 3 mETH of collateral. Same on-chain history.");
        console.log("The only difference is a Cleanverse A-Pass.");
        console.log("");
        console.log("                        attested      unattested");
        console.log("  trust score        ", sA, "          ", sN);
        console.log("  LTV %              ", ltvA, "           ", ltvN);
        console.log("  liquidation %      ", liqA, "           ", liqN);
        console.log("  borrow APR bps     ", aprA, "          ", aprN);
        console.log(
            "  max borrow (mUSDC) ",
            pool.maxBorrow(attested) / 1e6,
            "        ",
            pool.maxBorrow(unattested) / 1e6
        );
        console.log("");

        // Stated as an assertion, not just a printout: if this ever stops being
        // true the demo is making a claim the contract does not support.
        require(sA > sN, "attestation must raise the score");
        require(ltvA > ltvN, "attestation must raise borrowing power");
        require(aprA < aprN, "attestation must lower the rate");
        console.log("All three claims hold on chain.");
    }
}
