// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IVeraOracle} from "./IVeraOracle.sol";

/// @title MockOracle
/// @notice Owner-set prices for Monad testnet.
/// @dev Testnet only. Real deployments point the pool at Pyth or a TWAP. This
///      exists so the demo can move a price and show a liquidation actually
///      happening, which a live feed will not do on command.
///
///      It still enforces the interface's central rule: an unset price reverts.
///      Returning zero here would be the easy shortcut and would hand every
///      position to the liquidators.
contract MockOracle is IVeraOracle {
    address public owner;

    mapping(address => uint256) private _priceWad;

    event PriceSet(address indexed token, uint256 priceWad);
    event OwnerChanged(address indexed oldOwner, address indexed newOwner);

    error Unauthorized();
    error NoPrice(address token);
    error ZeroAddress();

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    /// @inheritdoc IVeraOracle
    function getPrice(address token) external view returns (uint256) {
        uint256 p = _priceWad[token];
        if (p == 0) revert NoPrice(token);
        return p;
    }

    /// @notice Set the USD price of one whole `token`, scaled by 1e18.
    function setPrice(address token, uint256 priceWad) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        if (priceWad == 0) revert NoPrice(token);
        _priceWad[token] = priceWad;
        emit PriceSet(token, priceWad);
    }

    /// @notice Set several prices at once, so a demo script is one transaction.
    function setPrices(address[] calldata tokens, uint256[] calldata pricesWad) external onlyOwner {
        if (tokens.length != pricesWad.length) revert NoPrice(address(0));
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == address(0)) revert ZeroAddress();
            if (pricesWad[i] == 0) revert NoPrice(tokens[i]);
            _priceWad[tokens[i]] = pricesWad[i];
            emit PriceSet(tokens[i], pricesWad[i]);
        }
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnerChanged(owner, newOwner);
        owner = newOwner;
    }
}
