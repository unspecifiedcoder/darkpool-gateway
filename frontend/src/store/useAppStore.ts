import { create } from 'zustand';
import { useAccount, useSignMessage } from 'wagmi';
import { UserClient } from '@/lib/UserClient';

export type TradingMode = 'Public' | 'Private';

interface AppState {
  tradingMode: TradingMode;
  userClient: UserClient | null;
  isLoadingClient: boolean;
  refetchSignal: number;
  actions: {
    setTradingMode: (mode: TradingMode) => void;
    initializeUserClient: (signer: ReturnType<typeof useAccount>['address'], signMessageAsync: ReturnType<typeof useSignMessage>['signMessageAsync']) => Promise<void>;
    disconnectUserClient: () => void;
    triggerRefetch: () => void;
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  tradingMode: 'Public',
  userClient: null,
  isLoadingClient: false,
  refetchSignal: 0,
  actions: {
    setTradingMode: (mode) => {
      console.log(`Switching trading mode to: ${mode}`);
      set({ tradingMode: mode });
    },
    initializeUserClient: async (signerAddress, signMessageAsync) => {
        if (!signerAddress) return;
        
        set({ isLoadingClient: true });
        console.log("Initializing UserClient...");

        try {
            const client = await UserClient.create(signerAddress, signMessageAsync);
            set({ userClient: client, tradingMode: 'Private', isLoadingClient: false });
            console.log("UserClient initialized successfully.");
        } catch (error) {
            console.error("Failed to initialize UserClient:", error);
            set({ isLoadingClient: false, tradingMode: 'Public' });
        }
    },
    disconnectUserClient: () => {
        console.log("Disconnecting UserClient and switching to Public mode.");
        set({ userClient: null, tradingMode: 'Public' });
    },
    triggerRefetch: () => {
      console.log("Global refetch signal triggered.");
      set({ refetchSignal: get().refetchSignal + 1 });
    }
  },
}));


export const useAppActions = () => useAppStore((state) => state.actions);