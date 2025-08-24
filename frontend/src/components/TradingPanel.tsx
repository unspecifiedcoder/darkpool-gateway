import { useState, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { CollateralModal } from "./CollateralModal";
import {
  useAccount,
  useBalance,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { AppChain, contracts } from "@/lib/contracts";
import { formatUnits, Hex, parseUnits, toHex } from "viem";
import { useOraclePrice } from "@/hooks/useOraclePrice";
import { toast } from "sonner";
import { useAppActions, useAppStore } from "@/store/useAppStore";
import { ethers } from "ethers";
import { RefreshCw } from "lucide-react";

// --- Constants from Smart Contracts ---
const LEVERAGE_PRECISION = 100n;
const TAKER_FEE_BPS = 10n;
const BPS_DIVISOR = 10000n;
const PRICE_PRECISION = 10n ** 18n;
const MAINTENANCE_MARGIN_RATIO_BPS = 245n;

const TradingPanel = () => {
  // --- Local UI State ---
  const [margin, setMargin] = useState<string>("100");
  const [leverage, setLeverage] = useState<number[]>([10]);
  const [tradeType, setTradeType] = useState<"long" | "short">("long");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState<"deposit" | "withdraw">("deposit");

  // --- Global & Wagmi State ---
  const { tradingMode, userClient, refetchSignal } = useAppStore();
  const { triggerRefetch } = useAppActions();
  const { address, isConnected } = useAccount();
  const { data: btcPrice } = useOraclePrice();

  // --- Transaction Hooks ---
  const [openingPositionHash, setOpeningPositionHash] = useState<Hex | undefined>();
  
  // This is our main write hook that all actions will use
  const { isPending, writeContract, reset } = useWriteContract();
  
  // This hook ONLY watches for the confirmation of our specific "open position" transaction
  const { 
    data: receipt, 
    isLoading: isConfirming, 
    isSuccess: isConfirmed, 
    error: txError 
  } = useWaitForTransactionReceipt({ hash: openingPositionHash });



  // --- Data Fetching (Dynamic based on tradingMode) ---
  const isPrivateMode = tradingMode === "Private" && !!userClient;

  // Wallet Balance Hooks
  const {
    data: eoaUsdcBalance,
    refetch: refetchEoaBalance,
    isFetching: isEoaBalanceFetching,
  } = useBalance({ address, token: contracts.usdc.address });
  const privateUsdcBalance = userClient?.currentMetadata?.commitment_info
    ? BigInt(userClient.currentMetadata.commitment_info.value)
    : 0n;

  // Collateral Hooks
  const {
    data: publicFreeCollateral,
    refetch: refetchPublicCollateral,
    isFetching: isPublicCollateralFetching,
  } = useReadContract({
    ...contracts.clearingHouse,
    functionName: "freeCollateral",
    args: [address!],
    query: { enabled: isConnected && !isPrivateMode },
  });
  const {
    data: privateFreeCollateral,
    refetch: refetchPrivateCollateral,
    isFetching: isPrivateCollateralFetching,
  } = useReadContract({
    ...contracts.privacyProxy,
    functionName: "userFreeCollateral",
    args: [userClient?.pubKey!],
    query: { enabled: isConnected && isPrivateMode },
  });

  // --- State Selection Logic ---
  const walletBalance = isPrivateMode
    ? privateUsdcBalance
    : eoaUsdcBalance?.value ?? 0n;
  const freeCollateral = isPrivateMode
    ? privateFreeCollateral
    : publicFreeCollateral;

  // --- Refetching ---
  const handleRefetchAll = useCallback(() => {
    refetchEoaBalance();
    if (tradingMode === "Private" && userClient) {
      refetchPrivateCollateral();
      userClient.fetchAndSetMetadata();
    } else {
      refetchPublicCollateral();
    }
  }, [tradingMode, userClient, refetchEoaBalance, refetchPrivateCollateral, refetchPublicCollateral]);
  

  useEffect(() => {
    if (refetchSignal > 0) {
      handleRefetchAll();
    }
  }, [refetchSignal]);

  useEffect(() => {
    let didRun = false;

    if (isConfirmed && receipt && !didRun) {
      didRun = true;
      console.log("CONFIRMED: Transaction receipt received. Starting post-confirmation logic.");
      toast.success("Position opened successfully! Refreshing positions list in 5s...");
      
      handleRefetchAll();

      const timer = setTimeout(() => {
        console.log("TIMER: 10 seconds elapsed. Triggering global refetch via store.");
        useAppStore.getState().actions.triggerRefetch();

        console.log("CLEANUP: Resetting transaction state now.");
        reset();
        setOpeningPositionHash(undefined);

      }, 10000);

      return () => {
        console.log("COMPONENT UNMOUNT/RE-RUN: Clearing timeout.");
        clearTimeout(timer);
      };
    }

    if (txError) {
      toast.error("Open Position Failed", { description: txError.message });
      reset();
      setOpeningPositionHash(undefined);
    }
  }, [isConfirmed, txError, receipt, handleRefetchAll, reset]); 

  


  const isRefetching =
    isEoaBalanceFetching ||
    isPrivateCollateralFetching ||
    isPublicCollateralFetching;

  // --- Derived State and Calculations ---
  const marginAsBigInt = useMemo(
    () => (margin ? parseUnits(margin, 18) : 0n),
    [margin]
  );
  const leverageAsBigInt = useMemo(
    () => BigInt(leverage[0]) * LEVERAGE_PRECISION,
    [leverage]
  );

  const { positionValue, tradingFee, liquidationPrice } = useMemo(() => {
    const posVal = (marginAsBigInt * leverageAsBigInt) / LEVERAGE_PRECISION;
    const fee = (posVal * TAKER_FEE_BPS) / BPS_DIVISOR;
    let liqPrice = 0n;

    if (btcPrice && posVal > 0n) {
      const marginAfterFee = marginAsBigInt > fee ? marginAsBigInt - fee : 0n;
      // This formula calculates the price movement required to hit the maintenance margin threshold
      const priceChangePerUnit = (marginAfterFee * PRICE_PRECISION) / posVal;
      const maintenanceMarginPerUnit =
        (MAINTENANCE_MARGIN_RATIO_BPS * PRICE_PRECISION) / BPS_DIVISOR;
      const priceBuffer =
        ((priceChangePerUnit - maintenanceMarginPerUnit) *
          (btcPrice as bigint)) /
        PRICE_PRECISION;

      if (tradeType === "long") {
        liqPrice = (btcPrice as bigint) - priceBuffer;
      } else {
        liqPrice = (btcPrice as bigint) + priceBuffer;
      }
    }
    return {
      positionValue: posVal,
      tradingFee: fee,
      liquidationPrice: liqPrice,
    };
  }, [marginAsBigInt, leverageAsBigInt, btcPrice, tradeType]);

  // --- UI Formatting ---
  const formatCurrency = (value: bigint) => {
    const formatted = formatUnits(value, 18);
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(parseFloat(formatted));
  };
  const formattedWalletBalance = formatCurrency(walletBalance);
  const formattedFreeCollateral = formatCurrency(
    (freeCollateral as bigint) ?? 0n
  );

  // --- Button Handlers and Disabled Logic ---
  const handleOpenModal = (type: "deposit" | "withdraw") => {
    setModalType(type);
    setIsModalOpen(true);
  };

  const handleOpenPosition = async () => {
    const positionId = ethers.randomBytes(32);
    const toastId = toast.loading("Preparing transaction...");
    console.log("Trading type: ", tradeType , tradeType === "long" , leverageAsBigInt);
    console.log("Is private mode: ", isPrivateMode);

    if (isPrivateMode) {
      try {
        toast.info("Please sign the message to authorize the private trade.", { id: toastId });
        const msgHash = ethers.solidityPackedKeccak256(
          ["string", "bytes32", "uint256", "uint256", "bool"],
          ["OPEN_POSITION", toHex(positionId), marginAsBigInt, leverageAsBigInt, tradeType === "long"]
        );
        const signature = await userClient.secretWallet.signMessage(ethers.getBytes(msgHash));
        
        writeContract({
          ...contracts.privacyProxy,
          functionName: "openPosition",
          args: [userClient.pubKey, toHex(positionId), marginAsBigInt, leverageAsBigInt, tradeType === "long", signature],
          chain: AppChain,
          account: address,
        }, {
          onSuccess: (hash) => {
            toast.info("Submitting private transaction...", { id: toastId });
            setOpeningPositionHash(hash); 
          },
          onError: (err) => toast.error("Transaction failed", { id: toastId, description: err.message }),
        });
      } catch (e) {
        toast.error("Signature rejected.", { id: toastId });
      }
    } else { // Public Mode
      toast.info("Please confirm the transaction in your wallet.", { id: toastId });
      console.log("args: ", [toHex(positionId), marginAsBigInt, leverageAsBigInt, tradeType === "long"]);
      writeContract({
        ...contracts.clearingHouse,
        functionName: "openPosition",
        args: [toHex(positionId), marginAsBigInt, leverageAsBigInt, tradeType === "long"],
        chain: AppChain,
        account: address,
      }, {
        onSuccess: (hash) => {
          toast.info("Submitting public transaction...", { id: toastId });
          setOpeningPositionHash(hash); 
        },
        onError: (err) => toast.error("Transaction failed", { id: toastId, description: err.message }),
      });
    }
  };

  const canAffordMargin = freeCollateral
    ? (freeCollateral as bigint) >= marginAsBigInt
    : false;
  const openPositionDisabled =
    !isConnected ||
    isPending ||
    isConfirming ||
    !canAffordMargin ||
    marginAsBigInt <= 0n;

  return (
    <>
      <div className="space-y-6">
        {/* Wallet & Collateral Section */}
        <div className="glass-panel p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold text-glow">
              {tradingMode} Account
            </h3>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRefetchAll}
              disabled={isRefetching}
              className="text-muted-foreground hover:text-primary"
            >
              <RefreshCw className={`w-4 h-4 ${isRefetching ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">
                {isPrivateMode ? "Private Balance:" : "Wallet (USDC):"}
              </span>
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
          <h3 className="text-lg font-semibold text-glow">
            Trade Execution ({tradingMode} Mode)
          </h3>
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
                  max={38}
                  min={1}
                  step={1}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>1x</span>
                  <span>10x</span>
                  <span>20x</span>
                  <span>38x</span>
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
                    {btcPrice
                      ? formatCurrency(btcPrice as bigint)
                      : "Loading..."}
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
                  ? "Confirming..."
                  : isConfirming
                  ? "Processing..."
                  : `Open ${tradeType} (${tradingMode})`}
              </Button>
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
