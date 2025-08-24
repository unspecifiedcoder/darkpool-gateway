import XythumPerpsLogo from "@/assets/xythum-icon.jpg";
import { CustomConnectButton } from "./CustomConnectButton";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";  
import { useAppStore, useAppActions, TradingMode } from "@/store/useAppStore";
import { useAccount, useSignMessage, useChainId, useSwitchChain } from "wagmi"; 
import { AlertTriangle } from "lucide-react"; 
import { AppChain } from "@/lib/contracts";

const Header = () => {
  const { tradingMode, isLoadingClient } = useAppStore();
  const { initializeUserClient, setTradingMode } = useAppActions();

  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const chainId = useChainId(); 
  const { switchChain } = useSwitchChain(); 
  const isOnWrongNetwork = isConnected && chainId !== AppChain.id;

  const handleModeChange = (isPrivate: boolean) => {
    const newMode: TradingMode = isPrivate ? "Private" : "Public";
    if (newMode === "Private" && isConnected && address) {
      initializeUserClient(address, signMessageAsync);
    } else {
      setTradingMode(newMode);
    }
  };

  return (
    <header className="flex items-center justify-between p-6 glass-panel border-b border-primary/20">
      <div className="flex items-center gap-4">
        <div className="flex items-center pulse-neon rounded-lg gap-3">
          <img src={XythumPerpsLogo} alt="DarkPerps Logo" className="w-14 h-14 rounded-lg" />
          <div className="text-2xl font-bold px-4 py-3 rounded-lg">
            <span className="text-primary">Dark </span>
            <span className="text-accent">Perps</span>
          </div>
        </div>
        <div className="text-xs text-muted-foreground bg-accent/20 px-2 py-1 rounded-md border border-accent/30">
          OP BNB
        </div>
      </div>

      <div className="flex items-center gap-6">
        {!isConnected ? (
          <CustomConnectButton />
        ) : isOnWrongNetwork ? (
          <Button
            variant="destructive"
            onClick={() => switchChain({ chainId: AppChain.id })}
            className="gap-2"
          >
            <AlertTriangle className="w-4 h-4" />
            Switch to OP BNB
          </Button>
        ) : (
          <div className="flex items-center gap-4">
            <div className="flex items-center space-x-2">
              <Label htmlFor="trading-mode" className="text-muted-foreground">Public</Label>
              <Switch
                id="trading-mode"
                checked={tradingMode === "Private"}
                onCheckedChange={handleModeChange}
                disabled={isLoadingClient}
                className="data-[state=checked]:bg-primary"
              />
              <Label htmlFor="trading-mode" className="text-primary font-bold">Private</Label>
            </div>
            
            <CustomConnectButton />
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;