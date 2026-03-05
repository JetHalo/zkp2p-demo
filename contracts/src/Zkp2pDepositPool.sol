// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Minimal} from "./interfaces/IERC20Minimal.sol";

interface IAggregationGateway {
    function verifyProofAggregation(
        uint256 domainId,
        uint256 aggregationId,
        bytes32 leaf,
        bytes32[] calldata merklePath,
        uint256 leafCount,
        uint256 index
    ) external view returns (bool);
}

contract Zkp2pDepositPool {
    error ZeroAddress();
    error InvalidAmount();
    error InvalidSeller();
    error InvalidDeadline();
    error IntentAlreadyExists();
    error IntentNotReserved();
    error IntentAlreadyReleased();
    error IntentExpired();
    error IntentNotExpired();
    error IntentAlreadyCancelled();
    error NullifierMismatch();
    error NullifierAlreadyUsed();
    error IntentHashMismatch();
    error VerificationFailed();
    error InsufficientAvailableBalance();
    error SellerDepositTooLow();
    error TransferFailed();
    error OnlyIntentBuyer();

    struct Intent {
        address seller;
        address buyer;
        uint256 amount;
        uint256 deadline;
        bool reserved;
        bool released;
        bool cancelled;
        bytes32 nullifierHash;
        bytes32 intentHash;
    }

    IERC20Minimal public immutable token;
    IAggregationGateway public immutable gateway;

    uint256 public totalDeposited;
    uint256 public availableBalance;
    uint256 public reservedBalance;

    mapping(address => uint256) public sellerDeposits;
    mapping(address => uint256) public sellerReserved;
    mapping(bytes32 => Intent) public intents;
    mapping(bytes32 => bool) public nullifierUsed;

    event Deposited(address indexed seller, uint256 amount);
    event IntentReserved(
        bytes32 indexed intentId,
        address indexed seller,
        address indexed buyer,
        uint256 amount,
        uint256 deadline,
        bytes32 nullifierHash,
        bytes32 intentHash
    );
    event Released(bytes32 indexed intentId, address indexed buyer, uint256 amount, bytes32 nullifierHash);
    event IntentCancelled(bytes32 indexed intentId, address indexed seller, uint256 amount);
    event Withdrawn(address indexed seller, uint256 amount);

    constructor(address token_, address gateway_) {
        if (token_ == address(0) || gateway_ == address(0)) revert ZeroAddress();
        token = IERC20Minimal(token_);
        gateway = IAggregationGateway(gateway_);
    }

    function deposit(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();

        bool ok = token.transferFrom(msg.sender, address(this), amount);
        if (!ok) revert TransferFailed();

        sellerDeposits[msg.sender] += amount;
        totalDeposited += amount;
        availableBalance += amount;

        emit Deposited(msg.sender, amount);
    }

    function createIntent(
        bytes32 intentId,
        address seller,
        uint256 amount,
        uint256 deadline,
        bytes32 nullifierHash,
        bytes32 intentHash
    )
        external
    {
        bytes32[] memory cleanupIntentIds = new bytes32[](0);
        _createIntent(intentId, seller, amount, deadline, nullifierHash, intentHash, cleanupIntentIds);
    }

    function createIntent(
        bytes32 intentId,
        address seller,
        uint256 amount,
        uint256 deadline,
        bytes32 nullifierHash,
        bytes32 intentHash,
        bytes32[] calldata cleanupIntentIds
    )
        external
    {
        _createIntent(intentId, seller, amount, deadline, nullifierHash, intentHash, cleanupIntentIds);
    }

    function _createIntent(
        bytes32 intentId,
        address seller,
        uint256 amount,
        uint256 deadline,
        bytes32 nullifierHash,
        bytes32 intentHash,
        bytes32[] memory cleanupIntentIds
    )
        private
    {
        if (seller == address(0)) revert InvalidSeller();
        if (amount == 0) revert InvalidAmount();
        if (deadline <= block.timestamp) revert InvalidDeadline();

        uint256 cleanupLength = cleanupIntentIds.length;
        for (uint256 i = 0; i < cleanupLength; i++) {
            _cancelExpiredIntentForSeller(cleanupIntentIds[i], seller);
        }

        if (availableBalance < amount) revert InsufficientAvailableBalance();
        if (sellerDeposits[seller] < sellerReserved[seller] + amount) revert SellerDepositTooLow();

        Intent storage current = intents[intentId];
        if (current.buyer != address(0)) revert IntentAlreadyExists();

        intents[intentId] = Intent({
            seller: seller,
            buyer: msg.sender,
            amount: amount,
            deadline: deadline,
            reserved: true,
            released: false,
            cancelled: false,
            nullifierHash: nullifierHash,
            intentHash: intentHash
        });

        availableBalance -= amount;
        reservedBalance += amount;
        sellerReserved[seller] += amount;

        emit IntentReserved(intentId, seller, msg.sender, amount, deadline, nullifierHash, intentHash);
    }

    function _cancelExpiredIntentForSeller(bytes32 intentId, address seller) private {
        Intent storage intent = intents[intentId];
        if (!intent.reserved || intent.released || intent.cancelled) return;
        if (intent.seller != seller) return;
        if (block.timestamp <= intent.deadline) return;

        intent.reserved = false;
        intent.cancelled = true;

        reservedBalance -= intent.amount;
        availableBalance += intent.amount;
        sellerReserved[intent.seller] -= intent.amount;

        emit IntentCancelled(intentId, intent.seller, intent.amount);
    }

    function releaseWithProof(
        bytes32 intentId,
        bytes32 nullifierHash,
        bytes32 proofIntentHash,
        uint256 domainId,
        uint256 aggregationId,
        bytes32 leaf,
        bytes32[] calldata merklePath,
        uint256 leafCount,
        uint256 index
    )
        external
    {
        Intent storage intent = intents[intentId];
        if (!intent.reserved) revert IntentNotReserved();
        if (intent.released) revert IntentAlreadyReleased();
        if (intent.cancelled) revert IntentAlreadyCancelled();
        if (block.timestamp > intent.deadline) revert IntentExpired();
        if (msg.sender != intent.buyer) revert OnlyIntentBuyer();
        if (nullifierUsed[nullifierHash]) revert NullifierAlreadyUsed();
        if (intent.nullifierHash != nullifierHash) revert NullifierMismatch();
        if (intent.intentHash != proofIntentHash) revert IntentHashMismatch();

        bool verified = gateway.verifyProofAggregation(domainId, aggregationId, leaf, merklePath, leafCount, index);
        if (!verified) revert VerificationFailed();

        nullifierUsed[nullifierHash] = true;
        intent.reserved = false;
        intent.released = true;

        reservedBalance -= intent.amount;
        sellerReserved[intent.seller] -= intent.amount;
        sellerDeposits[intent.seller] -= intent.amount;
        totalDeposited -= intent.amount;

        bool transferred = token.transfer(intent.buyer, intent.amount);
        if (!transferred) revert TransferFailed();

        emit Released(intentId, intent.buyer, intent.amount, nullifierHash);
    }

    function cancelExpiredIntent(bytes32 intentId) external {
        Intent storage intent = intents[intentId];
        if (!intent.reserved) revert IntentNotReserved();
        if (intent.released) revert IntentAlreadyReleased();
        if (intent.cancelled) revert IntentAlreadyCancelled();
        if (block.timestamp <= intent.deadline) revert IntentNotExpired();

        intent.reserved = false;
        intent.cancelled = true;

        reservedBalance -= intent.amount;
        availableBalance += intent.amount;
        sellerReserved[intent.seller] -= intent.amount;

        emit IntentCancelled(intentId, intent.seller, intent.amount);
    }

    function cancelExpiredIntents(bytes32[] calldata intentIds) external {
        uint256 length = intentIds.length;
        for (uint256 i = 0; i < length; i++) {
            bytes32 intentId = intentIds[i];
            Intent storage intent = intents[intentId];
            if (!intent.reserved || intent.released || intent.cancelled || block.timestamp <= intent.deadline) {
                continue;
            }

            intent.reserved = false;
            intent.cancelled = true;

            reservedBalance -= intent.amount;
            availableBalance += intent.amount;
            sellerReserved[intent.seller] -= intent.amount;

            emit IntentCancelled(intentId, intent.seller, intent.amount);
        }
    }

    function withdraw(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        if (availableBalance < amount) revert InsufficientAvailableBalance();
        if (sellerDeposits[msg.sender] < sellerReserved[msg.sender] + amount) revert SellerDepositTooLow();

        sellerDeposits[msg.sender] -= amount;
        availableBalance -= amount;
        totalDeposited -= amount;

        bool ok = token.transfer(msg.sender, amount);
        if (!ok) revert TransferFailed();

        emit Withdrawn(msg.sender, amount);
    }

    function getIntent(bytes32 intentId) external view returns (Intent memory) {
        return intents[intentId];
    }
}
