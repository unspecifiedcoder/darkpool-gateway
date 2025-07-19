import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useAppStore, useAppActions } from "@/store/useAppStore";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { readContract } from "wagmi/actions";
import { config } from "@/main";
import { contracts } from "@/lib/contracts";
import { parseUnits, Hex } from "viem";
import { ethers } from "ethers";
import { generateWithdrawTransferProof } from "@/lib/proof";
import { scrollSepolia } from "viem/chains";

export const TransferModal = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
  const [amount, setAmount] = useState('');
  const [receiverHash, setReceiverHash] = useState('');
  const [isGeneratingProof, setIsGeneratingProof] = useState(false);

  const { userClient } = useAppStore();
  const { triggerRefetch } = useAppActions();

  const { data: hash, isPending, writeContract, reset: resetWriteContract } = useWriteContract();
  const { data: receipt, isLoading: isConfirming, isSuccess: isConfirmed, error: txError } = useWaitForTransactionReceipt({ hash });

  const handleTransfer = async () => {
    if (!userClient || !userClient.currentMetadata?.commitment_info) {
      return toast.error("Client not ready or no private balance found to transfer from.");
    }
    if (!receiverHash.startsWith("0x") || receiverHash.length < 66) {
        return toast.error("Invalid receiver hash format.");
    }
    const toastId = toast.loading("Preparing private transfer...");
    
    try {
      // 1. Prepare Inputs
      const currentCommitment = userClient.getCommitmentInfo();
      const transferValue = parseUnits(amount, 18);
      if (BigInt(currentCommitment.value) < transferValue) {
        return toast.error("Insufficient private balance for this transfer.", { id: toastId });
      }

      const remainingValue = BigInt(currentCommitment.value) - transferValue;
      const existingNullifier = userClient.getCurrentNullifier();
      const newNullifier = userClient.getNextNullifier();
      const secret = userClient.getSecret().toString();
      
      // 2. Fetch Merkle Data
      toast.info("Fetching on-chain data for proof...", { id: toastId });
      const currentRoot = await readContract(config, { ...contracts.tokenPool, functionName: 'currentRoot' });
      const siblings = await readContract(config, { ...contracts.tokenPool, functionName: 'getPath', args: [BigInt(currentCommitment.leaf_index)] });
      
      // 3. Generate Proof
      toast.info("Generating ZK proof... This may take a moment.", { id: toastId });
      setIsGeneratingProof(true);
      const { proof, publicInputs, verified } = await generateWithdrawTransferProof(
        existingNullifier.toString(), secret, currentCommitment.value, contracts.usdc.address,
        currentCommitment.leaf_index.toString(), currentRoot as Hex, newNullifier.toString(),
        secret, transferValue.toString(), siblings as Hex[]
      );
      setIsGeneratingProof(false);
      if (!verified) throw new Error("Locally generated proof failed verification.");
      
      // 4. Submit Transaction
      toast.info("Submitting transaction...", { id: toastId });
      writeContract({
        ...contracts.tokenPool,
        functionName: 'transfer',
        args: [ { honkProof: proof, publicInputs }, receiverHash ],
        chain: scrollSepolia,
        account: userClient.signerAddress!,
      });

    } catch (error: any) {
      setIsGeneratingProof(false);
      toast.error("Transfer Failed", { id: toastId, description: error.message });
      userClient?.rollbackNonce(1);
      userClient?.postMetadata();
    }
  };

  useEffect(() => {
    if (isConfirmed && receipt && userClient) {
      toast.success("Transfer successful! A new private note has been sent.");
      
      const event = receipt.logs.find(l => l.address.toLowerCase() === contracts.tokenPool.address.toLowerCase() && l.topics[0] === ethers.id("CommitmentInserted(bytes32,uint32,bytes32)"));
      if (event) {
        const tokenPoolInterface = new ethers.Interface(contracts.tokenPool.abi);
        const parsedLog = tokenPoolInterface.parseLog({ data: event.data as Hex, topics: event.topics as Hex[] });
        const newLeafIndex = Number(parsedLog!.args[1]);
        const remainingValue = BigInt(userClient.getCommitmentInfo().value) - parseUnits(amount, 18);
        userClient.updateCommitment(remainingValue.toString(), newLeafIndex);
        userClient.postMetadata().catch(err => toast.error("Failed to update private state.", { description: err.message }));
      }

      triggerRefetch();
      resetWriteContract();
      onClose();
    }
    if (txError) {
      toast.error("Transfer transaction failed.", { description: txError.message });
      resetWriteContract();
    }
  }, [isConfirmed, txError, receipt]);

  const isLoading = isGeneratingProof || isPending || isConfirming;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transfer Privately</DialogTitle>
          <DialogDescription>Send funds from your private balance to another user's receiver hash. This will create a new note for the recipient.</DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="transfer-amount">Amount (USDC)</Label>
            <Input id="transfer-amount" type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" disabled={isLoading} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="receiver-hash">Recipient's Receiver Hash</Label>
            <Input id="receiver-hash" value={receiverHash} onChange={e => setReceiverHash(e.target.value)} placeholder="0x..." disabled={isLoading} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
          <Button variant="neon" onClick={handleTransfer} disabled={isLoading || !amount || !receiverHash}>
            {isGeneratingProof ? "Generating Proof..." : isPending ? "Confirm..." : isConfirming ? "Processing..." : "Generate Proof & Transfer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};