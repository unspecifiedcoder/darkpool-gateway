import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi';
import { contracts } from '@/lib/contracts';
import { parseUnits } from 'viem';
import { toast } from 'sonner';
import { scrollSepolia } from 'viem/chains';

type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  type: 'add' | 'remove';
};

const ManageMarginModal = ({ isOpen, onClose, onSuccess, type }: ModalProps) => {
  const [amount, setAmount] = useState('');

  const { data: hash, error, isPending, writeContract, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

  const functionName = type === 'add' ? 'addMargin' : 'removeMargin';

  const account = useAccount()

  const handleSubmit = () => {
    const amountAsBigInt = parseUnits(amount, 18);
    writeContract({
      address: contracts.clearingHouse.address,
      abi: contracts.clearingHouse.abi,
      functionName,
      args: [amountAsBigInt],
      chain: scrollSepolia,
      account: account.address
    });
  };
  
  useEffect(() => {
    if (isConfirmed) {
      toast.success(`Margin ${type === 'add' ? 'added' : 'removed'} successfully!`, {
        action: { label: 'View Tx', onClick: () => window.open(`https://sepolia.scrollscan.com/tx/${hash}`, '_blank') },
      });
      onSuccess();
      reset();
      onClose();
    }
    if (error) {
      toast.error('Transaction Failed', { description: error.message });
      reset();
    }
  }, [isConfirmed, error, hash, type, onClose, onSuccess, reset]);

  const title = type === 'add' ? 'Add Margin' : 'Remove Margin';
  const description = `Increase or decrease the margin on your open position.`;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md glass-panel border-primary/30">
        <DialogHeader>
          <DialogTitle className="text-glow">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-2">
          <Label htmlFor="margin-amount">Amount (USDC)</Label>
          <Input id="margin-amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending || isConfirming}>Cancel</Button>
          <Button type="button" variant="neon" onClick={handleSubmit} disabled={isPending || isConfirming || !amount || parseFloat(amount) <= 0}>
            {isPending ? 'Confirm...' : isConfirming ? 'Processing...' : `Confirm ${title}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ManageMarginModal;