import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { useAppStore } from "@/store/useAppStore";
import { apiService } from "@/services/apiService";
import { HistoricalPosition, PaginatedResponse } from "@/lib/types";
import { formatUnits } from "viem";
import { Copy, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";

export const HistoryTable = () => {
  // --- State ---
  const [history, setHistory] = useState<HistoricalPosition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const { tradingMode, userClient, refetchSignal } = useAppStore();
  const { address, isConnected } = useAccount();

  // --- Data Fetching ---
  const fetchHistory = useCallback(
    async (cursor?: string) => {
      if (!isConnected) return;
      if (!cursor) setIsLoading(true); // Full load only on initial fetch
      else setIsFetchingMore(true);

      try {
        let response: PaginatedResponse<HistoricalPosition>;
        if (tradingMode === "Private" && userClient) {
          // The private historical endpoint would need to be added to the API/UserClient
          // For now, we'll assume it exists and works like the public one.
          response = await userClient.getHistoricalPositions(cursor);
        } else {
          response = await apiService.getPublicHistoricalPositions(
            address!,
            cursor
          );
        }

        if (cursor) {
          console.log("hisfswefe", response);
          setHistory((prev) => [...prev, ...response.items]); // Append new items
        } else {
          console.log("hisfswefe", response);
          setHistory(response.items); // Replace with the first page
        }
        setNextCursor(response.next_cursor);
        setHasMore(response.has_more);
      } catch (error) {
        toast.error("Failed to fetch trade history.");
      } finally {
        setIsLoading(false);
        setIsFetchingMore(false);
      }
    },
    [isConnected, tradingMode, userClient, address]
  );

  // Initial fetch and refetch on signal
  useEffect(() => {
    fetchHistory();
  }, [fetchHistory, refetchSignal]);

  const handleLoadMore = () => {
    if (nextCursor) {
      fetchHistory(nextCursor);
    }
  };

  const formatCurrency = (value: string) => {
    const num = BigInt(value);
    const formatted = formatUnits(num, 18);
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(parseFloat(formatted));
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Position ID copied to clipboard!");
  };

  return (
    <div className="p-6 space-y-4">
      <h3 className="text-lg font-semibold text-glow">Trade History</h3>
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">
          Loading history...
        </div>
      ) : history.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>No trade history</p>
          <p className="text-sm">
            Your closed and liquidated positions will appear here.
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-2">PostionId</th>
                  <th className="text-left p-2">Asset</th>
                  <th className="text-left p-2">Type</th>
                  <th className="text-right p-2">Entry Price</th>
                  <th className="text-right p-2">Final PnL</th>
                  <th className="text-center p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map((trade) => (
                  <tr
                    key={trade.position_id}
                    className="border-b border-border/50 hover:bg-primary/5"
                  >
                    <td className="p-2 font-mono flex items-center gap-2">
                      <Link
                        to={`/explorer?positionId=${trade.position_id}`}
                        target="_blank"
                        className="hover:text-primary transition-colors"
                      >
                        {`${trade.position_id.slice(
                          0,
                          8
                        )}...${trade.position_id.slice(-6)}`}
                      </Link>
                      <Copy
                        className="w-3 h-3 cursor-pointer"
                        onClick={() => copyToClipboard(trade.position_id)}
                      />
                    </td>
                    <td className="p-2 font-mono">BTC/USDC</td>
                    <td className="p-2">
                      <Badge variant={trade.is_long ? "long" : "short"}>
                        {trade.is_long ? "Long" : "Short"}
                      </Badge>
                    </td>
                    <td className="p-2 text-right font-mono">
                      {formatCurrency(trade.entry_price)}
                    </td>
                    <td
                      className={`p-2 text-right font-mono ${
                        trade.status === "Liquidated" ||
                        BigInt(trade.final_pnl) < 0
                          ? "text-destructive"
                          : "text-success"
                      }`}
                    >
                      {trade.status !== "Liquidated"
                        ? formatCurrency(trade.final_pnl)
                        : "-"}
                    </td>
                    <td className="p-2 text-center">
                      <span
                        className={
                          trade.status === "Liquidated"
                            ? "text-destructive"
                            : "text-muted-foreground"
                        }
                      >
                        {trade.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <div className="flex justify-center mt-4">
              <Button
                onClick={handleLoadMore}
                variant="outline"
                disabled={isFetchingMore}
              >
                {isFetchingMore ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : null}
                Load More
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
