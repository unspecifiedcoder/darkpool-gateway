import { useReadContract } from 'wagmi';
import { contracts } from '@/lib/contracts';
import oracleAbi from '@/abi/Oracle.json'; // Make sure path is correct

export const useOraclePrice = () => {
  return useReadContract({
    address: contracts.oracle.address,
    abi: oracleAbi.abi,
    functionName: 'getPrice',
    query: {
      // Refetch the price every 10 seconds to keep it fresh
      refetchInterval: 10000,
    },
  });
};