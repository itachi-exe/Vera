// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VeraMath} from "./VeraMath.sol";
import {IVeraOracle} from "./IVeraOracle.sol";

/// @title VeraPool
/// @notice Trust-scored lending on Monad. One collateral asset, one debt asset.
/// @dev Credit is priced from a score whose rules live in {VeraMath}, so the terms a
///      wallet is offered can be re-derived by anyone reading this repo. A lending
///      protocol whose creditworthiness rules are unauditable is not trustworthy,
///      which is the whole argument the product makes.
///
///      Single-asset by choice. Multi-asset routing would add a layer of indirection
///      over the part a judge actually needs to read.
///
///      Accounting note, stated rather than hidden: interest is checkpointed per
///      position, so `totalDebt` reflects interest only for positions that have been
///      touched since it accrued. It is therefore a lower bound on what is owed, and
///      utilisation reads slightly low between pokes. Every solvency decision that
///      matters — health, LTV, liquidation — reads the position, which is always
///      accrued to `block.timestamp` first, so no borrower gets a stale rate.
contract VeraPool {
    /* ---------- immutables ---------- */

    /// @notice Collateral asset. Borrowers lock this.
    address public immutable collateralToken;

    /// @notice Debt asset. Suppliers provide it, borrowers draw it.
    address public immutable debtToken;

    /// @dev Cached so valuation never depends on a runtime call to the token.
    uint256 private immutable collateralUnit;
    uint256 private immutable debtUnit;

    /* ---------- storage ---------- */

    /// @notice Price source. Owner-replaceable so the testnet mock can be swapped
    ///         for a real feed without redeploying the pool.
    IVeraOracle public oracle;

    /// @notice Cleanverse validator pool id, once registered via `/validator/register`.
    ///         Zero until then, and the UI says so rather than implying otherwise.
    bytes32 public validatorPoolId;

    address public owner;

    /// @notice The credit oracle: the only address allowed to write trust scores.
    /// @dev Separate from `owner` so the key that publishes scores is not the key
    ///      that can move the oracle address. Same address is fine on testnet; the
    ///      split is what lets them differ later without a migration.
    address public scorer;

    struct Position {
        uint256 collateral; // raw collateral units
        uint256 debt; // raw debt units, accrued to `lastAccrual`
        uint16 score; // 0..1000
        bool verified; // holds a live CVI attestation
        bool complianceCleared; // passed CVA. Default false: no profile, no credit.
        uint40 lastAccrual; // interest checkpoint
    }

    mapping(address => Position) public positions;

    /// @notice When each wallet's trust profile was last written by the scorer.
    /// @dev Kept beside {Position} rather than inside it. The struct is read by
    ///      every test and by `positions()` callers as a fixed 6-tuple; a seventh
    ///      field would be a breaking change to the ABI for a value only `borrow`
    ///      and the UI need.
    mapping(address => uint40) public profileUpdatedAt;

    /// @notice How old a trust profile may be and still support a new borrow.
    /// @dev A score is a claim about a wallet at the moment it was written — the
    ///      CVI attestation behind it can be revoked, and the repayment history it
    ///      priced keeps moving. Nothing on chain notices any of that, so without
    ///      an age limit a profile written once entitles a wallet to credit
    ///      forever, and the scorer's only lever is a downgrade it has to remember
    ///      to send.
    ///
    ///      Gates `borrow` only. Repaying, withdrawing collateral within LTV, and
    ///      being liquidated all keep working on a stale profile: expiry should
    ///      stop new risk, not trap an existing position or block its exit.
    ///
    ///      Owner-settable, and zero disables the check — a pool whose scorer has
    ///      gone quiet should be able to keep lending on the operator's judgement
    ///      rather than halt.
    uint40 public profileMaxAge = 30 days;

    /// @notice Liquidity supplied, including interest accrued so far. Shares are
    ///         claims on this, so the exchange rate drifts up as borrowers pay.
    uint256 public totalSupplied;
    uint256 public totalSupplyShares;
    mapping(address => uint256) public supplyShares;

    uint256 public totalCollateral;
    uint256 public totalDebt;

    /// @notice Sum of `debt * aprBps` across every open position.
    /// @dev The pool prices credit per wallet, so there is no single global rate to
    ///      run a Compound-style index off. This accumulator is the substitute: it is
    ///      the instantaneous interest velocity of the whole book, kept exact by being
    ///      adjusted at every point a position's debt or score moves. Integrating it
    ///      over time gives the same total the per-position checkpoints do, but it can
    ///      be evaluated at any moment — which is what lets the share price rise
    ///      smoothly instead of jumping when a borrower happens to be poked.
    uint256 public totalDebtApr;

    /// @dev Checkpoint for {_accrueGlobal}.
    uint40 public lastGlobalAccrual;

    /// @notice Share of a position's debt one liquidation call may clear.
    uint256 public constant CLOSE_FACTOR_PCT = 50;

    /// @notice Extra collateral a liquidator receives, as a percentage of the debt
    ///         value repaid. This is the incentive to do the work.
    uint256 public constant LIQUIDATION_BONUS_PCT = 5;

    uint256 private constant _UNLOCKED = 1;
    uint256 private constant _LOCKED = 2;
    uint256 private _lock = _UNLOCKED;

    /* ---------- events ---------- */

    event Supplied(address indexed supplier, uint256 amount, uint256 shares);
    event SupplyWithdrawn(address indexed supplier, uint256 amount, uint256 shares);
    event CollateralDeposited(address indexed borrower, uint256 amount);
    event CollateralWithdrawn(address indexed borrower, uint256 amount);
    event Borrowed(address indexed borrower, uint256 amount, uint256 ltvPct, uint256 aprBps);
    event Repaid(address indexed borrower, uint256 amount, uint256 remainingDebt);
    event InterestAccrued(address indexed borrower, uint256 interest);
    event Liquidated(
        address indexed liquidator,
        address indexed borrower,
        uint256 debtRepaid,
        uint256 collateralSeized,
        bool badDebt
    );
    event CreditProfileUpdated(
        address indexed user, uint256 score, bool verified, bool complianceCleared
    );
    event OracleUpdated(address indexed oldOracle, address indexed newOracle);
    event ScorerUpdated(address indexed oldScorer, address indexed newScorer);
    event ProfileMaxAgeUpdated(uint40 oldMaxAge, uint40 newMaxAge);
    event ValidatorPoolRegistered(bytes32 poolId);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    /* ---------- errors ---------- */

    error Unauthorized();
    error ZeroAmount();
    error ZeroAddress();
    error Reentrancy();
    error InsufficientShares();
    error InsufficientLiquidity();
    error InsufficientCollateral();
    error ExceedsLTV(uint256 debt, uint256 maxDebt);
    error ComplianceBlocked();
    error NoDebt();
    error PositionHealthy(uint256 healthFactorWad);
    error TransferFailed();
    error ScoreOutOfRange(uint256 value);
    error NotAContract();
    error CollateralCoversNothing();
    error NoPrice(address token);
    error SameToken();
    error DecimalsMismatch(address token, uint8 declared, uint256 actual);
    error ProfileExpired(uint40 expiredAt);
    error WouldRescueUnhealthy(uint256 healthFactorWad);

    /* ---------- setup ---------- */

    constructor(
        address _collateralToken,
        address _debtToken,
        address _oracle,
        uint8 _collateralDecimals,
        uint8 _debtDecimals
    ) {
        if (_collateralToken == address(0) || _debtToken == address(0) || _oracle == address(0)) {
            revert ZeroAddress();
        }
        // One asset on both sides would let a borrower draw against the very
        // collateral pool their deposit sits in: `availableLiquidity()` reads the
        // token balance, which would then include other people's collateral.
        if (_collateralToken == _debtToken) revert SameToken();
        // A codeless address answers every call with success and empty returndata,
        // which `_push`/`_pull` would read as a transfer that worked. Deploying
        // against one would mint collateral out of nothing, so refuse it here.
        if (
            _collateralToken.code.length == 0 || _debtToken.code.length == 0
                || _oracle.code.length == 0
        ) {
            revert NotAContract();
        }
        // The decimals arguments are a scaling factor on every valuation in this
        // contract, and getting one wrong is not a small error: declaring USDC as
        // 18 instead of 6 values a borrower's debt at a millionth of its size, so
        // $3 of collateral supports the entire pool. The token knows its own
        // answer, so check rather than trust the deployment script — this is a
        // constructor, and paying two calls once is free.
        _requireDecimals(_collateralToken, _collateralDecimals);
        _requireDecimals(_debtToken, _debtDecimals);
        lastGlobalAccrual = uint40(block.timestamp);
        collateralToken = _collateralToken;
        debtToken = _debtToken;
        collateralUnit = 10 ** _collateralDecimals;
        debtUnit = 10 ** _debtDecimals;
        oracle = IVeraOracle(_oracle);
        owner = msg.sender;
        scorer = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier nonReentrant() {
        if (_lock == _LOCKED) revert Reentrancy();
        _lock = _LOCKED;
        _;
        _lock = _UNLOCKED;
    }

    /* ---------- supply side ---------- */

    /// @notice Provide liquidity, receive shares in the pool.
    function supply(uint256 amount) external nonReentrant returns (uint256 shares) {
        if (amount == 0) revert ZeroAmount();
        _accrueGlobal();

        shares = totalSupplyShares == 0 || totalSupplied == 0
            ? amount
            : (amount * totalSupplyShares) / totalSupplied;
        if (shares == 0) revert ZeroAmount();

        supplyShares[msg.sender] += shares;
        totalSupplyShares += shares;
        totalSupplied += amount;

        _pull(debtToken, msg.sender, amount);

        emit Supplied(msg.sender, amount, shares);
    }

    /// @notice Burn shares and withdraw liquidity plus its share of interest.
    /// @dev Bounded by idle liquidity: capital lent out cannot be withdrawn until it
    ///      is repaid. That is the honest constraint of a lending pool, not a bug.
    function withdrawSupply(uint256 shares) external nonReentrant returns (uint256 amount) {
        if (shares == 0) revert ZeroAmount();
        if (supplyShares[msg.sender] < shares) revert InsufficientShares();
        _accrueGlobal();

        amount = (shares * totalSupplied) / totalSupplyShares;
        if (amount > availableLiquidity()) revert InsufficientLiquidity();

        supplyShares[msg.sender] -= shares;
        totalSupplyShares -= shares;
        totalSupplied -= amount;

        _push(debtToken, msg.sender, amount);

        emit SupplyWithdrawn(msg.sender, amount, shares);
    }

    /* ---------- borrow side ---------- */

    function depositCollateral(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        positions[msg.sender].collateral += amount;
        totalCollateral += amount;

        _pull(collateralToken, msg.sender, amount);

        emit CollateralDeposited(msg.sender, amount);
    }

    /// @notice Withdraw collateral, provided what remains still covers the debt.
    function withdrawCollateral(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        Position storage pos = positions[msg.sender];
        _accrue(msg.sender, pos);
        if (pos.collateral < amount) revert InsufficientCollateral();

        pos.collateral -= amount;
        totalCollateral -= amount;

        if (pos.debt != 0) _requireWithinLTV(pos);

        _push(collateralToken, msg.sender, amount);

        emit CollateralWithdrawn(msg.sender, amount);
    }

    /// @notice Draw debt against locked collateral.
    /// @dev The compliance gate is enforced here, not only in the UI. A wallet that
    ///      failed CVA is blocked no matter how good its score is, and a wallet with
    ///      no profile at all is blocked by the same rule — `complianceCleared`
    ///      defaults to false, so silence is a refusal.
    ///
    ///      New credit also requires a profile that is still current; see
    ///      {profileMaxAge}. This is the only entry point that checks it.
    function borrow(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        Position storage pos = positions[msg.sender];
        _accrue(msg.sender, pos);

        if (!pos.complianceCleared) revert ComplianceBlocked();
        uint40 maxAge = profileMaxAge;
        if (maxAge != 0) {
            uint40 writtenAt = profileUpdatedAt[msg.sender];
            // `complianceCleared` already rejects a wallet with no profile, so a
            // zero stamp here means a profile written before this check existed.
            // Those are pre-upgrade positions, not stale ones; the check starts
            // applying to them at their next scorer write.
            //
            // `forge lint` flags the `block.timestamp` comparison. The window is
            // measured in days and the influence a proposer has over the clock is
            // measured in seconds, so nudging it buys nothing here: a profile one
            // second from expiry is worth the same as one a second past it.
            if (writtenAt != 0 && block.timestamp > uint256(writtenAt) + maxAge) {
                revert ProfileExpired(writtenAt + maxAge);
            }
        }
        if (amount > availableLiquidity()) revert InsufficientLiquidity();

        uint256 apr = VeraMath.borrowAprBps(pos.score);
        uint256 before = pos.debt;
        pos.debt = before + amount;
        totalDebt += amount;
        _syncDebtApr(before, apr, pos.debt, apr);

        _requireWithinLTV(pos);

        _push(debtToken, msg.sender, amount);

        emit Borrowed(
            msg.sender,
            amount,
            VeraMath.ltvPct(pos.score, pos.verified),
            VeraMath.borrowAprBps(pos.score)
        );
    }

    /// @notice Repay debt. Interest to this moment is charged first, then the payment
    ///         is applied. Overpayment is trimmed to the balance rather than reverting,
    ///         so "repay everything" does not race the accrual by a block.
    function repay(uint256 amount) external nonReentrant returns (uint256 paid) {
        if (amount == 0) revert ZeroAmount();

        Position storage pos = positions[msg.sender];
        _accrue(msg.sender, pos);
        if (pos.debt == 0) revert NoDebt();

        paid = amount > pos.debt ? pos.debt : amount;

        uint256 apr = VeraMath.borrowAprBps(pos.score);
        uint256 before = pos.debt;
        pos.debt = before - paid;
        totalDebt -= paid;
        _syncDebtApr(before, apr, pos.debt, apr);

        _pull(debtToken, msg.sender, paid);

        emit Repaid(msg.sender, paid, pos.debt);
    }

    /// @notice Clear part of an underwater position and take collateral at a bonus.
    /// @param borrower Position to liquidate.
    /// @param debtAmount Debt to repay, trimmed to the close factor.
    /// @dev Seizure is capped at the collateral actually present. When the cap binds
    ///      the position is underwater past the bonus and the shortfall is bad debt;
    ///      the event says so rather than letting it vanish into the accounting.
    function liquidate(address borrower, uint256 debtAmount)
        external
        nonReentrant
        returns (uint256 repaid, uint256 seized)
    {
        if (debtAmount == 0) revert ZeroAmount();

        Position storage pos = positions[borrower];
        _accrue(borrower, pos);
        if (pos.debt == 0) revert NoDebt();

        uint256 hf = _healthFactorWad(pos);
        if (hf >= VeraMath.WAD) revert PositionHealthy(hf);

        uint256 maxRepay = (pos.debt * CLOSE_FACTOR_PCT) / 100;
        // A position small enough that half of it rounds to zero would otherwise be
        // impossible to liquidate, leaving dust bad debt on the book permanently.
        // Below that floor the whole balance may be cleared in one call.
        if (maxRepay == 0) maxRepay = pos.debt;
        repaid = debtAmount > maxRepay ? maxRepay : debtAmount;
        if (repaid == 0) revert ZeroAmount();

        uint256 seizeValue =
            (_debtValue(repaid) * (100 + LIQUIDATION_BONUS_PCT)) / 100;
        seized = _collateralForValue(seizeValue);

        bool badDebt = seized > pos.collateral;
        if (badDebt) {
            // Not enough collateral to pay the bonus. Seize what is there and scale
            // the repayment down to match, rather than charging the liquidator for
            // collateral that does not exist — an overpaying liquidator is one who
            // never comes back, and the position then never gets cleared at all.
            // The shortfall stays on the borrower's balance and in the event, where
            // it can be seen, instead of being quietly absorbed by the supply side.
            seized = pos.collateral;
            uint256 coveredValue =
                (_collateralValue(seized) * 100) / (100 + LIQUIDATION_BONUS_PCT);
            repaid = _debtTokensForValue(coveredValue);
            if (repaid > pos.debt) repaid = pos.debt;
            // The remaining collateral is worth less than a single unit of the debt
            // token, so there is no amount a liquidator could clear and no seizure
            // that would pay for itself. Stated as its own error rather than a
            // confusing `ZeroAmount`: the caller passed a fine amount, the position
            // is simply past the point where liquidation can do anything. Clearing
            // this needs a write-off against the supply side, which this pool does
            // not do — see the bad-debt note on the contract.
            if (repaid == 0) revert CollateralCoversNothing();
        }

        uint256 apr = VeraMath.borrowAprBps(pos.score);
        uint256 before = pos.debt;
        pos.debt = before - repaid;
        pos.collateral -= seized;
        totalDebt -= repaid;
        totalCollateral -= seized;
        _syncDebtApr(before, apr, pos.debt, apr);

        _pull(debtToken, msg.sender, repaid);
        _push(collateralToken, msg.sender, seized);

        emit Liquidated(msg.sender, borrower, repaid, seized, badDebt);
    }

    /* ---------- credit profile ---------- */

    /// @notice Publish a wallet's trust inputs. Called by the scorer after it has
    ///         read the CVI attestation and run the CVA check.
    /// @dev Interest is charged at the *old* rate before the score moves, so a score
    ///      improvement cannot retroactively discount debt already carried, and a
    ///      downgrade cannot retroactively surcharge it.
    ///
    ///      A downgrade can leave an open position underwater and liquidatable. That
    ///      is intended — it is what makes the score a live risk signal rather than a
    ///      badge collected once at origination. The converse is not allowed: an
    ///      upgrade cannot be used to lift a position that is already underwater
    ///      back above the liquidation line. See {WouldRescueUnhealthy}.
    function setCreditProfile(
        address user,
        uint256 identity,
        uint256 history,
        uint256 repayment,
        bool verified,
        bool complianceCleared
    ) external returns (uint256 score) {
        if (msg.sender != scorer) revert Unauthorized();
        if (identity > VeraMath.SCORE_MAX) revert ScoreOutOfRange(identity);
        if (history > VeraMath.SCORE_MAX) revert ScoreOutOfRange(history);
        if (repayment > VeraMath.SCORE_MAX) revert ScoreOutOfRange(repayment);

        Position storage pos = positions[user];
        _accrue(user, pos);

        uint256 oldApr = VeraMath.borrowAprBps(pos.score);

        score = VeraMath.trustScore(identity, history, repayment, verified);

        // A score is allowed to fall out from under an open position; it is not
        // allowed to be raised to pull one out of liquidation.
        //
        // Raising the score raises the liquidation threshold, which raises the
        // health factor without a token moving. Applied to a position already
        // below 1.0, that reverts the liquidator's transaction with
        // `PositionHealthy` and can be repeated indefinitely — the `scorer` key
        // alone would decide whether a bad position is ever closed, and the loss
        // would land on suppliers. Liquidate or repay first, then upgrade.
        //
        // The oracle is read only on this path. A downgrade, a first profile, and
        // any profile for a debt-free wallet all still work while a feed is down,
        // which matters because those are the writes needed to *react* to an
        // outage.
        if (pos.debt != 0) {
            uint256 newThreshold = VeraMath.liquidationThresholdPct(score, verified);
            if (newThreshold > VeraMath.liquidationThresholdPct(pos.score, pos.verified)) {
                uint256 hf = _healthFactorWad(pos);
                if (hf < VeraMath.WAD) revert WouldRescueUnhealthy(hf);
            }
        }

        pos.score = uint16(score);
        pos.verified = verified;
        pos.complianceCleared = complianceCleared;
        // Trust is a claim about a wallet at a moment, so it is stamped with that
        // moment. `borrow` refuses to act on a stale one; see {profileAge}.
        profileUpdatedAt[user] = uint40(block.timestamp);

        // The rate this position contributes to the book just changed. Interest up to
        // this instant was already charged at the old rate by `_accrue` above.
        _syncDebtApr(pos.debt, oldApr, pos.debt, VeraMath.borrowAprBps(pos.score));

        emit CreditProfileUpdated(user, score, verified, complianceCleared);
    }

    /* ---------- views ---------- */

    /// @notice Debt tokens the pool can actually pay out right now.
    /// @dev Measured from the token balance rather than inferred as
    ///      `totalSupplied - totalDebt`. Those two accumulators no longer move in
    ///      lockstep — the supply side is credited continuously while a borrower's
    ///      debt is written only when their position is touched — so their difference
    ///      overstates the cash on hand between pokes, and the pool would promise
    ///      money it does not hold. Share pricing still uses `totalSupplied`, so a
    ///      donation to this address remains unable to move the exchange rate; it can
    ///      only make more liquidity withdrawable, which harms nobody.
    function availableLiquidity() public view returns (uint256) {
        (bool ok, bytes memory ret) = debtToken.staticcall(
            abi.encodeWithSelector(0x70a08231, address(this)) // balanceOf
        );
        if (!ok || ret.length != 32) revert TransferFailed();
        return abi.decode(ret, (uint256));
    }

    /// @notice Position debt including interest that has accrued but not been written.
    function debtOf(address user) public view returns (uint256) {
        Position storage pos = positions[user];
        return pos.debt + _pendingInterest(pos);
    }

    /// @notice How much more `user` may draw right now, in debt tokens.
    function maxBorrow(address user) external view returns (uint256) {
        Position storage pos = positions[user];
        if (!pos.complianceCleared) return 0;

        uint256 ceiling = VeraMath.maxDebtFor(
            _collateralValue(pos.collateral), VeraMath.ltvPct(pos.score, pos.verified)
        );
        uint256 owed = _debtValue(debtOf(user));
        if (owed >= ceiling) return 0;

        uint256 headroom = _debtTokensForValue(ceiling - owed);
        uint256 liquid = availableLiquidity();
        return headroom < liquid ? headroom : liquid;
    }

    /// @notice Health factor scaled by 1e18. Below 1e18 the position is liquidatable.
    ///         `type(uint256).max` means no debt — nothing to be unhealthy about.
    function healthFactor(address user) external view returns (uint256) {
        return _healthFactorWad(positions[user]);
    }

    /// @notice Everything the UI needs for one wallet, in a single call.
    function accountSummary(address user)
        external
        view
        returns (
            uint256 score,
            bool verified,
            bool complianceCleared,
            uint256 collateral,
            uint256 debt,
            uint256 ltv,
            uint256 liquidationThreshold,
            uint256 aprBps,
            uint256 hfWad
        )
    {
        Position storage pos = positions[user];
        score = pos.score;
        verified = pos.verified;
        complianceCleared = pos.complianceCleared;
        collateral = pos.collateral;
        debt = debtOf(user);
        ltv = VeraMath.ltvPct(pos.score, pos.verified);
        liquidationThreshold = VeraMath.liquidationThresholdPct(pos.score, pos.verified);
        aprBps = VeraMath.borrowAprBps(pos.score);
        hfWad = _healthFactorWad(pos);
    }

    function borrowAprBps(uint256 score) external pure returns (uint256) {
        return VeraMath.borrowAprBps(score);
    }

    function supplyApyBps(uint256 score) external pure returns (uint256) {
        return VeraMath.supplyApyBps(score);
    }

    /* ---------- owner ---------- */

    /// @dev The constructor rejects a codeless oracle; so does this, for the same
    ///      reason. Without the check the pool's one safety valve — swapping a
    ///      broken feed — is also the way to brick it, since every valuation would
    ///      then revert on a call to an address with no code.
    function setOracle(address newOracle) external onlyOwner {
        if (newOracle == address(0)) revert ZeroAddress();
        if (newOracle.code.length == 0) revert NotAContract();
        emit OracleUpdated(address(oracle), newOracle);
        oracle = IVeraOracle(newOracle);
    }

    /// @notice Set how stale a trust profile may be and still support a new borrow.
    /// @param newMaxAge Seconds. Zero disables the check; see {profileMaxAge}.
    function setProfileMaxAge(uint40 newMaxAge) external onlyOwner {
        emit ProfileMaxAgeUpdated(profileMaxAge, newMaxAge);
        profileMaxAge = newMaxAge;
    }

    function setScorer(address newScorer) external onlyOwner {
        if (newScorer == address(0)) revert ZeroAddress();
        emit ScorerUpdated(scorer, newScorer);
        scorer = newScorer;
    }

    /// @notice Record the Cleanverse validator pool id assigned at registration.
    function setValidatorPoolId(bytes32 poolId) external onlyOwner {
        validatorPoolId = poolId;
        emit ValidatorPoolRegistered(poolId);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /* ---------- internals: interest ---------- */

    function _pendingInterest(Position storage pos) private view returns (uint256) {
        if (pos.debt == 0 || pos.lastAccrual == 0) return 0;
        uint256 elapsed = block.timestamp - pos.lastAccrual;
        if (elapsed == 0) return 0;
        // Simple interest between checkpoints. Compounding happens implicitly each
        // time a position is touched, which is the same model Compound v2 used.
        return (pos.debt * VeraMath.borrowAprBps(pos.score) * elapsed) / (365 days * VeraMath.BPS);
    }

    /// @dev Interest the whole book has earned since the last global checkpoint.
    function _pendingGlobalInterest() private view returns (uint256) {
        if (totalDebtApr == 0) return 0;
        uint256 elapsed = block.timestamp - lastGlobalAccrual;
        if (elapsed == 0) return 0;
        return (totalDebtApr * elapsed) / (365 days * VeraMath.BPS);
    }

    /// @notice Credit the supply side with interest earned up to now.
    /// @dev Called before anything reads or writes the share price. Without this,
    ///      `totalSupplied` would only move when an individual borrower happened to
    ///      be poked, and a wallet could supply immediately before that poke and
    ///      withdraw immediately after — collecting interest earned over a period it
    ///      was not in the pool for. Suppliers are now paid for elapsed time, which
    ///      is the thing they actually provided.
    function _accrueGlobal() private {
        uint256 interest = _pendingGlobalInterest();
        lastGlobalAccrual = uint40(block.timestamp);
        if (interest == 0) return;
        // Interest with no shareholders to receive it. `totalSupplied` would still
        // grow, and because `supply` mints 1:1 whenever `totalSupplyShares == 0`,
        // the next supplier would receive the whole accrued balance on top of
        // their own deposit — a gift funded by a borrower's payments. Advancing
        // the checkpoint without crediting drops it instead, which leaves it with
        // the pool where it can only be withdrawn by whoever is owed it.
        if (totalSupplyShares == 0) return;
        totalSupplied += interest;
    }

    /// @dev Keeps {totalDebtApr} equal to the sum of `debt * aprBps` over open
    ///      positions. Call with the position's contribution before a change, then
    ///      again after — never skip one half, or the accumulator drifts and the
    ///      supply side is paid the wrong amount forever.
    function _syncDebtApr(uint256 oldDebt, uint256 oldApr, uint256 newDebt, uint256 newApr)
        private
    {
        totalDebtApr = totalDebtApr - (oldDebt * oldApr) + (newDebt * newApr);
    }

    function _accrue(address user, Position storage pos) private {
        _accrueGlobal();

        uint256 interest = _pendingInterest(pos);
        pos.lastAccrual = uint40(block.timestamp);
        if (interest == 0) return;

        uint256 apr = VeraMath.borrowAprBps(pos.score);
        uint256 before = pos.debt;

        pos.debt = before + interest;
        totalDebt += interest;
        // The supply side was already credited by `_accrueGlobal`; adding it again
        // here would pay the interest out twice. Compounding the borrower's own
        // balance is what this write is for.
        _syncDebtApr(before, apr, pos.debt, apr);

        emit InterestAccrued(user, interest);
    }

    /* ---------- internals: valuation ---------- */

    /// @dev The one place a price enters this contract.
    ///
    ///      {IVeraOracle} says an implementation must revert rather than return
    ///      zero, and {MockOracle} does — but a comment in an interface is not an
    ///      invariant, it is a request. The pool has to enforce it, because the
    ///      oracle is owner-replaceable and the failure is silent in both
    ///      directions: a zero debt price makes every borrow pass the LTV check
    ///      against a debt valued at nothing, and a zero collateral price marks
    ///      every open position liquidatable at once.
    ///
    ///      Two of the four call sites divide by the price and would panic on
    ///      zero. The two that multiply would not. One helper, so the answer does
    ///      not depend on which arithmetic a call site happens to use.
    function _price(address token) private view returns (uint256 p) {
        p = oracle.getPrice(token);
        if (p == 0) revert NoPrice(token);
    }

    /// @dev USD value, 18 decimals. Reverts if the oracle has no price — see
    ///      {IVeraOracle}. Valuing collateral at zero on a feed failure would
    ///      liquidate every open position at once.
    function _collateralValue(uint256 amount) private view returns (uint256) {
        if (amount == 0) return 0;
        return (amount * _price(collateralToken)) / collateralUnit;
    }

    function _debtValue(uint256 amount) private view returns (uint256) {
        if (amount == 0) return 0;
        return (amount * _price(debtToken)) / debtUnit;
    }

    function _collateralForValue(uint256 valueWad) private view returns (uint256) {
        return (valueWad * collateralUnit) / _price(collateralToken);
    }

    function _debtTokensForValue(uint256 valueWad) private view returns (uint256) {
        return (valueWad * debtUnit) / _price(debtToken);
    }

    function _healthFactorWad(Position storage pos) private view returns (uint256) {
        uint256 owed = pos.debt + _pendingInterest(pos);
        if (owed == 0) return type(uint256).max;
        return VeraMath.healthFactorWad(
            _collateralValue(pos.collateral),
            _debtValue(owed),
            VeraMath.liquidationThresholdPct(pos.score, pos.verified)
        );
    }

    function _requireWithinLTV(Position storage pos) private view {
        uint256 owed = _debtValue(pos.debt);
        uint256 ceiling = VeraMath.maxDebtFor(
            _collateralValue(pos.collateral), VeraMath.ltvPct(pos.score, pos.verified)
        );
        if (owed > ceiling) revert ExceedsLTV(owed, ceiling);
    }

    /* ---------- internals: transfers ---------- */

    /// @dev Tolerates tokens that return nothing as well as tokens that return a bool.
    ///      Anything else — a short or oversized answer — is a token this pool does
    ///      not understand, so it is treated as a failed transfer. Decoding it blind
    ///      would abort with a bare panic instead of a named error.
    function _ok(bool ok, bytes memory ret) private pure returns (bool) {
        if (!ok) return false;
        if (ret.length == 0) return true;
        if (ret.length != 32) return false;
        return abi.decode(ret, (bool));
    }

    function _push(address token, address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok, bytes memory ret) =
            token.call(abi.encodeWithSelector(0xa9059cbb, to, amount)); // transfer
        if (!_ok(ok, ret)) revert TransferFailed();
    }

    function _pull(address token, address from, uint256 amount) private {
        if (amount == 0) return;
        (bool ok, bytes memory ret) =
            token.call(abi.encodeWithSelector(0x23b872dd, from, address(this), amount)); // transferFrom
        if (!_ok(ok, ret)) revert TransferFailed();
    }

    /// @dev Constructor-only: confirm the token agrees with the decimals it was
    ///      deployed against.
    ///
    ///      `decimals()` is optional in ERC-20 and some real tokens omit it, so a
    ///      token that does not answer is accepted on the deployer's word — the
    ///      check exists to catch a wrong answer, not to require an answer. What it
    ///      will not accept is a token that answers and disagrees, because that is
    ///      a deployment typo and every valuation in this contract is scaled by it.
    function _requireDecimals(address token, uint8 declared) private view {
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSelector(0x313ce567)); // decimals()
        if (!ok || ret.length != 32) return;
        // Decoded wide and compared wide. A token answering 2**160 is as wrong as
        // one answering 18 when 6 was declared, and narrowing first would truncate
        // the first case into whatever it happens to be mod 256 — possibly into
        // agreement.
        uint256 actual = abi.decode(ret, (uint256));
        if (actual != declared) revert DecimalsMismatch(token, declared, actual);
    }
}
