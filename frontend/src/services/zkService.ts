import { UserClient } from "@/lib/UserClient";
import { contracts } from "@/lib/contracts"; // You'll need to export contract ABIs and addresses
import { generateWithdrawTransferProof } from "@/lib/proof";
import { toast } from "sonner";



export const zkService = {
  // Withdraws funds from the dark pool to an EOA
  async withdrawFromDarkPool(
    userClient: UserClient,
    amount: bigint,
    recipient: `0x${string}`,
    tokenPool: any // Pass the wagmi/viem tokenPool instance
  ) {
    const toastId = toast.loading("Preparing withdrawal proof...", { description: "This may take a moment." });
    try {
      await userClient.fetchAndSetMetadata();
      const commitment = userClient.getCommitmentInfo();
      const secret = userClient.getSecret();
      const currentNullifier = userClient.getNextNullifier(); // This increments the nonce
      const newNullifier = userClient.getNextNullifier();
      
      const remainingValue = BigInt(commitment.value) - amount;
      if (remainingValue < 0) throw new Error("Insufficient private balance.");

      // You would need a way to get the merkle root and path
      const merkleRoot = await tokenPool.read.currentRoot();
      const path = await tokenPool.read.getPath([BigInt(commitment.leaf_index)]);

      const { proof, publicInputs } = await generateWithdrawTransferProof(
        currentNullifier.toString(), secret.toString(), commitment.value, contracts.usdc.address,
        commitment.leaf_index.toString(), merkleRoot, newNullifier.toString(), secret.toString(),
        amount.toString(), path
      );

      toast.loading("Submitting transaction...", { id: toastId, description: "Please confirm in your wallet." });

      // Return proof and args for the wagmi `writeContract` hook
      return {
        functionName: 'withdraw',
        args: [recipient, { honkProof: proof, publicInputs }],
        newCommitmentInfo: { value: remainingValue.toString(), leafIndex: 0 } // Leaf index will come from event
      };
    } catch (error: any) {
      toast.error("Proof Generation Failed", { id: toastId, description: error.message });
      throw error;
    }
  },

  // TODO: Implement transferToDarkPool, topUpDarkPool, and claimNote
  // They will follow a similar pattern: fetch state, generate proof, return args.
};