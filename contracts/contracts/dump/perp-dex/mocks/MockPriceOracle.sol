// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPriceOracle} from "../interfaces/IPriceOracle.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

// This is a very basic mock oracle.
// In a real system, you'd use Chainlink or a more robust oracle solution.
contract MockPriceOracle is IPriceOracle, Ownable {
    // Mapping: baseAsset -> quoteAsset -> price
    mapping(address => mapping(address => uint256)) private _prices;
    // We'll assume prices are stored with 18 decimals of precision
    uint256 public constant PRICE_PRECISION = 1e18;

    event PriceSet(address indexed baseAsset, address indexed quoteAsset, uint256 price);

    constructor() Ownable(msg.sender) {}

    /**
     * @dev Sets the price for an asset pair. Only callable by the owner.
     * @param baseAsset The base asset address.
     * @param quoteAsset The quote asset address.
     * @param price The price of baseAsset in terms of quoteAsset, scaled by PRICE_PRECISION.
     *              e.g., if ETH/USD is 2000, price should be 2000 * 1e18.
     */
    function setPrice(address baseAsset, address quoteAsset, uint256 price) public onlyOwner {
        _prices[baseAsset][quoteAsset] = price ;
        emit PriceSet(baseAsset, quoteAsset, price);
    }

    /**
     * @inheritdoc IPriceOracle
     */
    function getPrice(address baseAsset, address quoteAsset) public view override returns (uint256 price) {
        price = _prices[baseAsset][quoteAsset];
        require(price > 0, "MockPriceOracle: Price not set or invalid");
        return price;
    }

    // Helper to set price with human-readable numbers if your quote asset has fewer decimals
    // e.g., for USDC (6 decimals), if ETH price is 2000 USDC
    // setPriceWithDecimals(vETH, USDC, 2000, 6)
    function setPriceWithDecimals(address baseAsset, address quoteAsset, uint256 priceWithoutDecimals, uint8 quoteDecimals) public onlyOwner {
        uint256 price = priceWithoutDecimals * (10**(18 - uint256(quoteDecimals))); // Adjust to 18 decimals internal representation
        setPrice(baseAsset, quoteAsset, price);
    }
}