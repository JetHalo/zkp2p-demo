// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/USDCH.sol";

contract USDCHTest is Test {
    USDCH internal token;

    address internal holder = address(0xA11CE);
    address internal receiver = address(0xB0B);
    address internal spender = address(0xCAFE);

    uint256 internal constant INITIAL_SUPPLY = 100_000_000 * 10 ** 6;

    function setUp() external {
        token = new USDCH(holder);
    }

    function testMetadataAndInitialMint() external {
        assertEq(token.name(), "USD Coin Horizen");
        assertEq(token.symbol(), "USDCH");
        assertEq(uint256(token.decimals()), uint256(6));

        assertEq(token.totalSupply(), INITIAL_SUPPLY);
        assertEq(token.balanceOf(holder), INITIAL_SUPPLY);
    }

    function testTransfer() external {
        uint256 amount = 12_500 * 10 ** 6;

        vm.prank(holder);
        bool ok = token.transfer(receiver, amount);

        assertTrue(ok);
        assertEq(token.balanceOf(holder), INITIAL_SUPPLY - amount);
        assertEq(token.balanceOf(receiver), amount);
    }

    function testApproveAndTransferFrom() external {
        uint256 amount = 1_000 * 10 ** 6;

        vm.prank(holder);
        bool approved = token.approve(spender, amount);
        assertTrue(approved);
        assertEq(token.allowance(holder, spender), amount);

        vm.prank(spender);
        bool moved = token.transferFrom(holder, receiver, amount);
        assertTrue(moved);

        assertEq(token.balanceOf(receiver), amount);
        assertEq(token.allowance(holder, spender), 0);
    }

    function testRevertOnZeroHolderInConstructor() external {
        vm.expectRevert(USDCH.ZeroAddress.selector);
        new USDCH(address(0));
    }
}
