// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IVeraOracle
/// @notice Price source for the pool. Returns USD per whole token, 18 decimals.
/// @dev Deliberately per-token rather than per-pair. A pair quote would have to be
///      re-registered for every new market and gives the oracle a place to be
///      internally inconsistent; two USD prices divided at the point of use cannot
///      disagree with themselves.
///
///      Implementations MUST revert rather than return zero or a stale value. The
///      pool treats a missing price as fatal, because the alternative — valuing
///      collateral at zero — would mark every open position liquidatable the moment
///      the feed hiccuped.
interface IVeraOracle {
    /// @notice USD price of one whole `token`, scaled by 1e18.
    /// @dev Reverts if the asset is unknown or the price is stale.
    function getPrice(address token) external view returns (uint256 priceWad);
}
