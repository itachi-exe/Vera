// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {MockOracle} from "../src/MockOracle.sol";
import {VeraPool} from "../src/VeraPool.sol";

/// @notice Deploys the Vera demo stack to Monad testnet.
/// @dev Run with:
///
///        forge script script/Deploy.s.sol:Deploy \
///          --rpc-url monad --broadcast --private-key $PRIVATE_KEY
///
///      Writes `deployments/<chainid>.json` so the frontend and the Cleanverse
///      registration step read addresses from a file rather than from a paste.
///
///      Testnet only. The mock tokens have an open mint and the oracle price is
///      owner-set; both are here so a judge can fund a wallet and watch a
///      liquidation on demand, and neither belongs on a live network.
contract Deploy is Script {
    // Prices in USD, 18 decimals.
    uint256 constant ETH_USD = 3000e18;
    uint256 constant BTC_USD = 62_000e18;
    uint256 constant USDC_USD = 1e18;

    function run() external {
        vm.startBroadcast();

        MockERC20 usdc = new MockERC20("Mock USD Coin", "mUSDC", 6, 1_000_000e6);
        MockERC20 weth = new MockERC20("Mock Ether", "mETH", 18, 1000e18);
        MockERC20 wbtc = new MockERC20("Mock Wrapped BTC", "mWBTC", 8, 100e8);

        MockOracle oracle = new MockOracle();
        address[] memory tokens = new address[](3);
        uint256[] memory prices = new uint256[](3);
        tokens[0] = address(usdc);
        prices[0] = USDC_USD;
        tokens[1] = address(weth);
        prices[1] = ETH_USD;
        tokens[2] = address(wbtc);
        prices[2] = BTC_USD;
        oracle.setPrices(tokens, prices);

        // The headline market: post mETH, borrow mUSDC.
        VeraPool pool = new VeraPool(address(weth), address(usdc), address(oracle), 18, 6);

        // Seed the pool so a visitor can borrow immediately instead of first
        // having to supply against themselves.
        uint256 seed = 500_000e6;
        usdc.mint(msg.sender, seed);
        usdc.approve(address(pool), seed);
        pool.supply(seed);

        vm.stopBroadcast();

        _report(address(usdc), address(weth), address(wbtc), address(oracle), address(pool), seed);
        _write(address(usdc), address(weth), address(wbtc), address(oracle), address(pool));
    }

    function _report(
        address usdc,
        address weth,
        address wbtc,
        address oracle,
        address pool,
        uint256 seed
    ) private view {
        console.log("");
        console.log("Vera deployed to chain", block.chainid);
        console.log("  mUSDC    ", usdc);
        console.log("  mETH     ", weth);
        console.log("  mWBTC    ", wbtc);
        console.log("  oracle   ", oracle);
        console.log("  pool     ", pool);
        console.log("  seeded   ", seed / 1e6, "mUSDC");
        console.log("");
        console.log("Next: register the pool as a Cleanverse compliance pool");
        console.log("  POST /validator/register with an EIP-191 signature from the owner,");
        console.log("  then call pool.setValidatorPoolId(<returned id>) and set");
        console.log("  VERA_POOL_ADDRESS in .env so the CVA route stops reporting");
        console.log("  the on-chain layer as unchecked.");
    }

    /// @dev Addresses only. A deploy receipt must never carry key material.
    ///
    ///      Written to two places on purpose:
    ///
    ///        vera-contracts/deployments/   canonical receipt, read by the registration step
    ///        vera-frontend/public/deployments/  served at /deployments/<chainid>.json, which
    ///                                 is the exact path vera-frontend/lib/wallet.js fetches
    ///
    ///      A copy step that lives outside the deploy is a copy step that gets
    ///      forgotten, and the symptom — a frontend that 404s and silently falls
    ///      back to demo numbers against a pool that really is deployed — looks
    ///      like a UI bug rather than a missing file. One command, both files.
    function _write(address usdc, address weth, address wbtc, address oracle, address pool)
        private
    {
        string memory chain = vm.toString(block.chainid);

        string memory json = string.concat(
            "{\n",
            '  "chainId": ', chain, ",\n",
            '  "collateralToken": "', vm.toString(weth), '",\n',
            '  "debtToken": "', vm.toString(usdc), '",\n',
            '  "extraToken": "', vm.toString(wbtc), '",\n',
            '  "oracle": "', vm.toString(oracle), '",\n',
            '  "pool": "', vm.toString(pool), '",\n',
            '  "validatorPoolId": null\n',
            "}\n"
        );

        _writeTo("deployments", chain, json);
        _writeTo("../vera-frontend/public/deployments", chain, json);
    }

    function _writeTo(string memory dir, string memory chain, string memory json) private {
        if (!vm.exists(dir)) vm.createDir(dir, true);
        string memory path = string.concat(dir, "/", chain, ".json");
        vm.writeFile(path, json);
        console.log("wrote", path);
    }
}
