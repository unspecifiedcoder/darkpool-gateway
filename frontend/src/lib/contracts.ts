import faucetAbi from '../abi/PublicFaucet.json';
import usdcAbi from '../abi/MockERC20.json';
import clearingHouseAbi from '../abi/ClearingHouse.json';
import oracleAbi from '../abi/Oracle.json';

// IMPORTANT: Replace these with your actual deployed contract addresses from Ignition
const FAUCET_ADDRESS = '0x4bBc54263D0A3CB0B3800569a9f6D46C5D10F975' as const;
const USDC_ADDRESS = '0x82BE58578B6C69b3485add6602F28fDbd64674a9' as const;
const CLEARING_HOUSE_ADDRESS = '0x4f7B2853BE65D14f96039024EaADb1B4a6F27121' as const;
const ORACLE_ADDRESS = '0xb8621c3Ad857099B497C21264410ee0D32eACCF4' as const;

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
} as const;