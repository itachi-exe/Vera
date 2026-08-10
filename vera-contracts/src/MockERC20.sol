// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title MockERC20
/// @notice Minimal ERC-20 for Monad testnet. `mint` is deliberately open so a
///         judge or demo visitor can fund a wallet without asking us for tokens.
/// @dev Testnet only. An open mint on a live network would be worthless money.
contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public immutable decimals;

    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    /// @notice Ceiling on a single mint, so one call cannot make the supply
    ///         figures in the UI meaningless.
    uint256 public immutable maxMint;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    error MintTooLarge(uint256 requested, uint256 max);
    error InsufficientBalance(uint256 have, uint256 need);
    error InsufficientAllowance(uint256 have, uint256 need);
    error ZeroAddress();

    constructor(string memory _name, string memory _symbol, uint8 _decimals, uint256 _maxMint) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
        maxMint = _maxMint;
    }

    /// @notice Open faucet. Anyone may mint up to `maxMint` per call.
    function mint(address to, uint256 amount) external {
        if (to == address(0)) revert ZeroAddress();
        if (amount > maxMint) revert MintTooLarge(amount, maxMint);
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    /// @notice Convenience faucet — mints a sensible demo amount to the caller.
    function faucet() external {
        uint256 amount = maxMint / 10;
        totalSupply += amount;
        balanceOf[msg.sender] += amount;
        emit Transfer(address(0), msg.sender, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        // An infinite approval is not decremented — standard practice, and it
        // keeps the pool's repay path from burning gas on a storage write.
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance(allowed, amount);
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function burn(uint256 amount) external {
        uint256 bal = balanceOf[msg.sender];
        if (bal < amount) revert InsufficientBalance(bal, amount);
        balanceOf[msg.sender] = bal - amount;
        totalSupply -= amount;
        emit Transfer(msg.sender, address(0), amount);
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = balanceOf[from];
        if (bal < amount) revert InsufficientBalance(bal, amount);
        balanceOf[from] = bal - amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
