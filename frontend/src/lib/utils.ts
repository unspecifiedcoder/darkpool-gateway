import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { formatUnits } from "viem";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}


// A simple BigInt-based formatter to handle large string numbers without precision loss.

// Formats a large number string (e.g., from a smart contract) into a decimal string.
const formatBigNumber = (value: string, decimals: number): string => {
  try {
    const valueBigInt = BigInt(value);
    const divisor = BigInt('1' + '0'.repeat(decimals));
    const integerPart = valueBigInt / divisor;
    const fractionalPart = valueBigInt % divisor;

    if (fractionalPart === 0n) {
      return integerPart.toString();
    }
    
    const fractionalString = fractionalPart.toString().padStart(decimals, '0').replace(/0+$/, '');
    return `${integerPart}.${fractionalString}`;
  } catch (error) {
    console.error("Error formatting big number:", error);
    return "0.00";
  }
};

// Formats a currency value (like USDC) with 2 decimal places and a dollar sign.
export const formatCurrency = (value: string, contractDecimals: number = 18): string => {
  try {
    const valueBigInt = BigInt(value);
    const isNegative = valueBigInt < 0n;
    const absValue = isNegative ? -valueBigInt : valueBigInt;
    
    const divisor = BigInt('1' + '0'.repeat(contractDecimals));
    const integerPart = absValue / divisor;
    const fractionalPart = (absValue % divisor) / BigInt('1' + '0'.repeat(contractDecimals - 2));

    const formatted = `${integerPart.toString()}.${fractionalPart.toString().padStart(2, '0')}`;
    return isNegative ? `-$${formatted}` : `$${formatted}`;
  } catch (error) {
    console.error("Error formatting currency:", error);
    return "$0.00";
  }
};

export const formatCurrency_ = (value: bigint) =>
  `$${parseFloat(formatUnits(value, 18)).toLocaleString(
    "en-US",
    { minimumFractionDigits: 2, maximumFractionDigits: 2 }
  )}`;


// Formats an asset value (like BTC) with appropriate decimal places.
export const formatAsset = (value: string, contractDecimals: number = 18, displayDecimals: number = 4): string => {
    try {
        const valueBigInt = BigInt(value);
        const divisor = BigInt('1' + '0'.repeat(contractDecimals));
        const integerPart = valueBigInt / divisor;
        const fractionalPart = valueBigInt % divisor;

        if (fractionalPart === 0n) {
            return integerPart.toString();
        }

        const fractionalString = fractionalPart.toString().padStart(contractDecimals, '0').substring(0, displayDecimals);
        return `${integerPart}.${fractionalString}`;
    } catch (error) {
        console.error("Error formatting asset:", error);
        return "0.0000";
    }
};

// Formats PnL with a sign and appropriate color class.
export const formatPnl = (value: string, contractDecimals: number = 18): { text: string; className: string } => {
  try {
    const valueBigInt = BigInt(value);
    const formattedText = formatCurrency(value, contractDecimals);
    if (valueBigInt > 0n) {
      return { text: `+${formattedText}`, className: 'text-[#00ff87]' };
    }
    if (valueBigInt < 0n) {
      return { text: formattedText, className: 'text-[#ff2d55]' };
    }
    return { text: formattedText, className: 'text-slate-300' };
  } catch (error) {
    return { text: "$0.00", className: 'text-slate-300' };
  }
};

// Utility to shorten a hex string like a position ID.
export const shortenId = (id: string, chars = 6): string => {
  if (id.length <= chars * 2 + 2) {
    return id;
  }
  return `${id.substring(0, chars + 2)}...${id.substring(id.length - chars)}`;
};
