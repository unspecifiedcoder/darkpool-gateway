// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0
pragma solidity ^0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockErc20 is ERC20 {
    constructor() ERC20("MockErc20", "MC") {}

    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }
}