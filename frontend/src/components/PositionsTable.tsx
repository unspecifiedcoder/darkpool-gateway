import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ManageMarginModal } from "./ManageMarginModal";
import {
  useAccount,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { AppChain, contracts } from "@/lib/contracts";
import { useOraclePrice } from "@/hooks/useOraclePrice";
import { formatUnits, Hex } from "viem";
import { toast } from "sonner";
import { useAppStore, useAppActions } from "@/store/useAppStore";
import { apiService } from "@/services/apiService";
import { Copy, RefreshCw } from "lucide-react";
import { ethers } from "ethers";
import { Link } from "react-router-dom";

// --- Constants ---
const PRICE_PRECISION = 10n ** 18n;
const MAINTENANCE_MARGIN_RATIO_BPS = 245n;
const BPS_DIVISOR = 10000n;

const positionContractConfig = {
  address: contracts.clearingHouse.address,
  abi: contracts.clearingHouse.abi,
} as const;

export const PositionsTable = () => {
  // --- Local & Global State ---
  const [positionIds, setPositionIds] = useState<Hex[]>([]);
  const [optimisticallyRemoved, setOptimisticallyRemoved] = useState<Hex[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [modalState, setModalState] = useState<{
    type: "add" | "remove";
    positionId: Hex | null;
  }>({ type: "add", positionId: null });
  const [closingPositionId, setClosingPositionId] = useState<Hex | null>(null);

  const { tradingMode, userClient, refetchSignal } = useAppStore();
  const { address, isConnected } = useAccount();
  const { data: btcPrice } = useOraclePrice();
  const { triggerRefetch } = useAppActions();

  // --- Transaction Hook for Closing Positions ---
  const {
    data: closeHash,
    isPending: isClosing,
    writeContract: closePosition,
    reset: resetClose,
  } = useWriteContract();
  const { isLoading: isConfirmingClose, isSuccess: isClosed } =
    useWaitForTransactionReceipt({ hash: closeHash });

  // --- Data Fetching ---
  // 1. Fetch the LIST of position IDs from our efficient indexer
  const fetchPositionIds = useCallback(async () => {
    if (!isConnected) {
      setPositionIds([]);
      return;
    }
    setIsLoading(true);
    try {
      let ids: string[];
      if (tradingMode === "Private" && userClient) {
        ids = (await userClient.getOpenPositions()).map((p) => p.position_id);
      } else {
        ids = (await apiService.getPublicOpenPositions(address!)).map(
          (p) => p.position_id
        );
      }
      setPositionIds(ids as Hex[]);
    } catch (error) {
      console.error("Failed to fetch position list:", error);
      toast.error("Failed to fetch position list.");
      setPositionIds([]);
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, tradingMode, userClient, address]);

  useEffect(() => {
    fetchPositionIds();
  }, [fetchPositionIds, refetchSignal]);
  // 1. Combine all contract calls into a single memoized array
  const allPositionCalls = useMemo(() => {
    if (positionIds.length === 0) return [];

    const detailCalls = positionIds.map((id) => ({
      ...positionContractConfig,
      functionName: "positions",
      args: [id],
    }));

    const pnlCalls = positionIds.map((id) => ({
      ...positionContractConfig,
      functionName: "calculatePnl",
      args: [id],
    }));

    return [...detailCalls, ...pnlCalls];
  }, [positionIds]); // Dependency array ensures this only re-runs when positionIds change

  // 2. Use a single useReadContracts hook with polling configuration
  const { data: allPositionsData, refetch: refetchAllPositions } =
    // @ts-ignore
    useReadContracts({
      //@ts-ignore
      contracts: allPositionCalls,
      query: {
        enabled: allPositionCalls.length > 0, // Enable query only when there are calls to make
        refetchInterval: 15000, // Poll for new data every 15 seconds
        refetchOnWindowFocus: false, // Optional: for stricter control
      },
    });

  // 3. Split the combined data back into details and PnL
  const { positionsData, pnlData } = useMemo(() => {
    if (!allPositionsData || allPositionsData.length === 0) {
      return { positionsData: [], pnlData: [] };
    }
    const half = allPositionsData.length / 2;
    const positions = allPositionsData.slice(0, half);
    const pnls = allPositionsData.slice(half);
    return { positionsData: positions, pnlData: pnls };
  }, [allPositionsData]);

  // --- Transaction Outcome ---
  useEffect(() => {
    if (isClosed && closingPositionId) {
      toast.success(`Position ${closingPositionId.slice(0, 8)}... closed!`);
      setPositionIds((prev) =>
        prev.filter(
          (id) => id.toLowerCase() !== closingPositionId.toLowerCase()
        )
      );
      setClosingPositionId(null);
      resetClose();

      const timer = setTimeout(() => {
        triggerRefetch();
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [isClosed, closingPositionId, triggerRefetch, resetClose]);

  // --- Handlers ---
  const handleOpenModal = (type: "add" | "remove", positionId: Hex) => {
    setModalState({ type, positionId });
  };

  const handleClosePosition = async (positionId: Hex) => {
    setClosingPositionId(positionId);
    const toastId = toast.loading("Preparing to close position...");
    if (tradingMode === "Private" && userClient) {
      try {
        toast.info("Please sign message to authorize closing.", {
          id: toastId,
        });
        const msgHash = ethers.solidityPackedKeccak256(
          ["string", "bytes32"],
          ["CLOSE_POSITION", positionId]
        );
        const signature = await userClient.secretWallet.signMessage(
          ethers.getBytes(msgHash)
        );
        closePosition({
          ...contracts.privacyProxy,
          functionName: "closePosition",
          args: [positionId, signature],
          chain: AppChain,
          account: address,
        });
      } catch (e) {
        toast.error("Signature rejected.", { id: toastId });
        setClosingPositionId(null);
      }
    } else {
      // Public Mode
      toast.info("Please confirm in your wallet.", { id: toastId });
      closePosition(
        {
          ...contracts.clearingHouse,
          functionName: "closePosition",
          args: [positionId],
          chain: AppChain,
          account: address,
        },
        {
          onSuccess: () => {
            toast.info("Submitting transaction...", { id: toastId });
          },
          onError: (err) => {
            toast.error("Failed to close", {
              id: toastId,
              description: err.message,
            });
            setClosingPositionId(null);
          },
        }
      );
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Position ID copied to clipboard!");
  };

  return (
    <>
      <div className="glass-panel p-6 space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold text-glow">
            Open Positions ({tradingMode} Mode)
          </h3>
          <Button
            variant="ghost"
            size="icon"
            onClick={fetchPositionIds} // <-- On click, just call the fetch function
            disabled={isLoading}
            className="text-muted-foreground hover:text-primary"
          >
            <RefreshCw
              className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`}
            />
          </Button>
        </div>

        {isLoading ? (
          <div className="text-center py-12">Loading positions...</div>
        ) : positionIds.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>No open positions found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="space-y-2">
                <tr className="border-b border-border">
                  <th className="text-left p-2">Position ID</th>
                  <th className="text-left p-2">Type</th>
                  <th className="text-right p-2">Size (BTC)</th>
                  <th className="text-right p-2">Entry Price</th>
                  <th className="text-right p-2">Margin</th>
                  <th className="text-right p-2">PnL</th>
                  <th className="text-right p-2">Liq. Price</th>
                  <th className="text-center p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {positionsData?.map((positionResult, index) => {
                  if (!positionResult || positionResult.status !== "success")
                    return null;

                  const positionId = positionIds[index];
                  const position = positionResult.result;
                  // console.log("possssition", position);
                  const pnl = pnlData?.[index]?.result?.[0] ?? 0n;

                  // --- All calculations now use the LIVE `position` data ---
                  const size = position[1];
                  const margin = position[2];
                  const isLong = position[4];

                  let liquidationPrice = 0n;
                  if (btcPrice && size > 0n) {
                    const totalEquity = margin + pnl;
                    const positionValue =
                      (size * (btcPrice as bigint)) / PRICE_PRECISION;
                    // const leverageBigInt = (positionValue * 100n) / margin;
                    // console.log("Leverage", Number(leverageBigInt) / 100);
                    const requiredMargin =
                      (positionValue * MAINTENANCE_MARGIN_RATIO_BPS) /
                      BPS_DIVISOR;
                    const bufferUSDC = totalEquity - requiredMargin;
                    const priceDelta = (bufferUSDC * PRICE_PRECISION) / size;
                    liquidationPrice = isLong
                      ? (btcPrice as bigint) - priceDelta
                      : (btcPrice as bigint) + priceDelta;
                  }

                  const pnlPercent =
                    margin > 0 ? Number((pnl * 10000n) / margin) / 100 : 0;
                  const formatCurrency = (value: bigint) =>
                    `$${parseFloat(formatUnits(value, 18)).toLocaleString(
                      "en-US",
                      { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                    )}`;

                  return (
                    <tr key={positionId} className="border-b border-border/50">
                      <td className="p-2 font-mono flex items-center gap-2">
                        <Link
                          to={`/explorer?positionId=${positionId}`}
                          target="_blank"
                          className="hover:text-primary transition-colors"
                        >
                          {`${positionId.slice(0, 8)}...${positionId.slice(
                            -6
                          )}`}
                        </Link>
                        <Copy
                          className="w-3 h-3 cursor-pointer"
                          onClick={() => copyToClipboard(positionId)}
                        />
                      </td>
                      <td className="p-2">
                        <Badge variant={isLong ? "long" : "short"}>
                          {isLong ? "Long" : "Short"}
                        </Badge>
                      </td>
                      <td className="p-2 text-right font-mono">
                        {parseFloat(formatUnits(size, 18)).toFixed(4)}
                      </td>
                      <td className="p-2 text-right font-mono">
                        {formatCurrency(position[3])}
                      </td>
                      <td className="p-2 text-right font-mono">
                        {formatCurrency(margin)}
                      </td>
                      <td
                        className={`p-2 text-right font-mono ${
                          pnl >= 0 ? "text-success" : "text-destructive"
                        }`}
                      >
                        <div>{formatCurrency(pnl)}</div>
                        <div className="text-xs">{pnlPercent.toFixed(2)}%</div>
                      </td>
                      <td className="p-2 text-right font-mono text-destructive">
                        {formatCurrency(liquidationPrice)}
                      </td>
                      <td className="p-2">
                        <div className="flex gap-2 justify-center">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleOpenModal("add", positionId)}
                          >
                            Add
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              handleOpenModal("remove", positionId)
                            }
                          >
                            Remove
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleClosePosition(positionId)}
                            disabled={isClosing || isConfirmingClose}
                          >
                            Close
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ManageMarginModal
        positionId={modalState.positionId}
        type={modalState.type}
        onClose={() => setModalState({ ...modalState, positionId: null })}
        onSuccess={triggerRefetch}
      />
    </>
  );
};

export default PositionsTable;
