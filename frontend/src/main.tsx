import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// 1. Import Wagmi, RainbowKit, and our custom chain
import '@rainbow-me/rainbowkit/styles.css';
import { getDefaultConfig, RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppChain } from './lib/contracts.ts';

// 2. Set up the configuration
export const config = getDefaultConfig({
  appName: 'Dark Perps',
  projectId: 'a51c54dcf4240568bf0f1c1eea6822b1', // Get one from https://cloud.walletconnect.com
  chains: [AppChain],
  ssr: false, // For Vite, we disable server-side rendering
});

const queryClient = new QueryClient();

// 3. Wrap the App component with the providers
createRoot(document.getElementById('root')!).render(
  <WagmiProvider config={config}>
    <QueryClientProvider client={queryClient}>
      <RainbowKitProvider>
        <App />
      </RainbowKitProvider>
    </QueryClientProvider>
  </WagmiProvider>
);