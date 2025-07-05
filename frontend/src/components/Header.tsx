import { Button } from '@/components/ui/button';
import { Wallet } from 'lucide-react';
import XythumPerpsLogo from '@/assets/xythum-icon.jpg';

const Header = () => {
  const isConnected = false; // This will be replaced with actual wallet connection state
  const address = "0x1234...5678"; // Mock address for now

  return (
    <header className="flex items-center justify-between p-6 glass-panel border-b border-primary/20">
      <div className="flex items-center gap-4">
        <div className="flex items-center pulse-neon rounded-lg gap-3">
          <img 
            src={XythumPerpsLogo} 
            alt="AstraPerps Logo" 
            className="w-14 h-14 rounded-lg"
          />
          <div className="text-2xl font-bold  px-4 py-3 rounded-lg">
            <span className="text-primary">Dark {" "}</span>
            <span className="text-accent">Perps</span>
          </div>
        </div>
        <div className="text-xs text-muted-foreground bg-accent/20 px-2 py-1 rounded-md border border-accent/30">
          TESTNET
        </div>
      </div>

      <div className="flex items-center gap-4">
        {isConnected ? (
          <div className="flex items-center gap-3 glass-panel px-4 py-2 neon-border">
            <div className="w-2 h-2 bg-success rounded-full animate-pulse"></div>
            <span className="text-sm font-mono">{address}</span>
          </div>
        ) : (
          <Button variant="neon" className="gap-2">
            <Wallet className="w-4 h-4" />
            Connect Wallet
          </Button>
        )}
      </div>
    </header>
  );
};

export default Header;