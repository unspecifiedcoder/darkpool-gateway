import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import ManageMarginModal from './ManageMarginModal'; // Import the new modal
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { contracts } from '@/lib/contracts';
import { useOraclePrice } from '@/hooks/useOraclePrice';
import { formatUnits, formatEther } from 'viem';
import { toast } from 'sonner';

// --- Constants ---
const PRICE_PRECISION = 10n ** 18n;
const MAINTENANCE_MARGIN_RATIO_BPS = 625n;
const BPS_DIVISOR = 10000n;

const PositionsTable = () => {
  // --- Local UI State ---
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState<'add' | 'remove'>('add');

  // --- Wagmi Hooks ---
  const { address, isConnected } = useAccount();
  const { data: btcPrice } = useOraclePrice();

  // Hooks for reading on-chain data
  const { data: position, refetch: refetchPosition } = useReadContract({
    ...contracts.clearingHouse,
    functionName: 'positions',
    args: [address!],
    query: { enabled: isConnected },
  });
  const { data: pnlData, refetch: refetchPnl } = useReadContract({
    ...contracts.clearingHouse,
    functionName: 'calculatePnl',
    args: [address!],
    query: { enabled: isConnected && position && position[0] > 0n },
  });

  // Hooks for writing transactions (Close Position)
  const { data: closeHash, isPending: isClosing, writeContract: closePosition } = useWriteContract();
  const { isLoading: isConfirmingClose, isSuccess: isClosed } = useWaitForTransactionReceipt({ hash: closeHash });

  // --- Data Refetching ---
  const handleRefetch = () => {
    refetchPosition();
    refetchPnl();
    // In a real app, you would also refetch wallet/collateral balance via a shared state/context
  };

  useEffect(() => {
    if (isClosed) {
      toast.success("Position closed successfully!");
      handleRefetch();
    }
  }, [isClosed]);

  // --- Derived State and Calculations ---
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

  // --- UI Formatting ---
  const formatCurrency = (value: bigint) => `$${parseFloat(formatUnits(value, 18)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const formatNumber = (value: bigint) => parseFloat(formatUnits(value, 18)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const formatPercent = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;

  // --- Event Handlers ---
  const handleOpenModal = (type: 'add' | 'remove') => {
    setModalType(type);
    setIsModalOpen(true);
  };
  
  const handleClosePosition = () => {
    toast.info("Submitting close position transaction...");
    closePosition({
      ...contracts.clearingHouse, functionName: 'closePosition',
      chain: undefined,
      account: address
    });
  };

  return (
    <>
      <div className="glass-panel p-6 space-y-4">
        <h3 className="text-lg font-semibold text-glow">Open Position</h3>
        
        {!hasPosition ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>No open position</p>
            <p className="text-sm">Use the trade panel to open a new position</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-2">Asset</th>
                  <th className="text-left p-2">Type</th>
                  <th className="text-right p-2">Size (BTC)</th>
                  <th className="text-right p-2">Entry Price</th>
                  <th className="text-right p-2">Mark Price</th>
                  <th className="text-right p-2">Margin</th>
                  <th className="text-right p-2">PnL</th>
                  <th className="text-right p-2">Liq. Price</th>
                  <th className="text-center p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border/50">
                  <td className="p-2 font-mono">BTC/USDC</td>
                  <td className="p-2">
                    <Badge variant={position[3] ? 'long' : 'short'}>{position[3] ? 'Long' : 'Short'}</Badge>
                  </td>
                  <td className="p-2 text-right font-mono">{formatNumber(position[0])}</td>
                  <td className="p-2 text-right font-mono">{formatCurrency(position[2])}</td>
                  <td className="p-2 text-right font-mono">{btcPrice ? formatCurrency(btcPrice as bigint) : 'Loading...'}</td>
                  <td className="p-2 text-right font-mono">{formatCurrency(position[1])}</td>
                  <td className={`p-2 text-right font-mono ${pnl >= 0 ? 'text-success' : 'text-destructive'}`}>
                    <div>{formatCurrency(pnl)}</div>
                    <div className="text-xs">{formatPercent(pnlPercent)}</div>
                  </td>
                  <td className="p-2 text-right font-mono">{formatCurrency(liquidationPrice)}</td>
                  <td className="p-2">
                    <div className="flex gap-2 justify-center">
                      <Button size="sm" variant="outline" onClick={() => handleOpenModal('add')}>Add</Button>
                      <Button size="sm" variant="outline" onClick={() => handleOpenModal('remove')}>Remove</Button>
                      <Button size="sm" variant="destructive" onClick={handleClosePosition} disabled={isClosing || isConfirmingClose}>
                        {isClosing ? 'Closing...' : isConfirmingClose ? 'Confirming...' : 'Close'}
                      </Button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ManageMarginModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        type={modalType}
        onSuccess={handleRefetch}
      />
    </>
  );
};

export default PositionsTable;