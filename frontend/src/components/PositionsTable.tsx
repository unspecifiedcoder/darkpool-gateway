import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface Position {
  id: string;
  asset: string;
  type: 'Long' | 'Short';
  size: number;
  entryPrice: number;
  markPrice: number;
  margin: number;
  pnl: number;
  pnlPercent: number;
  liquidationPrice: number;
}

const mockPositions: Position[] = [
  {
    id: '1',
    asset: 'BTC/USDC',
    type: 'Long',
    size: 50000,
    entryPrice: 42500,
    markPrice: 43200,
    margin: 5000,
    pnl: 823.53,
    pnlPercent: 16.47,
    liquidationPrice: 38125,
  },
  {
    id: '2',
    asset: 'ETH/USDC',
    type: 'Long',
    size: 50000,
    entryPrice: 42500,
    markPrice: 43200,
    margin: 5000,
    pnl: 823.53,
    pnlPercent: 16.47,
    liquidationPrice: 38125,
  },
  {
    id: '3',
    asset: 'SOL/USDC',
    type: 'Long',
    size: 50000,
    entryPrice: 42500,
    markPrice: 43200,
    margin: 5000,
    pnl: 823.53,
    pnlPercent: 16.47,
    liquidationPrice: 38125,
  },
];

const PositionsTable = () => {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(value);
  };

  const formatPercent = (value: number) => {
    return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  return (
    <div className="glass-panel p-6 space-y-4">
      <h3 className="text-lg font-semibold text-glow">Open Positions</h3>
      
      {mockPositions.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>No open positions</p>
          <p className="text-sm">Start trading to see your positions here</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-3 px-2 text-muted-foreground">Asset</th>
                <th className="text-left py-3 px-2 text-muted-foreground">Type</th>
                <th className="text-right py-3 px-2 text-muted-foreground">Size</th>
                <th className="text-right py-3 px-2 text-muted-foreground">Entry Price</th>
                <th className="text-right py-3 px-2 text-muted-foreground">Mark Price</th>
                <th className="text-right py-3 px-2 text-muted-foreground">Margin</th>
                <th className="text-right py-3 px-2 text-muted-foreground">PnL</th>
                <th className="text-right py-3 px-2 text-muted-foreground">Liq. Price</th>
                <th className="text-center py-3 px-2 text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {mockPositions.map((position) => (
                <tr key={position.id} className="border-b border-border/50 hover:bg-primary/5">
                  <td className="py-4 px-2 font-mono">{position.asset}</td>
                  <td className="py-4 px-2">
                    <Badge 
                      variant={position.type === 'Long' ? 'default' : 'destructive'}
                      className={position.type === 'Long' ? 'bg-success/20 text-success' : 'bg-destructive/20 text-destructive'}
                    >
                      {position.type}
                    </Badge>
                  </td>
                  <td className="py-4 px-2 text-right font-mono">{formatCurrency(position.size)}</td>
                  <td className="py-4 px-2 text-right font-mono">{formatCurrency(position.entryPrice)}</td>
                  <td className="py-4 px-2 text-right font-mono">{formatCurrency(position.markPrice)}</td>
                  <td className="py-4 px-2 text-right font-mono">{formatCurrency(position.margin)}</td>
                  <td className={`py-4 px-2 text-right font-mono ${position.pnl >= 0 ? 'text-success' : 'text-destructive'}`}>
                    <div>
                      {formatCurrency(position.pnl)}
                    </div>
                    <div className="text-xs">
                      {formatPercent(position.pnlPercent)}
                    </div>
                  </td>
                  <td className="py-4 px-2 text-right font-mono">{formatCurrency(position.liquidationPrice)}</td>
                  <td className="py-4 px-2">
                    <div className="flex gap-2 justify-center">
                      <Button size="sm" variant="outline" className="text-xs">
                        Add Margin
                      </Button>
                      <Button size="sm" variant="destructive" className="text-xs">
                        Close
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default PositionsTable;