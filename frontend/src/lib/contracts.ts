import faucetAbi from '../abi/PublicFaucet.json';
import usdcAbi from '../abi/MockERC20.json';
import clearingHouseAbi from '../abi/ClearingHouse.json';
import oracleAbi from '../abi/Oracle.json';
import privacyProxyAbi from '../abi/PrivacyProxy.json';
import tokenPoolAbi from '../abi/TokenPool.json';

// IMPORTANT: Replace these with your actual deployed contract addresses from Ignition
const FAUCET_ADDRESS = '0xC9a5D63fb19E335Af58faDbC572d4ED9877913b6' as const;
const USDC_ADDRESS = '0xD22B1172dd054d0B8c7eda52Beaa15FAa89BCBd1' as const;
const CLEARING_HOUSE_ADDRESS = '0x9a314B24Ee0dCEA04B9D06484fD17C958323beA5' as const;
const ORACLE_ADDRESS = '0xf07cc6482a24843efE7B42259ACBaF8d0a2a6952' as const;
const PRIVACY_PROXY_ADDRESS = '0xF8273Ab9FFCa30c1E2F188CB181885D9448E2E7b' as const;
const TOKEN_POOL_ADDRESS = '0x742Ce86B80Ce1b5e21D2f13852272caC96BD9713' as const;

export const contracts = {
  faucet: {
    address: FAUCET_ADDRESS,
    abi: faucetAbi.abi,
  },
  usdc: {
    address: USDC_ADDRESS,
    abi: usdcAbi.abi,
  },
  clearingHouse: {
    address: CLEARING_HOUSE_ADDRESS,
    abi: clearingHouseAbi.abi,
  },
  oracle: {
    address: ORACLE_ADDRESS,
    abi: oracleAbi.abi,
  },
  privacyProxy: {
    address: PRIVACY_PROXY_ADDRESS,
    abi: privacyProxyAbi.abi,
  },
  tokenPool: {
    address: TOKEN_POOL_ADDRESS,
    abi: tokenPoolAbi.abi,
  },
} as const;