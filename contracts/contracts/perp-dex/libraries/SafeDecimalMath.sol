// contracts/libraries/SafeDecimalMath.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library SafeDecimalMath {
    uint256 public constant DEFAULT_SCALE = 1e18; // Default 18 decimals

    // Multiply two scaled numbers, then rescale
    function mul(uint256 a, uint256 b, uint256 scale) internal pure returns (uint256) {
        if (a == 0 || b == 0) {
            return 0;
        }
        // (a * b) / scale
        // To avoid overflow, divide before multiply if possible, or use larger intermediate types if not.
        // For simplicity:
        uint256 c = a * b;
        require(c / a == b, "SafeDecimalMath: multiplication overflow"); // Check overflow
        return c / scale;
    }

    function mulDefault(uint256 a, uint256 b) internal pure returns (uint256) {
        return mul(a, b, DEFAULT_SCALE);
    }

    // Divide two scaled numbers, then rescale
    function div(uint256 a, uint256 b, uint256 scale) internal pure returns (uint256) {
        require(b > 0, "SafeDecimalMath: division by zero");
        // (a * scale) / b
        uint256 c = a * scale;
        // require(c / scale == a, "SafeDecimalMath: division pre-multiplication overflow"); // Check overflow (a bit tricky here)
        // If 'a' is already scaled, and 'b' is also scaled, then (a/b) * scale can be wrong.
        // If a and b are both scaled numbers (e.g. price and another price), a / b gives ratio. Multiply by scale if result should be scaled.
        // If a is a value and b is a price (scaled), then a * scale / b gives quantity in base units of price.
        // This function assumes a and b are values, and we want (a/b) keeping scale.
        // Example: a (scaled value), b (scaled value) => (a * scale) / b (result scaled)
        return c / b;
    }

    function divDefault(uint256 a, uint256 b) internal pure returns (uint256) {
        return div(a, b, DEFAULT_SCALE);
    }

    // Add two scaled numbers
    function add(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 c = a + b;
        require(c >= a, "SafeDecimalMath: addition overflow");
        return c;
    }

    // Subtract two scaled numbers
    function sub(uint256 a, uint256 b) internal pure returns (uint256) {
        require(b <= a, "SafeDecimalMath: subtraction underflow");
        return a - b;
    }

    // Converts a regular number to a scaled number
    function toScaled(uint256 a, uint256 scale) internal pure returns (uint256) {
        uint256 scaledValue = a * scale;
        require(scaledValue / scale == a, "SafeDecimalMath: toScaled overflow");
        return scaledValue;
    }

    function toScaledDefault(uint256 a) internal pure returns (uint256) {
        return toScaled(a, DEFAULT_SCALE);
    }

    // Converts a scaled number back to a regular number (loses precision)
    function fromScaled(uint256 a, uint256 scale) internal pure returns (uint256) {
        require(scale > 0, "SafeDecimalMath: division by zero for scale");
        return a / scale;
    }

    function fromScaledDefault(uint256 a) internal pure returns (uint256) {
        return fromScaled(a, DEFAULT_SCALE);
    }
}