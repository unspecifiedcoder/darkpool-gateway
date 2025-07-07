import { defineChain } from 'viem';

export const scrollSepolia = defineChain({
  id: 534351,
  name: 'Scroll Sepolia',
  nativeCurrency: {
    name: 'Sepolia Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ['https://rpc.ankr.com/scroll_sepolia_testnet'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Scrollscan',
      url: 'https://sepolia.scrollscan.com',
    },
  },
  testnet: true,
});