import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi';
import { contracts } from '@/lib/contracts';
import { parseUnits, Hex } from 'viem';
import { toast } from 'sonner';
import { useAppStore } from '@/store/useAppStore';
import { scrollSepolia } from 'viem/chains';
import { ethers } from 'ethers';

type ModalProps = {
  positionId: Hex | null; // Pass the specific position to manage
  onClose: () => void;
  onSuccess: () => void;
  type: 'add' | 'remove';
};

export const ManageMarginModal = ({ positionId, onClose, onSuccess, type }: ModalProps) => {
  const [amount, setAmount] = useState('');
  const { tradingMode, userClient } = useAppStore();
  const { address } = useAccount();

  const { data: hash, isPending, writeContract, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed, error: txError } = useWaitForTransactionReceipt({ hash });

  const handleSubmit = async () => {
    if (!positionId) return toast.error("No position selected.");
    const amountAsBigInt = parseUnits(amount, 18);
    const toastId = toast.loading("Preparing transaction...");

    if (tradingMode === 'Private') {
      if (!userClient) return toast.error("Private client not initialized.", { id: toastId });
      try {
        toast.info("Please sign the message to authorize.", { id: toastId });
        const actionString = type === 'add' ? "ADD_MARGIN" : "REMOVE_MARGIN";
        const msgHash = ethers.solidityPackedKeccak256(["string", "bytes32"], [actionString, positionId]);
        const signature = await userClient.secretWallet.signMessage(ethers.getBytes(msgHash));
        
        writeContract({
          ...contracts.privacyProxy,
          functionName: type === 'add' ? 'addMargin' : 'removeMargin',
          args: [positionId, amountAsBigInt, signature],
          chain: scrollSepolia,
          account: address,
        }, {
            onSuccess: () => toast.info("Submitting private transaction...", { id: toastId }),
            onError: (err) => toast.error("Transaction Failed", { id: toastId, description: err.message })
        });
      } catch (e) {
        toast.error("Signature rejected.", { id: toastId });
      }
    } else { // Public Mode
      toast.info("Please confirm in your wallet.", { id: toastId });
      writeContract({
        ...contracts.clearingHouse,
        functionName: type === 'add' ? 'addMargin' : 'removeMargin',
        args: [positionId, amountAsBigInt],
        chain: scrollSepolia,
        account: address,
      }, {
          onSuccess: () => toast.info("Submitting public transaction...", { id: toastId }),
          onError: (err) => toast.error("Transaction Failed", { id: toastId, description: err.message })
      });
    }
  };
  
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isConfirmed) {
      toast.success(`Margin ${type}ed successfully!`);
      timer = setTimeout(() => {
        onSuccess();
      }, 10000);
      reset();
      onClose();
    }
    if (txError) {
      toast.error('Transaction Failed', { description: txError.message });
      reset();
    }
    return () => clearTimeout(timer);
  }, [isConfirmed, txError]);

  const title = type === 'add' ? 'Add Margin' : 'Remove Margin';
  const description = `Modify the margin on your open position (${positionId?.slice(0, 10)}...). Mode: ${tradingMode}`;
  const isLoading = isPending || isConfirming;

  return (
    <Dialog open={!!positionId} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md glass-panel">
        <DialogHeader><DialogTitle className="text-glow">{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <div className="py-4 space-y-2">
          <Label htmlFor="margin-amount">Amount (USDC)</Label>
          <Input id="margin-amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" disabled={isLoading}/>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
          <Button variant="neon" onClick={handleSubmit} disabled={isLoading || !amount || parseFloat(amount) <= 0}>
            {isLoading ? 'Processing...' : `Confirm ${title}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};