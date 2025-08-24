import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useAppStore, useAppActions } from "@/store/useAppStore";
import { useWriteContract, useWaitForTransactionReceipt, useReadContract, useAccount } from "wagmi";
import { contracts } from "@/lib/contracts";
import { parseUnits, maxUint256 } from "viem";

export const TopupModal = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
  const [amount, setAmount] = useState('');
  const { userClient } = useAppStore();
  const { triggerRefetch } = useAppActions();
  const { address } = useAccount();

  const { data: hash, isPending, writeContract, reset: resetWriteContract } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed, error: txError } = useWaitForTransactionReceipt({ hash });

  // Check the allowance the user has given to the TokenPool contract
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    ...contracts.usdc,
    functionName: 'allowance',
    args: [address!, contracts.tokenPool.address],
    query: { enabled: isOpen && !!address },
  });

  const amountAsBigInt = amount ? parseUnits(amount, 18) : 0n;
  const needsApproval = allowance === undefined || (allowance as bigint) < amountAsBigInt;

  const handleApprove = () => {
    toast.info("Requesting approval to spend USDC...");
    writeContract({
      ...contracts.usdc,
      functionName: 'approve',
      args: [contracts.tokenPool.address, maxUint256],
      chain: AppChain,
      account: address!,
    });
  };

  const handleTopup = () => {
    if (!userClient) return toast.error("Private client not initialized.");
    
    toast.info("Preparing top-up transaction...");
    const selfReceiverHash = userClient.receiverHash.toString();

    writeContract({
      ...contracts.tokenPool,
      functionName: 'depositFor',
      args: [selfReceiverHash, amountAsBigInt],
      chain: AppChain,
      account: address!,
    });
  };

  useEffect(() => {
    if (isConfirmed) {
      if (needsApproval) {
        toast.success("Approval successful! You can now top up.");
        refetchAllowance();
      } else {
        toast.success("Top-up successful! New private note created.");
        triggerRefetch(); // Trigger a global refetch to update note list
        onClose();
      }
      resetWriteContract();
    }
    if (txError) {
      toast.error("Transaction Failed", { description: txError.message });
      resetWriteContract();
    }
  }, [isConfirmed, txError]);

  const isLoading = isPending || isConfirming;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Top Up (Create Note from EOA)</DialogTitle>
          <DialogDescription>
            This action moves funds from your public wallet directly into the Dark Pool as a new, unspent note for yourself.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-2">
          <Label htmlFor="topup-amount">Amount (USDC)</Label>
          <Input id="topup-amount" type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" disabled={isLoading} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
          {needsApproval ? (
             <Button variant="neon" onClick={handleApprove} disabled={isLoading}>
                {isLoading ? "Approving..." : "Approve USDC"}
             </Button>
          ) : (
            <Button variant="neon" onClick={handleTopup} disabled={isLoading || !amount || parseFloat(amount) <= 0}>
              {isLoading ? "Processing..." : "Confirm Top Up"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};