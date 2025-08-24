import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useAccount,
} from "wagmi";
import { useAppStore } from "@/store/useAppStore";
import { contracts } from "@/lib/contracts";
import { useOraclePrice } from "@/hooks/useOraclePrice";
import { formatUnits, Hex } from "viem";
import { toast } from "sonner";
import { ApiPosition } from "@/lib/types";
import { Copy, Plus, Minus } from "lucide-react";
import { ethers } from "ethers";

// --- Constants ---
const PRICE_PRECISION = 10n ** 18n;
const MAINTENANCE_MARGIN_RATIO_BPS = 625n;
const BPS_DIVISOR = 10000n;

type PositionRowProps = {
  position: ApiPosition;
  onAction: () => void; // Callback to trigger table refetch
  onManageMargin: (type: "add" | "remove", positionId: Hex) => void;
};

export const PositionRow = ({
  position,
  onAction,
  onManageMargin,
}: PositionRowProps) => {
  const { tradingMode, userClient } = useAppStore();
  const { data: btcPrice } = useOraclePrice();
  const { address } = useAccount();

  const { data: pnlData } = useReadContract({
    ...contracts.clearingHouse,
    functionName: "calculatePnl",
    args: [position.position_id as Hex],
    query: { refetchInterval: 5000 },
  });

  const { data: hash, isPending, writeContract } = useWriteContract();
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash });

  const handleClose = async () => {
    const toastId = toast.loading("Closing position...");
    if (tradingMode === "Private") {
      if (!userClient)
        return toast.error("Private client not initialized.", { id: toastId });
      const msgHash = ethers.solidityPackedKeccak256(
        ["string", "bytes32"],
        ["CLOSE_POSITION", position.position_id]
      );
      try {
        const signature = await userClient.secretWallet.signMessage(
          ethers.getBytes(msgHash)
        );
        writeContract(
          {
            ...contracts.privacyProxy,
            functionName: "closePosition",
            args: [position.position_id, signature],
            chain: AppChain,
            account: address,
          },
          {
            onSuccess: () => {
              toast.info("Submitting transaction...", { id: toastId });
              onAction();
            },
            onError: (err) =>
              toast.error("Failed to close", {
                id: toastId,
                description: err.message,
              }),
          }
        );
      } catch (e) {
        toast.error("Signature rejected.", { id: toastId });
      }
    } else {
      // Public Mode
      writeContract(
        {
          ...contracts.clearingHouse,
          functionName: "closePosition",
          args: [position.position_id],
          chain: AppChain,
          account: address,
        },
        {
          onSuccess: () => {
            toast.info("Submitting transaction...", { id: toastId });
            onAction();
          },
          onError: (err) =>
            toast.error("Failed to close", {
              id: toastId,
              description: err.message,
            }),
        }
      );
    }
  };

  
  const hasPosition = position && position[0] > 0n;
  const pnl = pnlData ? pnlData[0] : 0n;
  let liquidationPrice = 0n;
  let pnlPercent = 0;
  if (hasPosition && btcPrice && position[2] > 0n) { // position[2] is entryPrice
    const positionValueAtEntry = (position[0] as bigint * position[2] as bigint) / PRICE_PRECISION;
    if (positionValueAtEntry > 0) {
      pnlPercent = Number(pnl * 10000n / position[1]) / 100; // PnL as a percentage of margin
    }
    
    // Liq Price = Entry +/- (Margin + PnL - MaintenanceMargin) / Size
    const totalEquity = position[1] + pnl;
    const positionValueAtMark = (position[0] as bigint * (btcPrice as bigint)) / PRICE_PRECISION;
    const requiredMargin = (positionValueAtMark * MAINTENANCE_MARGIN_RATIO_BPS) / BPS_DIVISOR;
    const priceChange = ((totalEquity - requiredMargin) * PRICE_PRECISION) / position[0];

    if (position[3]) { // isLong
      liquidationPrice = (btcPrice as bigint) - priceChange;
    } else {
      liquidationPrice = (btcPrice as bigint) + priceChange;
    }
  }

  // ... (liquidation price calculation is the same as before)
  const formatCurrency = (val: string) =>
    `$${parseFloat(formatUnits(BigInt(val), 18)).toFixed(2)}`;
  const truncatedId = `${position.position_id.slice(
    0,
    6
  )}...${position.position_id.slice(-4)}`;

  return (
    <tr className="border-b border-border/50">
      <td className="p-2 font-mono flex items-center gap-2">
        {truncatedId}
        <Copy
          className="w-3 h-3 cursor-pointer text-muted-foreground"
          onClick={() => navigator.clipboard.writeText(position.position_id)}
        />
      </td>
      <td className="p-2">
        <Badge variant={position.is_long ? "long" : "short"}>
          {position.is_long ? "Long" : "Short"}
        </Badge>
      </td>
      <td className="p-2 text-right font-mono">
        {formatUnits(BigInt(position.size), 18)}
      </td>
      <td className="p-2 text-right font-mono">
        {formatCurrency(position.entry_price)}
      </td>
      <td className="p-2 text-right font-mono">
        {btcPrice
          ? `$${parseFloat(formatUnits(btcPrice as bigint, 18)).toFixed(2)}`
          : "..."}
      </td>
      <td className="p-2 text-right font-mono">
        {formatCurrency(position.margin)}
      </td>
      <td
        className={`p-2 text-right font-mono ${
          pnl >= 0 ? "text-success" : "text-destructive"
        }`}
      >
        {formatCurrency(pnl.toString())}
      </td>
      <td className="p-2 text-right font-mono">{formatCurrency(liquidationPrice.toString())}</td>
      <td className="p-2">
        <div className="flex gap-2 justify-center">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onManageMargin("add", position.position_id as Hex)}
          >
            <Plus className="w-3 h-3" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onManageMargin("remove", position.position_id as Hex)
            }
          >
            <Minus className="w-3 h-3" />
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={handleClose}
            disabled={isPending || isConfirming}
          >
            {isPending ? "..." : isConfirming ? "..." : "Close"}
          </Button>
        </div>
      </td>
    </tr>
  );
};
