// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract USDCH {
    error ZeroAddress();
    error InsufficientBalance();
    error InsufficientAllowance();

    string public constant name = "USD Coin Horizen";
    string public constant symbol = "USDCH";
    uint8 public constant decimals = 6;

    uint256 public immutable totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(address initialHolder) {
        if (initialHolder == address(0)) revert ZeroAddress();

        uint256 supply = 100_000_000 * 10 ** uint256(decimals);
        totalSupply = supply;
        balanceOf[initialHolder] = supply;

        emit Transfer(address(0), initialHolder, supply);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        if (spender == address(0)) revert ZeroAddress();
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 currentAllowance = allowance[from][msg.sender];
        if (currentAllowance < value) revert InsufficientAllowance();

        unchecked {
            allowance[from][msg.sender] = currentAllowance - value;
        }
        emit Approval(from, msg.sender, allowance[from][msg.sender]);

        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        if (to == address(0)) revert ZeroAddress();

        uint256 fromBalance = balanceOf[from];
        if (fromBalance < value) revert InsufficientBalance();

        unchecked {
            balanceOf[from] = fromBalance - value;
        }
        balanceOf[to] += value;

        emit Transfer(from, to, value);
    }
}
