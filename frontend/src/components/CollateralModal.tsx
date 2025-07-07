import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from '@/components/ui/dialog';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { contracts } from '@/lib/contracts';
import { parseUnits, formatUnits, maxUint256 } from 'viem';
import { toast } from 'sonner';
import { scrollSepolia } from 'viem/chains';

type ModalProps = {
    isOpen: boolean;
    onClose: () => void;
    type: 'deposit' | 'withdraw';
    onSuccess: () => void; // <-- Add the new prop
  };

const CollateralModal = ({ isOpen, onClose, type, onSuccess }: ModalProps) => {
  const [amount, setAmount] = useState('');
  const { address, isConnected } = useAccount();

  // --- Wagmi Hooks ---
  const { data: hash, error, isPending, writeContract, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

  // Read the current allowance the user has given to the ClearingHouse
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: contracts.usdc.address,
    abi: contracts.usdc.abi,
    functionName: 'allowance',
    args: [address!, contracts.clearingHouse.address],
    query: {
      enabled: isConnected && isOpen,
    },
  });

  const amountAsBigInt = amount ? parseUnits(amount, 18) : 0n;
  const needsApproval = type === 'deposit' && (allowance === undefined || allowance as bigint < amountAsBigInt);

  // --- Handlers ---
  const handleApprove = () => {
    writeContract({
      address: contracts.usdc.address,
      abi: contracts.usdc.abi,
      functionName: 'approve',
      args: [contracts.clearingHouse.address, maxUint256], // Approve a large amount for convenience
      chain: scrollSepolia,
      account: address,
    });
  };

  const handleDeposit = () => {
    writeContract({
      address: contracts.clearingHouse.address,
      abi: contracts.clearingHouse.abi,
      functionName: 'depositCollateral',
      args: [amountAsBigInt],
      chain: scrollSepolia,
      account: address,
    });
  };

  const handleWithdraw = () => {
    writeContract({
      address: contracts.clearingHouse.address,
      abi: contracts.clearingHouse.abi,
      functionName: 'withdrawCollateral',
      args: [amountAsBigInt],
      chain: scrollSepolia,
      account: address,
    });
  };

  // --- Transaction State Effect ---
  useEffect(() => {
    if (isConfirmed) {
      toast.success(`${type === 'deposit' ? 'Deposit' : 'Withdrawal'} successful!`, {
        description: `Transaction confirmed.`,
        action: {
            label: 'View Tx',
            onClick: () => window.open(`https://sepolia.scrollscan.com/tx/${hash}`, '_blank'),
        },
      });
      refetchAllowance(); // Refresh the allowance after a successful transaction
      onSuccess(); // Call the onSuccess callback
      reset(); // Reset the writeContract hook state
      onClose(); // Close the modal
    }
    if (error) {
      toast.error(`Transaction Failed`, {
        description: error.message,
      });
      reset();
    }
  }, [isConfirmed, error, hash, type, onClose, reset, refetchAllowance, onSuccess]);


  // --- Render Logic ---
  const renderButton = () => {
    if (type === 'deposit') {
      if (needsApproval) {
        return (
          <Button type="button" variant="neon" onClick={handleApprove} disabled={isPending || isConfirming}>
            {isPending ? 'Confirm...' : isConfirming ? 'Approving...' : 'Approve USDC'}
          </Button>
        );
      }
      return (
        <Button type="button" variant="neon" onClick={handleDeposit} disabled={isPending || isConfirming || !amount || parseFloat(amount) <= 0}>
          {isPending ? 'Confirm...' : isConfirming ? 'Depositing...' : 'Confirm Deposit'}
        </Button>
      );
    }
    // For withdrawal
    return (
      <Button type="button" variant="neon" onClick={handleWithdraw} disabled={isPending || isConfirming || !amount || parseFloat(amount) <= 0}>
        {isPending ? 'Confirm...' : isConfirming ? 'Withdrawing...' : 'Confirm Withdraw'}
      </Button>
    );
  };

  const title = type === 'deposit' ? 'Deposit Collateral' : 'Withdraw Collateral';
  const description = type === 'deposit' 
    ? 'Move USDC from your wallet to your trading account.'
    : 'Move USDC from your trading account back to your wallet.';

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md glass-panel border-primary/30">
        <DialogHeader>
          <DialogTitle className="text-glow">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="collateral-amount">Amount (USDC)</Label>
            <Input
              id="collateral-amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="bg-input/20 border-primary/30 focus:border-primary/60 font-mono"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending || isConfirming}>
            Cancel
          </Button>
          {renderButton()}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CollateralModal;