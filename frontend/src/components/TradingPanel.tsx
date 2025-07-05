import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';

const TradingPanel = () => {
  const [margin, setMargin] = useState<string>('1000');
  const [leverage, setLeverage] = useState<number[]>([10]);
  const [tradeType, setTradeType] = useState<'long' | 'short'>('long');

  const walletBalance = 10000; // Mock data
  const freeCollateral = 8500; // Mock data
  const btcPrice = 43200; // Mock data

  const positionSize = parseFloat(margin) * leverage[0];
  const entryPrice = btcPrice;
  const liquidationPrice = tradeType === 'long' 
    ? entryPrice * (1 - (1 / leverage[0]) * 0.9)
    : entryPrice * (1 + (1 / leverage[0]) * 0.9);
  const tradingFee = positionSize * 0.001; // 0.1% fee

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(value);
  };

  return (
    <div className="space-y-6">
      {/* Wallet & Collateral Section */}
      <div className="glass-panel p-6 space-y-4">
        <h3 className="text-lg font-semibold text-glow">Wallet & Collateral</h3>
        
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Wallet Balance:</span>
            <span className="font-mono text-lg">{formatCurrency(walletBalance)}</span>
          </div>
          
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Free Collateral:</span>
            <span className="font-mono text-lg text-success">{formatCurrency(freeCollateral)}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Button variant="neon" className="w-full">
            Deposit
          </Button>
          <Button variant="outline" className="w-full">
            Withdraw
          </Button>
        </div>
      </div>

      {/* Trading Section */}
      <div className="glass-panel p-6 space-y-6">
        <h3 className="text-lg font-semibold text-glow">Trade Execution</h3>

        <Tabs value={tradeType} onValueChange={(value) => setTradeType(value as 'long' | 'short')}>
          <TabsList className="grid w-full grid-cols-2 bg-card/20">
            <TabsTrigger 
              value="long" 
              className="data-[state=active]:bg-success/20 data-[state=active]:text-success data-[state=active]:neon-border"
            >
              Long
            </TabsTrigger>
            <TabsTrigger 
              value="short"
              className="data-[state=active]:bg-destructive/20 data-[state=active]:text-destructive data-[state=active]:neon-border"
            >
              Short
            </TabsTrigger>
          </TabsList>

          <TabsContent value={tradeType} className="space-y-6 mt-6">
            {/* Margin Input */}
            <div className="space-y-2">
              <Label htmlFor="margin" className="text-sm text-muted-foreground">
                Margin (USDC)
              </Label>
              <Input
                id="margin"
                type="number"
                value={margin}
                onChange={(e) => setMargin(e.target.value)}
                className="bg-input/20 border-primary/30 focus:border-primary/60 font-mono text-lg"
                placeholder="Enter margin amount"
              />
            </div>

            {/* Leverage Slider */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <Label className="text-sm text-muted-foreground">Leverage</Label>
                <span className="text-lg font-mono text-primary">{leverage[0]}x</span>
              </div>
              <Slider
                value={leverage}
                onValueChange={setLeverage}
                max={100}
                min={1}
                step={1}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>1x</span>
                <span>25x</span>
                <span>50x</span>
                <span>100x</span>
              </div>
            </div>

            {/* Calculated Values */}
            <div className="space-y-3 p-4 bg-card/10 rounded-lg border border-primary/20">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Position Size:</span>
                <span className="font-mono">{formatCurrency(positionSize)}</span>
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Entry Price (est.):</span>
                <span className="font-mono">{formatCurrency(entryPrice)}</span>
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Liquidation Price (est.):</span>
                <span className="font-mono text-destructive">{formatCurrency(liquidationPrice)}</span>
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Trading Fee (est.):</span>
                <span className="font-mono">{formatCurrency(tradingFee)}</span>
              </div>
            </div>

            {/* Action Button */}
            <Button 
              variant={tradeType === 'long' ? 'long' : 'short'} 
              size="lg" 
              className="w-full text-lg font-semibold glitch-effect"
              onClick={() => console.log(`Opening ${tradeType} position`)}
            >
              Open {tradeType === 'long' ? 'Long' : 'Short'} Position
            </Button>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default TradingPanel;