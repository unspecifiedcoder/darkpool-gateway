import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import CollateralModal from "./CollateralModal";
import {
  useAccount,
  useBalance,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { contracts } from "@/lib/contracts";
import { formatUnits, parseUnits } from "viem";
import { useOraclePrice } from "@/hooks/useOraclePrice"; // Import our new hook
import { toast } from "sonner";
import { scrollSepolia } from "viem/chains";

// --- Constants from our Smart Contract ---
const LEVERAGE_PRECISION = 100n;
const TAKER_FEE_BPS = 10n;
const BPS_DIVISOR = 10000n;
const PRICE_PRECISION = 10n ** 18n;
const MAINTENANCE_MARGIN_RATIO_BPS = 625n;

const TradingPanel = () => {
  // Local UI state
  const [margin, setMargin] = useState<string>("1000");
  const [leverage, setLeverage] = useState<number[]>([10]);
  const [tradeType, setTradeType] = useState<"long" | "short">("long");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState<"deposit" | "withdraw">("deposit");

  // --- Wagmi Hooks for live data ---
  const { address, isConnected } = useAccount();
  const { data: btcPrice, isLoading: isPriceLoading } = useOraclePrice();

  const { data: usdcBalance, refetch: refetchUsdcBalance } = useBalance({
    address,
    token: contracts.usdc.address,
    query: { refetchInterval: 10000 },
  });
  const { data: freeCollateral, refetch: refetchFreeCollateral } =
    useReadContract({
      ...contracts.clearingHouse,
      functionName: "freeCollateral",
      args: [address!],
      query: { enabled: isConnected, refetchInterval: 10000 },
    });
  const { data: existingPosition, refetch: refetchPosition } = useReadContract({
    ...contracts.clearingHouse,
    functionName: "positions",
    args: [address!],
    query: { enabled: isConnected, refetchInterval: 10000 },
  });

  // --- Transaction Hook ---
  const { data: hash, isPending, writeContract } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash });

  // --- Refetching Logic ---
  const handleRefetchAll = () => {
    refetchUsdcBalance();
    refetchFreeCollateral();
    refetchPosition();
  };

  useEffect(() => {
    if (isConfirmed) {
      toast.success("Position opened successfully!");
      handleRefetchAll();
    }
  }, [isConfirmed]);

  // --- Derived State and Calculations ---
  const marginAsBigInt = margin ? parseUnits(margin, 18) : 0n;
  const leverageAsBigInt = BigInt(leverage[0]) * LEVERAGE_PRECISION;
  const positionValue =
    (marginAsBigInt * leverageAsBigInt) / LEVERAGE_PRECISION;
  const tradingFee = (positionValue * TAKER_FEE_BPS) / BPS_DIVISOR;

  let liquidationPrice = 0n;
  if (btcPrice && positionValue > 0n) {
    const marginAfterFee =
      marginAsBigInt > tradingFee ? marginAsBigInt - tradingFee : 0n;
    // Liq Price = EntryPrice +/- (MarginAfterFee - MaintenanceMargin) / Size
    // Simplified: Liq Price = EntryPrice * (1 +/- (InitialMarginRatio - MaintenanceMarginRatio))
    const priceChange =
      (btcPrice *
        ((marginAfterFee * PRICE_PRECISION) / positionValue -
          (MAINTENANCE_MARGIN_RATIO_BPS * PRICE_PRECISION) / BPS_DIVISOR)) /
      PRICE_PRECISION;
    if (tradeType === "long") {
      liquidationPrice = btcPrice - priceChange;
    } else {
      liquidationPrice = btcPrice + priceChange;
    }
  }

  // --- UI Formatting ---
  const formatCurrency = (value: bigint | number, decimals = 18) => {
    const valueAsBigInt = typeof value === "number" ? BigInt(value) : value;
    const formatted = formatUnits(valueAsBigInt, decimals);
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(parseFloat(formatted));
  };

  const formattedWalletBalance = usdcBalance
    ? formatCurrency(usdcBalance.value)
    : formatCurrency(0);
  const formattedFreeCollateral = freeCollateral
    ? formatCurrency(freeCollateral as bigint)
    : formatCurrency(0);

  // --- Button Handlers ---
  const handleOpenModal = (type: "deposit" | "withdraw") => {
    setModalType(type);
    setIsModalOpen(true);
  };

  const handleOpenPosition = () => {
    writeContract({
      ...contracts.clearingHouse,
      functionName: "openPosition",
      args: [marginAsBigInt, leverageAsBigInt, tradeType === "long"],
      chain: scrollSepolia,
      account: address!,
    });
  };

  const hasExistingPosition = existingPosition
    ? existingPosition[0] > 0n
    : false;
  const canAffordMargin = freeCollateral
    ? (freeCollateral as bigint) >= marginAsBigInt
    : false;
  const openPositionDisabled =
    !isConnected ||
    isPending ||
    isConfirming ||
    hasExistingPosition ||
    !canAffordMargin ||
    marginAsBigInt <= 0n;

  return (
    <>
      <div className="space-y-6">
        {/* Wallet & Collateral Section */}
        <div className="glass-panel p-6 space-y-4">
          <h3 className="text-lg font-semibold text-glow">
            Wallet & Collateral
          </h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Wallet (USDC):</span>
              <span className="font-mono text-lg">
                {formattedWalletBalance}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Free Collateral:</span>
              <span className="font-mono text-lg text-success">
                {formattedFreeCollateral}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="neon"
              onClick={() => handleOpenModal("deposit")}
              disabled={!isConnected}
            >
              Deposit
            </Button>
            <Button
              variant="outline"
              onClick={() => handleOpenModal("withdraw")}
              disabled={!isConnected}
            >
              Withdraw
            </Button>
          </div>
        </div>

        {/* Trading Section */}
        <div className="glass-panel p-6 space-y-6">
          <h3 className="text-lg font-semibold text-glow">Trade Execution</h3>
          <Tabs
            value={tradeType}
            onValueChange={(value) => setTradeType(value as "long" | "short")}
          >
            <TabsList className="grid w-full grid-cols-2 bg-card/20">
              <TabsTrigger
                value="long"
                className="data-[state=active]:bg-success/20 data-[state=active]:text-success"
              >
                Long
              </TabsTrigger>
              <TabsTrigger
                value="short"
                className="data-[state=active]:bg-destructive/20 data-[state=active]:text-destructive"
              >
                Short
              </TabsTrigger>
            </TabsList>
            <TabsContent value={tradeType} className="space-y-6 mt-6">
              <div className="space-y-2">
                <Label htmlFor="margin">Margin (USDC)</Label>
                <Input
                  id="margin"
                  type="number"
                  value={margin}
                  onChange={(e) => setMargin(e.target.value)}
                />
              </div>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <Label>Leverage</Label>
                  <span className="text-lg font-mono text-primary">
                    {leverage[0]}x
                  </span>
                </div>
                <Slider
                  value={leverage}
                  onValueChange={setLeverage}
                  max={20}
                  min={1}
                  step={1}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>1x</span>
                  <span>5x</span>
                  <span>10x</span>
                  <span>15x</span>
                  <span>20x</span>
                </div>
              </div>
              <div className="space-y-3 p-4 bg-card/10 rounded-lg">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Position Size:</span>
                  <span className="font-mono">
                    {formatCurrency(positionValue)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Entry Price (est.):
                  </span>
                  <span className="font-mono">
                    {isPriceLoading
                      ? "Loading..."
                      : formatCurrency(btcPrice || 0n)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Liq. Price (est.):
                  </span>
                  <span className="font-mono text-destructive">
                    {formatCurrency(liquidationPrice)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Trading Fee (est.):
                  </span>
                  <span className="font-mono">
                    {formatCurrency(tradingFee)}
                  </span>
                </div>
              </div>
              <Button
                onClick={handleOpenPosition}
                disabled={openPositionDisabled}
                variant={tradeType === "long" ? "long" : "short"}
                size="lg"
                className="w-full"
              >
                {isPending
                  ? "Confirm..."
                  : isConfirming
                  ? "Opening..."
                  : `Open ${tradeType === "long" ? "Long" : "Short"}`}
              </Button>
              {hasExistingPosition && (
                <p className="text-center text-destructive text-sm">
                  You already have an open position.
                </p>
              )}
              {!canAffordMargin && marginAsBigInt > 0n && (
                <p className="text-center text-destructive text-sm">
                  Insufficient free collateral.
                </p>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
      <CollateralModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        type={modalType}
        onSuccess={handleRefetchAll}
      />
    </>
  );
};

export default TradingPanel;
