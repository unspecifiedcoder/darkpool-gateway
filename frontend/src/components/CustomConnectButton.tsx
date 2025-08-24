import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Button } from '@/components/ui/button';
import { Wallet } from 'lucide-react';
import { AppChain } from '@/lib/contracts';

export const CustomConnectButton = () => {
  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openAccountModal,
        openChainModal,
        openConnectModal,
        authenticationStatus,
        mounted,
      }) => {
        const ready = mounted && authenticationStatus !== 'loading';
        const connected = ready && account && chain;

        return (
          <div {...(!ready && { 'aria-hidden': true, style: { opacity: 0, pointerEvents: 'none', userSelect: 'none' } })}>
            {(() => {
              if (!connected) {
                return (
                  <Button onClick={openConnectModal} variant="neon" className="gap-2">
                    <Wallet className="w-4 h-4" />
                    Connect Wallet
                  </Button>
                );
              }

              if (chain.id !== AppChain.id) {
                return (
                  <Button onClick={openChainModal} variant="destructive" className="gap-2">
                    Wrong Network
                  </Button>
                );
              }

              return (
                <div className="flex items-center gap-3">
                  <button
                    onClick={openChainModal}
                    className="glass-panel px-3 py-2 text-sm font-mono neon-border hover:bg-primary/10 transition-colors flex"
                    type="button"
                  >
                    {chain.hasIcon && (
                      <div style={{ background: chain.iconBackground, borderRadius: 999, overflow: 'hidden', marginRight: 8, height: 18, width: 18 }}>
                        {chain.iconUrl && <img alt={chain.name ?? 'Chain icon'} src={chain.iconUrl} style={{ width: 18, height: 18 }} />}
                      </div>
                    )}
                    {chain.name}
                  </button>
                  <button
                    onClick={openAccountModal}
                    type="button"
                    className="flex items-center gap-3 glass-panel px-4 py-2 neon-border hover:bg-primary/10 transition-colors"
                  >
                    <div className="w-2 h-2 bg-success rounded-full animate-pulse"></div>
                    <span className="text-sm font-mono">{account.displayName}</span>
                  </button>
                </div>
              );
            })()}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
};