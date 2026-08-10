// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {VeraPool} from "../src/VeraPool.sol";

/// @notice Produces the EIP-191 owner signature that POST /validator/register
///         requires, without the deploy key ever leaving Foundry.
///
/// @dev Run with:
///
///        forge script script/SignRegistration.s.sol:SignRegistration --rpc-url monad
///
///      Reads PRIVATE_KEY from the environment — Foundry loads `.env` itself, so
///      the key stays out of argv and out of the process list. That is the whole
///      reason this step is a forge script and not a Node script shelling out to
///      `cast wallet sign --private-key`: anything passed as an argument is
///      world-readable in /proc for the life of the process.
///
///      Cleanverse verifies the signature against `owner()` of the subject
///      address, so this asserts the signer really is the pool owner first. The
///      alternative is a correct-looking request that comes back as
///      "Invalid contract owner signature." with nothing to say which of the two
///      addresses was wrong.
///
///      Signs, verifies, and writes `deployments/registration-<chainid>.json`
///      for scripts/register-pool.mjs to read. The signature authorizes
///      registering this one pool and reveals nothing about the key, but it is
///      still gitignored along with the rest of `deployments/`.
contract SignRegistration is Script {
    /// Cleanverse's slug for this chain. Lowercase, per the signing rule.
    string constant CHAIN_SLUG = "monad";

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address signer = vm.addr(pk);
        address pool = _pool();

        // The pool must expose Ownable-style owner(); VeraPool's `address public
        // owner` does. Reading it also proves the address is a live contract on
        // this RPC rather than a stale entry in the receipt.
        address owner = VeraPool(pool).owner();
        if (owner != signer) {
            console.log("PRIVATE_KEY signs for", signer);
            console.log("pool.owner() is     ", owner);
            revert("signer is not pool.owner(); Cleanverse would reject this signature");
        }

        // Lowercase chain slug + lowercase hex address, no separator.
        string memory message = string.concat(CHAIN_SLUG, _lowerHex(pool));
        bytes memory sig = _sign(pk, message);

        console.log("message  ", message);
        console.log("signer   ", signer);
        console.log("signature", vm.toString(sig));

        _write(pool, owner, message, sig);
    }

    /// @dev Pool address from POOL_ADDRESS when set, else the deploy receipt.
    function _pool() private view returns (address) {
        address fromEnv = vm.envOr("POOL_ADDRESS", address(0));
        if (fromEnv != address(0)) return fromEnv;

        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        if (!vm.exists(path)) {
            revert(string.concat("no ", path, " - deploy first, or set POOL_ADDRESS"));
        }
        return vm.parseJsonAddress(vm.readFile(path), ".pool");
    }

    /// @dev EIP-191 personal_sign over a UTF-8 string.
    function _sign(uint256 pk, string memory message) private pure returns (bytes memory) {
        bytes memory body = bytes(message);
        bytes32 digest = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n", _dec(body.length), body)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        // r ‖ s ‖ v — 65 bytes, v as 27/28, which is what personal_sign yields.
        return abi.encodePacked(r, s, v);
    }

    /// @dev Lowercase 0x-prefixed hex. Written out rather than using
    ///      vm.toString(address), which returns the EIP-55 checksummed form —
    ///      mixed case there produces a different digest and a rejected
    ///      signature, and the request would otherwise look entirely correct.
    function _lowerHex(address a) private pure returns (string memory) {
        bytes memory hexDigits = "0123456789abcdef";
        bytes memory out = new bytes(42);
        out[0] = "0";
        out[1] = "x";
        uint160 value = uint160(a);
        for (uint256 i = 41; i >= 2; i--) {
            out[i] = hexDigits[value & 0xf];
            value >>= 4;
        }
        return string(out);
    }

    /// @dev Decimal string. The EIP-191 prefix needs the byte length in ASCII.
    function _dec(uint256 n) private pure returns (string memory) {
        if (n == 0) return "0";
        uint256 digits;
        for (uint256 m = n; m != 0; m /= 10) digits++;
        bytes memory out = new bytes(digits);
        for (uint256 i = digits; i > 0; i--) {
            out[i - 1] = bytes1(uint8(48 + (n % 10)));
            n /= 10;
        }
        return string(out);
    }

    function _write(address pool, address owner, string memory message, bytes memory sig)
        private
    {
        string memory json = string.concat(
            "{\n",
            '  "chain": "', CHAIN_SLUG, '",\n',
            '  "chainId": ', vm.toString(block.chainid), ",\n",
            '  "contract_address": "', _lowerHex(pool), '",\n',
            '  "owner": "', _lowerHex(owner), '",\n',
            '  "signed_message": "', message, '",\n',
            '  "owner_signature": "', vm.toString(sig), '"\n',
            "}\n"
        );
        string memory path =
            string.concat("deployments/registration-", vm.toString(block.chainid), ".json");
        vm.writeFile(path, json);
        console.log("wrote", path);
    }
}
