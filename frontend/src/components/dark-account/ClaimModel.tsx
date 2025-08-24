import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useAppStore, useAppActions } from "@/store/useAppStore";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { readContract } from "wagmi/actions";
import { config } from "@/main";
import { contracts } from "@/lib/contracts";
import { formatUnits, Hex, parseUnits, toHex } from "viem";
import { ethers } from "ethers";
import { ApiNote } from "@/lib/types";
import { ProofGenerationLoader } from "../ProofGenerationLoader";
import { generateClaimProof } from "@/lib/proof";

type ModalProps = {
  noteToClaim: ApiNote | null; 
  onClose: () => void;
};

export const ClaimModal = ({ noteToClaim, onClose }: ModalProps) => {
  const [isGeneratingProof, setIsGeneratingProof] = useState(false);
  
  const { userClient } = useAppStore();
  const { triggerRefetch } = useAppActions();

  const { data: hash, isPending, writeContract, reset: resetWriteContract } = useWriteContract();
  const { data: receipt, isLoading: isConfirming, isSuccess: isConfirmed, error: txError } = useWaitForTransactionReceipt({ hash });

  const handleClaim = async () => {
    if (!userClient || !noteToClaim) {
      return toast.error("Client not ready or no note selected.");
    }
    const hasExistingCommitment = !!userClient.currentMetadata?.commitment_info;

    const toastId = toast.loading("Preparing to claim note...");
    
    try {
      toast.info("Fetching on-chain data for proof...", { id: toastId });
      const existingNullifier = userClient.getCurrentNullifier();
      const newNullifier = userClient.getNextNullifier();
      const secret = userClient.getSecret().toString();
      const selfReceiverHash = userClient.receiverHash.toString();

      const newConsolidatedValue = BigInt(userClient.currentMetadata.commitment_info.value) + BigInt(noteToClaim.value);

      const currentRoot = await readContract(config, { ...contracts.tokenPool, functionName: 'currentRoot' });
      const siblings = hasExistingCommitment 
        ? await readContract(config, { ...contracts.tokenPool, functionName: 'getPath', args: [BigInt(userClient.currentMetadata.commitment_info.leaf_index)] })
        : Array(32).fill(ethers.ZeroHash); // No siblings if no previous commitment

      // 2. Generate ZK Proof
      toast.info("Generating ZK proof for claim...", { id: toastId });
      setIsGeneratingProof(true);

      const { proof, publicInputs, verified } = await generateClaimProof(
        noteToClaim.note_nonce.toString(),
        noteToClaim.value,
        hasExistingCommitment ? existingNullifier.toString() : "0",
        hasExistingCommitment ? secret : "0",
        hasExistingCommitment ? userClient.currentMetadata.commitment_info.value : "0",
        contracts.usdc.address,
        hasExistingCommitment ? userClient.currentMetadata.commitment_info.leaf_index.toString() : "0",
        (currentRoot as Hex).toString(),
        newNullifier.toString(),
        secret, 
        userClient.receiverSecret.toString(),
        selfReceiverHash,
        siblings as Hex[]
      );
      
      setIsGeneratingProof(false);
      if (!verified) throw new Error("Locally generated claim proof failed verification.");
      
      // 3. Submit Transaction
      toast.info("Proof generated. Please confirm in your wallet.", { id: toastId });
      writeContract({
        ...contracts.tokenPool,
        functionName: 'claim',
        args: [{ honkProof: toHex(proof), publicInputs }],
        chain: AppChain,
        account: userClient.signerAddress,
      }, {
        onSuccess: () => {
        //   toast.loading("Transaction submitted. Waiting for confirmation...", { id: toastId });
          userClient.postMetadata().catch(err => toast.error("Error syncing private state.", { description: err.message }));
        },
        onError: (err) => {
          userClient.rollbackNonce(1);
          toast.error("Transaction failed to send.", { id: toastId, description: err.message });
        }
      });

    } catch (error: any) {
      setIsGeneratingProof(false);
      toast.error("Claim Failed", { id: toastId, description: error.message });
      userClient?.rollbackNonce(1); // A claim uses two nullifiers (old commitment + note)
    }
  };

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isConfirmed && receipt && userClient && noteToClaim) {
      toast.success("Note claimed successfully!");
      
      const event = receipt.logs.find(l => l.address.toLowerCase() === contracts.tokenPool.address.toLowerCase() && l.topics[0] === ethers.id("CommitmentInserted(bytes32,uint32,bytes32)"));
      if (event) {
        const tokenPoolInterface = new ethers.Interface(contracts.tokenPool.abi);
        const parsedLog = tokenPoolInterface.parseLog({ data: event.data as Hex, topics: event.topics as Hex[] });
        const newLeafIndex = Number(parsedLog!.args[1]);
        
        const existingValue = userClient.currentMetadata?.commitment_info?.value ? BigInt(userClient.currentMetadata.commitment_info.value) : 0n;
        const finalValue = existingValue + BigInt(noteToClaim.value);

        userClient.updateCommitment(finalValue.toString(), newLeafIndex);
        userClient.postMetadata().catch(err => toast.error("Failed to sync final private state.", { description: err.message }));
      }

       timer = setTimeout(() => {
        triggerRefetch();
      }, 7000);
      resetWriteContract();
      onClose();
    }
    if (txError) {
      toast.error("Claim transaction failed on-chain.", { description: txError.message });
      resetWriteContract();
    }

    return () => clearTimeout(timer);
  }, [isConfirmed, txError, receipt]);

  const isLoading = isGeneratingProof || isPending || isConfirming;
  const noteValue = noteToClaim ? formatUnits(BigInt(noteToClaim.value), 18) : "0";

  return (
    <>
      <ProofGenerationLoader isActive={isGeneratingProof} />
      <Dialog open={!!noteToClaim} onOpenChange={onClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Claim Unspent Note</DialogTitle>
            <DialogDescription>
              This will merge the value of this note into your main private balance, creating a new consolidated commitment.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <div className="flex justify-between items-center p-4 bg-card/20 rounded-lg">
                <span className="text-muted-foreground">Note Value:</span>
                <span className="font-mono text-lg text-primary">{noteValue} USDC</span>
            </div>
            <p className="text-xs text-muted-foreground text-center pt-2">A ZK-SNARK proof will be generated to privately prove your ownership of this note.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
            <Button variant="neon" onClick={handleClaim} disabled={isLoading}>
              {isGeneratingProof ? "Generating Proof..." : isPending ? "Confirm..." : isConfirming ? "Processing..." : "Generate Proof & Claim"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};