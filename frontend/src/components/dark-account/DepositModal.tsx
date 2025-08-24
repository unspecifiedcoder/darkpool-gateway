import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useAppStore, useAppActions } from "@/store/useAppStore";
import { useWriteContract, useWaitForTransactionReceipt, useReadContract, useAccount } from "wagmi";
import { AppChain, contracts } from "@/lib/contracts";
import { parseUnits, maxUint256, Hex } from "viem";
import { ethers } from "ethers";
import { generate_precommitment } from "@/lib/proof";

export const DepositModal = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void; }) => {
  const [amount, setAmount] = useState("");
  const { userClient } = useAppStore();
  const { triggerRefetch } = useAppActions();
  const { address } = useAccount();

  // --- Wagmi Hooks ---
  const { data: hash, isPending, writeContract, reset: resetWriteContract } = useWriteContract();
  const { data: receipt, isLoading: isConfirming, isSuccess: isConfirmed, error: txError } = useWaitForTransactionReceipt({ hash });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    ...contracts.usdc,
    functionName: "allowance",
    args: [address!, contracts.tokenPool.address],
    query: { enabled: isOpen && !!address },
  });

  // --- Logic to Determine Deposit Type ---
  const isFirstDeposit = !userClient?.currentMetadata?.commitment_info;
  const amountAsBigInt = amount ? parseUnits(amount, 18) : 0n;
  const needsApproval = allowance === undefined || (allowance as bigint) < amountAsBigInt;

  const handleApprove = () => {
    toast.info("Requesting approval to spend USDC...");
    writeContract({
      ...contracts.usdc,
      functionName: "approve",
      args: [contracts.tokenPool.address, maxUint256],
      chain: AppChain,
      account: address!,
    }, {
      onError: (err) => toast.error("Approval failed", { description: err.message })
    });
  };

  const handleConfirmAction = async () => {
    if (!userClient) return toast.error("Private client not initialized.");
    
    if (isFirstDeposit) {
      // --- Logic for First-Time Deposit ---
      toast.info("Preparing initial deposit...");
      try {
        const nullifier = userClient.getNextNullifier();
        const secret = userClient.getSecret();
        const precommitment = await generate_precommitment(nullifier, secret);

        writeContract({
            ...contracts.tokenPool,
            functionName: "deposit",
            args: [amountAsBigInt, precommitment.toString()],
            chain: AppChain,
            account: address!,
        });
      } catch (e: any) {
        toast.error("Error preparing deposit", { description: e.message });
      }
    } else {
      // --- Logic for Subsequent Deposits (Top-up as a Note) ---
      toast.info("Preparing top-up... This will create a new private note.");
      const selfReceiverHash = userClient.receiverHash.toString();
      writeContract({
        ...contracts.tokenPool,
        functionName: 'depositFor',
        args: [selfReceiverHash, amountAsBigInt],
        chain: AppChain,
        account: address!,
      });
    }
  };

  // Effect to handle transaction outcomes
  useEffect(() => {
    if (isConfirmed && receipt && userClient) {
      // If the successful tx was an approval, just refetch allowance and return
      if (needsApproval) {
        toast.success("Approval successful! You can now proceed.");
        refetchAllowance();
        resetWriteContract();
        return;
      }
      
      // If it was a deposit or depositFor
      if (isFirstDeposit) {
        toast.success("Initial deposit successful!");
        const depositEvent = receipt.logs.find(l => l.address.toLowerCase() === contracts.tokenPool.address.toLowerCase() && l.topics[0] === ethers.id("CommitmentInserted(bytes32,uint32,bytes32)"));
        if (depositEvent) {
          const tokenPoolInterface = new ethers.Interface(contracts.tokenPool.abi);
          const parsedLog = tokenPoolInterface.parseLog({ data: depositEvent.data as Hex, topics: depositEvent.topics as Hex[] });
          const newLeafIndex = Number(parsedLog!.args[1]);
          // This creates the user's first commitment record
          userClient.updateCommitment(amountAsBigInt.toString(), newLeafIndex);
        }
      } else {
        toast.success("Top-up successful! New private note created.");
        // We don't need to update the core commitment, the indexer will pick up the new note.
      }
      
      // In both cases, post the updated metadata (especially the incremented nonce) and refetch
      userClient.postMetadata().catch(err => toast.error("Failed to sync private state.", { description: err.message }));
      triggerRefetch();
      resetWriteContract();
      onClose();
    }

    if (txError) {
      toast.error("Transaction Failed", { description: txError.message });
      // Only rollback nonce if it was a failed deposit, not a failed approval
      if (!needsApproval) {
        userClient?.rollbackNonce(1);
        userClient?.postMetadata();
      }
      resetWriteContract();
    }
  }, [isConfirmed, txError, receipt]);

  const isLoading = isPending || isConfirming;
  const buttonText = isFirstDeposit ? "Confirm Deposit" : "Confirm Top-up";

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isFirstDeposit ? 'Initial Deposit to Dark Pool' : 'Top Up Dark Pool Balance'}</DialogTitle>
          <DialogDescription>
            {isFirstDeposit 
              ? "This first deposit will create your private balance in the dark pool."
              : "This action will create a new, separate note from your EOA funds."
            }
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-2">
          <Label htmlFor="deposit-amount">Amount (USDC)</Label>
          <Input id="deposit-amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={isLoading}/>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
          {needsApproval ? (
            <Button variant="neon" onClick={handleApprove} disabled={isLoading}>
              {isLoading ? "Processing..." : "Approve USDC"}
            </Button>
          ) : (
            <Button variant="neon" onClick={handleConfirmAction} disabled={isLoading || !amount || parseFloat(amount) <= 0}>
              {isLoading ? "Processing..." : buttonText}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};