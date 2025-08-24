import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useAppStore, useAppActions } from "@/store/useAppStore";
import {
  useWriteContract,
  useWaitForTransactionReceipt,
  useReadContract,
  useAccount,
} from "wagmi";
import { readContract } from "wagmi/actions"; // Import the readContract action
import { config } from "@/main"; // Import our exported wagmi config
import { AppChain, contracts } from "@/lib/contracts";
import { parseUnits, isAddress, getAddress, Hex, toHex } from "viem";
import { EventLog, ethers } from "ethers"; // Ethers is useful for parsing logs
import { ProofGenerationLoader } from "../ProofGenerationLoader";
import { generateWithdrawTransferProof } from "@/lib/proof";

export const WithdrawModal = ({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) => {
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [isGeneratingProof, setIsGeneratingProof] = useState(false);

  const { userClient } = useAppStore();
  const { triggerRefetch } = useAppActions();
  const { address: eoaAddress } = useAccount();

  const {
    data: hash,
    isPending,
    writeContract,
    reset: resetWriteContract,
  } = useWriteContract();
  const {
    data: receipt,
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: txError,
  } = useWaitForTransactionReceipt({ hash });

  const { data: currentRoot } = useReadContract({
    ...contracts.tokenPool,
    functionName: "currentRoot",
    query: { enabled: isOpen },
  });

  const handleWithdraw = async () => {
    if (
      !userClient ||
      !userClient.currentMetadata?.commitment_info ||
      !eoaAddress
    ) {
      return toast.error("Client not ready or no private balance found.");
    }
    if (
      !amount ||
      parseFloat(amount) <= 0 ||
      !recipient ||
      !isAddress(recipient)
    ) {
      return toast.error("Invalid amount or recipient address.");
    }

    const toastId = toast.loading("Preparing withdrawal...");

    try {
      // 1. Prepare Inputs
      toast.info("Fetching on-chain data...", { id: toastId });
      const currentCommitment = userClient.getCommitmentInfo();
      const withdrawValue = parseUnits(amount, 18);
      if (BigInt(currentCommitment.value) < withdrawValue) {
        return toast.error("Insufficient private balance.", { id: toastId });
      }
      if (!currentRoot) {
        throw new Error("Could not fetch the latest Merkle Root.");
      }

      const remainingValue = BigInt(currentCommitment.value) - withdrawValue;
      const existingNullifier = userClient.getCurrentNullifier();
      const newNullifier = userClient.getNextNullifier();
      const secret = userClient.getSecret().toString();

      // 2. Fetch Merkle Path On-Demand using wagmi actions
      const siblings = await readContract(config, {
        ...contracts.tokenPool,
        functionName: "getPath",
        args: [BigInt(currentCommitment.leaf_index)],
      });

      // 3. Generate ZK Proof
      toast.info("Generating ZK proof... This may take a moment.", {
        id: toastId,
      });
      setIsGeneratingProof(true);

      console.log("Proof inputs:", existingNullifier.toString(),
      secret,
      currentCommitment.value,
      contracts.usdc.address,
      currentCommitment.leaf_index.toString(),
      currentRoot as Hex,
      newNullifier.toString(),
      secret,
      withdrawValue.toString(),
      siblings as Hex[]);
      const { proof, publicInputs, verified } =
        await generateWithdrawTransferProof(
          existingNullifier.toString(),
          secret,
          currentCommitment.value,
          contracts.usdc.address,
          currentCommitment.leaf_index.toString(),
          currentRoot as Hex,
          newNullifier.toString(),
          secret,
          withdrawValue.toString(),
          siblings as Hex[]
        );
      setIsGeneratingProof(false);
      if (!verified)
        throw new Error("Locally generated proof failed verification.");
      toast.info("Proof generated. Submitting transaction...", { id: toastId });
      console.log("Proof generated. Submitting transaction...", { id: toastId });

      // 4. Submit Transaction
      writeContract({
        ...contracts.tokenPool,
        functionName: "withdraw",
        args: [getAddress(recipient), { honkProof: toHex(proof), publicInputs }],
        chain: AppChain,
        account: eoaAddress,
      }, {
        onSuccess: (txHash) => {
            toast.loading("Transaction submitted. Waiting for confirmation...", { id: toastId });
            userClient.postMetadata().catch(err => {
                console.error("Critical error: failed to post new nonce state", err);
                toast.error("Error syncing private state. Please refresh.");
            });
        },
        onError: (err) => {
          userClient.rollbackNonce(1);
            toast.error("Transaction failed to send.", { id: toastId, description: err.message });
        }
      });
    } catch (error: any) {
      setIsGeneratingProof(false);
      toast.error("Withdrawal Failed", {
        id: toastId,
        description: error.message,
      });
      console.error("Withdrawal Failed", error);
      // Rollback nonce increments on pre-transaction failure
      userClient.rollbackNonce(1);
    }
  };

  // Effect to handle the outcome of the on-chain transaction
  useEffect(() => {
    if (isConfirmed && receipt && userClient) {
      toast.success("Withdrawal successful!");

      const tokenPoolInterface = new ethers.Interface(contracts.tokenPool.abi);
      const dpEvent = receipt.logs.find(
        (l) =>
          l.address.toLowerCase() ===
            contracts.tokenPool.address.toLowerCase() &&
          l.topics[0] ===
            ethers.id("CommitmentInserted(bytes32,uint32,bytes32)")
      );

      if (dpEvent) {
        const parsedLog = tokenPoolInterface.parseLog({
          data: dpEvent.data as Hex,
          topics: dpEvent.topics as Hex[],
        });
        const newLeafIndex = Number(parsedLog!.args[1]);
        console.log("New leaf index:", newLeafIndex);
        const remainingValue =
          BigInt(userClient.getCommitmentInfo().value) - parseUnits(amount, 18);

        userClient.updateCommitment(remainingValue.toString(), newLeafIndex);
        userClient
          .postMetadata()
          .catch((err) =>
            toast.error("Failed to update private state.", {
              description: err.message,
            })
          );
      }

      triggerRefetch(); // Trigger global UI refetch
      resetWriteContract(); // Reset the transaction hook
      onClose();
    }
    if (txError) {
      toast.error("Withdrawal transaction failed.", {
        description: txError.message,
      });
      resetWriteContract();
    }
  }, [isConfirmed, txError, receipt]);

  useEffect(() => {
    if (eoaAddress) setRecipient(eoaAddress);
  }, [eoaAddress]);

  const isLoading = isGeneratingProof || isPending || isConfirming;

  return (
    <div>
      {" "}
      <ProofGenerationLoader isActive={isGeneratingProof} />
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdraw from Dark Pool</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="withdraw-amount">Amount (USDC)</Label>
              <Input
                id="withdraw-amount"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="recipient-address">Recipient Address</Label>
              <Input
                id="recipient-address"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                disabled={isLoading}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button
              variant="neon"
              onClick={handleWithdraw}
              disabled={isLoading}
            >
              {isGeneratingProof
                ? "Generating Proof..."
                : isPending
                ? "Confirm in Wallet..."
                : isConfirming
                ? "Processing Tx..."
                : "Generate Proof & Withdraw"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>{" "}
    </div>
  );
};
