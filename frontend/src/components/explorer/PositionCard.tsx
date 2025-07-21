
import React from 'react';
import { motion } from 'framer-motion';
import { Copy, Check } from 'lucide-react';
import { RefreshTimer } from './RefreshTimer';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { Position } from '@/lib/types';
import { formatAsset, formatCurrency, formatCurrency_, formatPnl, shortenId } from '@/lib/utils';

interface PositionCardProps {
  position: Position;
  onRefresh: () => void;
}

const cardVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.07,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0 },
};

export const PositionCard: React.FC<PositionCardProps> = ({ position, onRefresh }) => {
  console.log("positionnn", position);
  const [isCopied, copy] = useCopyToClipboard();

  const handleCopy = () => {
    copy(position.data.position_id);
  };
  
  const typeClassName = position.data.is_long ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400';
  const statusClassName = position.status === 'Open' ? 'text-[#00ff87]' : 'text-slate-400';
  const pnlInfo = 'final_pnl' in position.data ? formatPnl(position.data.final_pnl) : formatPnl(position.data.pnl);

  return (
    <motion.div
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      className="bg-black/40 border border-cyan-400/20 rounded-xl shadow-2xl shadow-cyan-500/10 backdrop-blur-xl p-6"
    >
      <motion.div variants={itemVariants} className="flex justify-between items-center mb-6">
        <h3 className="font-orbitron text-xl text-slate-100">Position Details</h3>
        {position.status === 'Open' && <RefreshTimer onRefresh={onRefresh} />}
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5 font-roboto-mono">
        <DataItem label="Position ID" value={shortenId(position.data.position_id)}>
            <button onClick={handleCopy} aria-label="Copy Position ID" className="ml-2 text-slate-400 hover:text-cyan-400 transition-colors">
                {isCopied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
            </button>
        </DataItem>

        <DataItem label="Status">
            <span className={statusClassName}>{position.status}</span>
        </DataItem>

        <DataItem label="Type">
          <span className={`px-2 py-1 text-sm rounded-md font-bold ${typeClassName}`}>
            {position.data.is_long ? 'LONG' : 'SHORT'}
          </span>
        </DataItem>
        
        <DataItem label="Size" value={`${formatAsset(position.data.size)} BTC`} />
        
        <DataItem label="Margin" value={`${formatCurrency(position.data.margin, 18)} USDC`} />

        <DataItem label="Entry Price" value={formatCurrency_(BigInt(position.data.entry_price))} />
        
        { 'pnl' in position.data &&
            <DataItem label="Current PnL">
              <span className={pnlInfo.className}>{pnlInfo.text} USDC</span>
            </DataItem>
        }

        { 'final_pnl' in position.data &&
            <DataItem label="Final PnL">
              <span className={pnlInfo.className}>{pnlInfo.text} USDC</span>
            </DataItem>
        }
        
        { position.status === 'Open' && 'liquidation_price' in position.data &&
            <DataItem label="Liquidation Price">
                <span className="text-[#ff2d55]">{formatCurrency(position.data.liquidation_price, 8)}</span>
            </DataItem>
        }

        { position.status === 'Liquidated' &&
            <DataItem label="">
                <span className="text-xl font-bold text-[#ff2d55] animate-pulse">LIQUIDATED</span>
            </DataItem>
        }

      </div>
    </motion.div>
  );
};

interface DataItemProps {
    label: string;
    value?: string;
    children?: React.ReactNode;
}

const DataItem: React.FC<DataItemProps> = ({ label, value, children }) => (
    <motion.div variants={itemVariants} className="flex justify-between items-center border-b border-slate-700/50 pb-2">
        <span className="text-slate-400 text-sm">{label}</span>
        <div className="flex items-center">
            {value && <span className="text-slate-100 text-md">{value}</span>}
            {children}
        </div>
    </motion.div>
);
