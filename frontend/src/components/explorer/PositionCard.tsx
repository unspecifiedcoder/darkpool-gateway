import React from 'react';
import { motion } from 'framer-motion';
import { Copy, Check, Shield, Globe } from 'lucide-react';
import { RefreshTimer } from './RefreshTimer';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { Position, BasePositionData, HistoricalPositionData } from '@/lib/types';
import { formatUnits, Hex } from 'viem';
import { contracts } from '@/lib/contracts';
import { useReadContract, useReadContracts } from 'wagmi';
import { useOraclePrice } from '@/hooks/useOraclePrice';
import { Badge } from '../ui/badge';

// --- Constants ---
const PRICE_PRECISION = 10n ** 18n;
const MAINTENANCE_MARGIN_RATIO_BPS = 625n;
const BPS_DIVISOR = 10000n;

interface PositionCardProps {
  position: Position;
  onRefresh: () => void;
}

// --- Helper Components ---
const DataItem: React.FC<{ label: string; value?: string; children?: React.ReactNode; }> = ({ label, value, children }) => (
    <motion.div className="flex justify-between items-center border-b border-slate-700/50 pb-2">
        <span className="text-slate-400 text-sm">{label}</span>
        <div className="flex items-center text-slate-100 text-md">{value}{children}</div>
    </motion.div>
);

export const PositionCard: React.FC<PositionCardProps> = ({ position, onRefresh }) => {
  const [isIdCopied, copyId] = useCopyToClipboard();
  const [isOwnerCopied, copyOwner] = useCopyToClipboard();
  const { data: btcPrice } = useOraclePrice();

  // --- Live Data Hooks (only run if position is Open) ---
  const { data: onChainPositionData } = useReadContract({
    ...contracts.clearingHouse,
    functionName: 'positions',
    args: [position.data.position_id as Hex],
    query: { enabled: position.status === 'Open' },
  });

  const { data: pnlData } = useReadContracts({
    //@ts-ignore
    contracts: position.status === 'Open' ? [{
      ...contracts.clearingHouse,
      functionName: 'calculatePnl',
      args: [position.data.position_id as Hex],

    }] : [],
    query: { enabled: position.status === 'Open', refetchInterval: 15000 }
  });

  // --- Data Unification & Calculation ---
  const pnl = position.status === 'Open' ? (pnlData?.[0]?.result?.[0] ?? 0n) : BigInt((position.data as HistoricalPositionData).final_pnl);
  const owner_address = position.status === 'Open' ? onChainPositionData?.[0] : (position.data as HistoricalPositionData).owner_address;

  // match only first 5 characters of owner address
  const isPrivate = owner_address?.toLowerCase().slice(0, 5) === contracts.privacyProxy.address.toLowerCase().slice(0, 5);
  
  const positionValue = (BigInt(position.data.size) * BigInt(position.data.entry_price)) / PRICE_PRECISION;
  const leverage = BigInt(position.data.margin) > 0 ? Number(positionValue * 100n / BigInt(position.data.margin)) / 100 : 0;

  let liquidationPrice = 0n;
  if (position.status === 'Open' && btcPrice && BigInt(position.data.size) > 0n) {
    const totalEquity = BigInt(position.data.margin) + pnl;
    const positionValueAtMark = (BigInt(position.data.size) * (btcPrice as bigint)) / PRICE_PRECISION;
    const requiredMargin = (positionValueAtMark * MAINTENANCE_MARGIN_RATIO_BPS) / BPS_DIVISOR;
    const bufferUSDC = totalEquity - requiredMargin;
    const priceDelta = (bufferUSDC * PRICE_PRECISION) / BigInt(position.data.size);
    liquidationPrice = position.data.is_long ? (btcPrice as bigint) - priceDelta : (btcPrice as bigint) + priceDelta;
  }
  
  // --- UI Formatting ---
  const formatCurrency = (value: bigint | string) => `$${parseFloat(formatUnits(BigInt(value), 18)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="bg-black/40 border border-cyan-400/20 rounded-xl shadow-2xl p-6"
    >
      <div className="flex justify-between items-center mb-6">
        <h3 className="font-orbitron text-xl text-slate-100">Position Details</h3>
        {position.status === 'Open' && <RefreshTimer onRefresh={onRefresh} />}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5 font-roboto-mono">
        <DataItem label="Position ID" value={`${position.data.position_id.slice(0, 8)}...${position.data.position_id.slice(-6)}`}>
            <button onClick={() => copyId(position.data.position_id)} className="ml-2">{isIdCopied ? <Check size={16} className="text-success" /> : <Copy size={16} />}</button>
        </DataItem>

        <DataItem label="Owner" value={owner_address ? `${owner_address.slice(0, 6)}...${owner_address.slice(-4)}` : 'Loading...'}>
            <button onClick={() => copyOwner(owner_address ?? '')} className="ml-2">{isOwnerCopied ? <Check size={16} className="text-success" /> : <Copy size={16} />}</button>
        </DataItem>

        <DataItem label="Account Type">
          <Badge variant={isPrivate ? 'secondary' : 'default'} className="gap-2">
            {isPrivate ? <Shield size={14} /> : <Globe size={14} />}
            {isPrivate ? 'Private' : 'Public'}
          </Badge>
        </DataItem>

        <DataItem label="Side & Leverage">
            <Badge variant={position.data.is_long ? 'long' : 'short'}>
                {`${position.data.is_long ? 'LONG' : 'SHORT'} / ${leverage.toFixed(1)}x`}
            </Badge>
        </DataItem>
        
        <DataItem label="Size" value={`${parseFloat(formatUnits(BigInt(position.data.size), 18)).toFixed(4)} BTC`} />
        <DataItem label="Margin" value={`${formatCurrency(position.data.margin)} USDC`} />
        <DataItem label="Entry Price" value={formatCurrency(position.data.entry_price)} />
        
        <DataItem label={position.status === 'Open' ? "Current PnL" : "Final PnL"}>
          <span className={pnl >= 0n ? 'text-success' : 'text-destructive'}>{formatCurrency(pnl)}</span>
        </DataItem>
        
        {position.status === 'Open' && (
            <DataItem label="Liquidation Price">
                <span className="text-destructive">{formatCurrency(liquidationPrice)}</span>
            </DataItem>
        )}
        
        {position.status !== 'Open' && (
            <DataItem label="Status">
                <span className={position.data.status === 'Liquidated' ? 'text-destructive font-bold' : 'text-muted-foreground'}>{position.data.status}</span>
            </DataItem>
        )}
      </div>
    </motion.div>
  );
};