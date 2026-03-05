// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/Zkp2pDepositPool.sol";

contract MockAggregationGateway {
    bool internal nextResult = true;

    function setNextResult(bool value) external {
        nextResult = value;
    }

    function verifyProofAggregation(uint256, uint256, bytes32, bytes32[] calldata, uint256, uint256)
        external
        view
        returns (bool)
    {
        return nextResult;
    }
}

contract MockUSDC {
    string public name = "Fake USDC";
    string public symbol = "fUSDC";
    uint8 public decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "insufficient allowance");
        require(balanceOf[from] >= amount, "insufficient balance");
        allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract Zkp2pDepositPoolTest is Test {
    MockUSDC internal token;
    MockAggregationGateway internal gateway;
    Zkp2pDepositPool internal pool;

    address internal seller = address(0xA11CE);
    address internal buyer = address(0xB0B);
    uint256 internal constant DOMAIN_ID = 1001;
    uint256 internal constant AGGREGATION_ID = 77;
    uint256 internal constant LEAF_COUNT = 1;
    uint256 internal constant INDEX = 0;

    function _emptyMerklePath() internal pure returns (bytes32[] memory path) {
        path = new bytes32[](0);
    }

    function _createIntentAsBuyer(
        bytes32 intentId,
        address seller_,
        uint256 amount,
        uint256 deadline,
        bytes32 nullifierHash,
        bytes32 intentHash
    ) internal {
        vm.prank(buyer);
        pool.createIntent(intentId, seller_, amount, deadline, nullifierHash, intentHash);
    }

    function _createIntentAsBuyerWithCleanup(
        bytes32 intentId,
        address seller_,
        uint256 amount,
        uint256 deadline,
        bytes32 nullifierHash,
        bytes32 intentHash,
        bytes32[] memory cleanupIntentIds
    ) internal {
        vm.prank(buyer);
        pool.createIntent(intentId, seller_, amount, deadline, nullifierHash, intentHash, cleanupIntentIds);
    }

    function _releaseAsBuyer(bytes32 intentId, bytes32 nullifierHash, bytes32 intentHash) internal {
        bytes32[] memory merklePath = _emptyMerklePath();
        vm.prank(buyer);
        pool.releaseWithProof(
            intentId,
            nullifierHash,
            intentHash,
            DOMAIN_ID,
            AGGREGATION_ID,
            keccak256("leaf"),
            merklePath,
            LEAF_COUNT,
            INDEX
        );
    }

    function setUp() external {
        token = new MockUSDC();
        gateway = new MockAggregationGateway();
        pool = new Zkp2pDepositPool(address(token), address(gateway));

        token.mint(seller, 1_000_000_000); // 1000 USDC, 6 decimals

        vm.prank(seller);
        token.approve(address(pool), type(uint256).max);
    }

    function testDepositIncreasesAvailableBalance() external {
        vm.prank(seller);
        pool.deposit(500_000_000);

        assertEq(pool.availableBalance(), 500_000_000);
        assertEq(pool.totalDeposited(), 500_000_000);
    }

    function testCreateIntentByBuyerMovesBalanceToReserved() external {
        vm.prank(seller);
        pool.deposit(500_000_000);

        bytes32 intentId = keccak256("intent-1");
        bytes32 nullifierHash = keccak256("nullifier-1");
        bytes32 intentHash = keccak256("statement-1");
        uint256 deadline = block.timestamp + 1 hours;

        _createIntentAsBuyer(intentId, seller, 200_000_000, deadline, nullifierHash, intentHash);

        assertEq(pool.availableBalance(), 300_000_000);
        assertEq(pool.reservedBalance(), 200_000_000);
        assertEq(pool.sellerReserved(seller), 200_000_000);

        Zkp2pDepositPool.Intent memory intent = pool.getIntent(intentId);
        assertEq(intent.buyer, buyer);
        assertEq(intent.seller, seller);
        assertEq(intent.deadline, deadline);
        assertTrue(intent.reserved);
    }

    function testReleaseWithProofTransfersToBuyerAndMarksNullifierUsed() external {
        vm.prank(seller);
        pool.deposit(500_000_000);

        bytes32 intentId = keccak256("intent-2");
        bytes32 nullifierHash = keccak256("nullifier-2");
        bytes32 intentHash = keccak256("statement-2");
        uint256 deadline = block.timestamp + 1 hours;

        _createIntentAsBuyer(intentId, seller, 200_000_000, deadline, nullifierHash, intentHash);
        _releaseAsBuyer(intentId, nullifierHash, intentHash);

        assertEq(token.balanceOf(buyer), 200_000_000);
        assertEq(pool.reservedBalance(), 0);
        assertEq(pool.sellerReserved(seller), 0);
        assertEq(pool.sellerDeposits(seller), 300_000_000);
        assertTrue(pool.nullifierUsed(nullifierHash));
    }

    function testReleaseRevertsIfCallerIsNotIntentBuyer() external {
        vm.prank(seller);
        pool.deposit(500_000_000);

        bytes32 intentId = keccak256("intent-not-buyer");
        bytes32 nullifierHash = keccak256("nullifier-not-buyer");
        bytes32 intentHash = keccak256("statement-not-buyer");
        bytes32[] memory merklePath = _emptyMerklePath();
        uint256 deadline = block.timestamp + 1 hours;

        _createIntentAsBuyer(intentId, seller, 200_000_000, deadline, nullifierHash, intentHash);

        vm.prank(address(0x9999));
        vm.expectRevert(Zkp2pDepositPool.OnlyIntentBuyer.selector);
        pool.releaseWithProof(
            intentId,
            nullifierHash,
            intentHash,
            DOMAIN_ID,
            AGGREGATION_ID,
            keccak256("leaf"),
            merklePath,
            LEAF_COUNT,
            INDEX
        );
    }

    function testReleaseRevertsOnNullifierReplay() external {
        vm.prank(seller);
        pool.deposit(500_000_000);

        bytes32 intentId = keccak256("intent-3");
        bytes32 intentReplay = keccak256("intent-3-replay");
        bytes32 nullifierHash = keccak256("nullifier-3");
        bytes32 intentHash = keccak256("statement-3");
        bytes32 intentHashReplay = keccak256("statement-3-replay");
        uint256 deadline = block.timestamp + 1 hours;

        _createIntentAsBuyer(intentId, seller, 200_000_000, deadline, nullifierHash, intentHash);
        _releaseAsBuyer(intentId, nullifierHash, intentHash);

        _createIntentAsBuyer(intentReplay, seller, 100_000_000, deadline, nullifierHash, intentHashReplay);
        vm.expectRevert(Zkp2pDepositPool.NullifierAlreadyUsed.selector);
        _releaseAsBuyer(intentReplay, nullifierHash, intentHashReplay);
    }

    function testWithdrawOnlyFromAvailableBalance() external {
        vm.prank(seller);
        pool.deposit(500_000_000);

        bytes32 intentId = keccak256("intent-4");
        bytes32 nullifierHash = keccak256("nullifier-4");
        bytes32 intentHash = keccak256("statement-4");
        uint256 deadline = block.timestamp + 1 hours;
        _createIntentAsBuyer(intentId, seller, 200_000_000, deadline, nullifierHash, intentHash);

        vm.prank(seller);
        vm.expectRevert(Zkp2pDepositPool.InsufficientAvailableBalance.selector);
        pool.withdraw(400_000_000);

        vm.prank(seller);
        pool.withdraw(300_000_000);
        assertEq(token.balanceOf(seller), 800_000_000);
        assertEq(pool.availableBalance(), 0);
    }

    function testReleaseRequiresSuccessfulAggregationVerification() external {
        vm.prank(seller);
        pool.deposit(500_000_000);

        bytes32 intentId = keccak256("intent-5");
        bytes32 nullifierHash = keccak256("nullifier-5");
        bytes32 intentHash = keccak256("statement-5");
        uint256 deadline = block.timestamp + 1 hours;

        _createIntentAsBuyer(intentId, seller, 200_000_000, deadline, nullifierHash, intentHash);
        gateway.setNextResult(false);

        vm.expectRevert(Zkp2pDepositPool.VerificationFailed.selector);
        _releaseAsBuyer(intentId, nullifierHash, intentHash);
    }

    function testReleaseRevertsOnIntentHashMismatch() external {
        vm.prank(seller);
        pool.deposit(500_000_000);

        bytes32 intentId = keccak256("intent-6");
        bytes32 nullifierHash = keccak256("nullifier-6");
        bytes32 intentHash = keccak256("statement-6");
        bytes32 wrongIntentHash = keccak256("statement-wrong");
        bytes32[] memory merklePath = _emptyMerklePath();
        uint256 deadline = block.timestamp + 1 hours;

        _createIntentAsBuyer(intentId, seller, 200_000_000, deadline, nullifierHash, intentHash);

        vm.prank(buyer);
        vm.expectRevert(Zkp2pDepositPool.IntentHashMismatch.selector);
        pool.releaseWithProof(
            intentId,
            nullifierHash,
            wrongIntentHash,
            DOMAIN_ID,
            AGGREGATION_ID,
            keccak256("leaf"),
            merklePath,
            LEAF_COUNT,
            INDEX
        );
    }

    function testReleaseRevertsAfterDeadline() external {
        vm.prank(seller);
        pool.deposit(500_000_000);

        bytes32 intentId = keccak256("intent-expired");
        bytes32 nullifierHash = keccak256("nullifier-expired");
        bytes32 intentHash = keccak256("statement-expired");
        uint256 deadline = block.timestamp + 10;

        _createIntentAsBuyer(intentId, seller, 200_000_000, deadline, nullifierHash, intentHash);
        vm.warp(deadline + 1);

        vm.expectRevert(Zkp2pDepositPool.IntentExpired.selector);
        _releaseAsBuyer(intentId, nullifierHash, intentHash);
    }

    function testCancelExpiredIntentUnlocksBalance() external {
        vm.prank(seller);
        pool.deposit(500_000_000);

        bytes32 intentId = keccak256("intent-cancel-1");
        bytes32 nullifierHash = keccak256("nullifier-cancel-1");
        bytes32 intentHash = keccak256("statement-cancel-1");
        uint256 deadline = block.timestamp + 10;

        _createIntentAsBuyer(intentId, seller, 200_000_000, deadline, nullifierHash, intentHash);
        vm.warp(deadline + 1);

        pool.cancelExpiredIntent(intentId);

        assertEq(pool.availableBalance(), 500_000_000);
        assertEq(pool.reservedBalance(), 0);
        assertEq(pool.sellerReserved(seller), 0);

        Zkp2pDepositPool.Intent memory intent = pool.getIntent(intentId);
        assertFalse(intent.reserved);
        assertTrue(intent.cancelled);
    }

    function testCancelExpiredIntentRevertsBeforeDeadline() external {
        vm.prank(seller);
        pool.deposit(500_000_000);

        bytes32 intentId = keccak256("intent-cancel-2");
        bytes32 nullifierHash = keccak256("nullifier-cancel-2");
        bytes32 intentHash = keccak256("statement-cancel-2");
        uint256 deadline = block.timestamp + 1 hours;

        _createIntentAsBuyer(intentId, seller, 200_000_000, deadline, nullifierHash, intentHash);

        vm.expectRevert(Zkp2pDepositPool.IntentNotExpired.selector);
        pool.cancelExpiredIntent(intentId);
    }

    function testBatchCancelExpiredIntentsUnlocksAllInOneTx() external {
        vm.prank(seller);
        pool.deposit(500_000_000);

        bytes32 idA = keccak256("intent-batch-a");
        bytes32 idB = keccak256("intent-batch-b");
        uint256 deadline = block.timestamp + 10;

        _createIntentAsBuyer(idA, seller, 200_000_000, deadline, keccak256("na"), keccak256("sa"));
        _createIntentAsBuyer(idB, seller, 100_000_000, deadline, keccak256("nb"), keccak256("sb"));

        vm.warp(deadline + 1);
        bytes32[] memory ids = new bytes32[](2);
        ids[0] = idA;
        ids[1] = idB;
        pool.cancelExpiredIntents(ids);

        assertEq(pool.availableBalance(), 500_000_000);
        assertEq(pool.reservedBalance(), 0);
        assertEq(pool.sellerReserved(seller), 0);
    }

    function testCreateIntentCanAutoCleanupExpiredIntentsInSameTx() external {
        vm.prank(seller);
        pool.deposit(500_000_000);

        bytes32 expiredIntentId = keccak256("intent-auto-cleanup-expired");
        _createIntentAsBuyer(
            expiredIntentId,
            seller,
            300_000_000,
            block.timestamp + 10,
            keccak256("n-expired"),
            keccak256("s-expired")
        );

        vm.warp(block.timestamp + 11);

        bytes32[] memory cleanupIds = new bytes32[](1);
        cleanupIds[0] = expiredIntentId;

        bytes32 newIntentId = keccak256("intent-auto-cleanup-new");
        _createIntentAsBuyerWithCleanup(
            newIntentId,
            seller,
            400_000_000,
            block.timestamp + 1 hours,
            keccak256("n-new"),
            keccak256("s-new"),
            cleanupIds
        );

        Zkp2pDepositPool.Intent memory expiredIntent = pool.getIntent(expiredIntentId);
        assertTrue(expiredIntent.cancelled);
        assertFalse(expiredIntent.reserved);
        assertEq(pool.availableBalance(), 100_000_000);
        assertEq(pool.reservedBalance(), 400_000_000);
        assertEq(pool.sellerReserved(seller), 400_000_000);
    }

    function testCreateIntentRevertsWhenSellerHasNoAvailableBalance() external {
        address sellerA = address(0xA111);
        address sellerB = address(0xB222);
        token.mint(sellerA, 500_000_000);
        token.mint(sellerB, 500_000_000);

        vm.prank(sellerA);
        token.approve(address(pool), type(uint256).max);
        vm.prank(sellerB);
        token.approve(address(pool), type(uint256).max);

        vm.prank(sellerA);
        pool.deposit(500_000_000);
        vm.prank(sellerB);
        pool.deposit(500_000_000);

        uint256 deadline = block.timestamp + 1 hours;
        _createIntentAsBuyer(keccak256("intent-seller-a"), sellerA, 500_000_000, deadline, keccak256("n1"), keccak256("s1"));

        vm.prank(buyer);
        vm.expectRevert(Zkp2pDepositPool.SellerDepositTooLow.selector);
        pool.createIntent(keccak256("intent-seller-a-over"), sellerA, 1, deadline, keccak256("n2"), keccak256("s2"));
    }

}
