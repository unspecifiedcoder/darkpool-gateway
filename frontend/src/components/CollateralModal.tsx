import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { readContract } from "wagmi/actions";
import { config } from "@/main";
import { contracts } from "@/lib/contracts";
import {
  parseUnits,
  maxUint256,
  Hex,
  getAddress,
  formatUnits,
  toHex,
} from "viem";
import { toast } from "sonner";
import { useAppStore, useAppActions } from "@/store/useAppStore";
import { ethers, EventLog } from "ethers";
import { scrollSepolia } from "viem/chains";
import { generateWithdrawTransferProof } from "@/lib/proof";
import { ProofGenerationLoader } from "./ProofGenerationLoader";

type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
  type: "deposit" | "withdraw";
  onSuccess: () => void;
};

type DepositSource = "eoa" | "darkPool";

export const CollateralModal = ({
  isOpen,
  onClose,
  type,
  onSuccess,
}: ModalProps) => {
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState<DepositSource>("eoa");
  const [isGeneratingProof, setIsGeneratingProof] = useState(false);

  const { address } = useAccount();
  const { tradingMode, userClient } = useAppStore();
  const { triggerRefetch } = useAppActions();

  // --- Wagmi Hooks ---
  const { data: hash, isPending, writeContract, reset } = useWriteContract();
  const {
    data: receipt,
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: txError,
  } = useWaitForTransactionReceipt({ hash });

  // --- Dynamic State based on Mode & Source ---
  const isPrivateMode = tradingMode === "Private";
  const privateBalance = BigInt(
    userClient?.currentMetadata?.commitment_info?.value ?? "0"
  );

  let spenderAddress: Hex;
  if (type === "deposit" && isPrivateMode && source === "eoa") {
    spenderAddress = contracts.privacyProxy.address;
  } else {
    spenderAddress = contracts.clearingHouse.address;
  }

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: contracts.usdc.address,
    abi: contracts.usdc.abi,
    functionName: "allowance",
    args: [address!, spenderAddress],
    query: {
      enabled:
        isOpen &&
        !!address &&
        type === "deposit" &&
        (!isPrivateMode || source === "eoa"),
    },
  });

  const amountAsBigInt = amount ? parseUnits(amount, 18) : 0n;
  const needsApproval =
    type === "deposit" &&
    (!isPrivateMode || source === "eoa") &&
    (allowance === undefined || (allowance as bigint) < amountAsBigInt);

  // --- Handlers ---
  const handleApprove = () => {
    toast.info("Requesting approval to spend USDC...");
    writeContract(
      {
        ...contracts.usdc,
        functionName: "approve",
        args: [spenderAddress, maxUint256],
        chain: scrollSepolia,
        account: address!,
      },
      {
        onError: (err) =>
          toast.error("Approval failed", { description: err.message }),
      }
    );
  };

  const handleConfirm = async () => {
    if (!userClient && isPrivateMode)
      return toast.error("Private client not initialized.");

    try {
      if (type === "deposit") {
        // --- DEPOSIT LOGIC ---
        if (isPrivateMode) {
          if (source === "eoa") {
            // Private Deposit from EOA
            writeContract({
              ...contracts.privacyProxy,
              functionName: "depositCollateralFromEOA",
              args: [userClient!.pubKey, amountAsBigInt],
              chain: scrollSepolia,
              account: address!,
            });
          } else {
            // Private Deposit from Dark Pool (ZK Flow)
            if (privateBalance < amountAsBigInt)
              return toast.error("Insufficient private balance.");
            // const toastId = toast.loading("Preparing private deposit...", {
            //   duration: 3000,
            // });
            setIsGeneratingProof(true);
            const currentCommitment = userClient!.getCommitmentInfo();
            const remainingValue = privateBalance - amountAsBigInt;
            const existingNullifier = userClient!.getCurrentNullifier();
            const newNullifier = userClient!.getNextNullifier();
            const secret = userClient!.getSecret().toString();
            const currentRoot = await readContract(config, {
              ...contracts.tokenPool,
              functionName: "currentRoot",
            });
            const siblings = await readContract(config, {
              ...contracts.tokenPool,
              functionName: "getPath",
              args: [BigInt(currentCommitment.leaf_index)],
            });

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
                amountAsBigInt.toString(),
                siblings as Hex[]
              );
            setIsGeneratingProof(false);
            if (!verified) throw new Error("Proof verification failed.");

            writeContract(
              {
                ...contracts.privacyProxy,
                functionName: "depositCollateralFromDarkPool",
                args: [
                  userClient!.pubKey,
                  { honkProof: toHex(proof), publicInputs },
                ],
                chain: scrollSepolia,
                account: address!,
              },
              {
                onSuccess: () => {
                  toast.success("Deposit successful!");
                  onClose();
                  onSuccess();
                },
                onError: (err) => {
                  console.log("tx deposit error++", err);
                  toast.error("Deposit failed", { description: err.message });
                  userClient?.rollbackNonce(1);
                },
              }
            );
          }
        } else {
          // Public Deposit
          writeContract(
            {
              ...contracts.clearingHouse,
              functionName: "depositCollateral",
              args: [amountAsBigInt],
              chain: scrollSepolia,
              account: address!,
            },
            {
              onError: (err) =>
                toast.error("Deposit failed", { description: err.message }),
            }
          );
        }
      } else {
        // --- WITHDRAW LOGIC ---
        if (isPrivateMode) {
          // Private Withdraw to Dark Pool (Signature Flow)
          const msgHash = ethers.solidityPackedKeccak256(
            ["string", "uint256", "bytes32"],
            [
              "WITHDRAW_COLLATERAL",
              amountAsBigInt,
              userClient!.receiverHash.toString(),
            ]
          );
          const signature = await userClient!.secretWallet.signMessage(
            ethers.getBytes(msgHash)
          );
          writeContract(
            {
              ...contracts.privacyProxy,
              functionName: "withdrawCollateralToDarkPool",
              args: [
                userClient!.pubKey,
                amountAsBigInt,
                userClient!.receiverHash.toString(),
                signature,
              ],
              chain: scrollSepolia,
              account: address!,
            },
            {
              onError: (err) =>
                toast.error("Withdrawal failed", { description: err.message }),
            }
          );
        } else {
          // Public Withdraw
          writeContract(
            {
              ...contracts.clearingHouse,
              functionName: "withdrawCollateral",
              args: [amountAsBigInt],
              chain: scrollSepolia,
              account: address!,
            },
            {
              onError: (err) =>
                toast.error("Withdrawal failed", { description: err.message }),
            }
          );
        }
      }
    } catch (error: any) {
      setIsGeneratingProof(false);
      toast.error("Operation Failed", { description: error.message });
      console.log("tx withdraw error", error);
      // if (source === "darkPool") userClient?.rollbackNonce(1);
    }
  };

  // --- Transaction Outcome Effect ---
  useEffect(() => {
    if (isConfirmed && receipt) {
      if (needsApproval) {
        toast.success("Approval successful! You can now proceed.");
        refetchAllowance();
      } else {
        toast.success("Operation successful!");
        if (isPrivateMode && source === "darkPool" && userClient) {
          const dpEvent = receipt.logs.find(
            (l) =>
              l.address.toLowerCase() ===
                contracts.tokenPool.address.toLowerCase() &&
              l.topics[0] ===
                ethers.id("CommitmentInserted(bytes32,uint32,bytes32)")
          ) as EventLog | undefined;
          if (dpEvent) {
            // Update commitment with remaining balance
            const tokenPoolInterface = new ethers.Interface(
              contracts.tokenPool.abi
            );
            const parsedLog = tokenPoolInterface.parseLog({
              data: dpEvent.data as Hex,
              topics: dpEvent.topics as Hex[],
            });
            const newLeafIndex = Number(parsedLog!.args[1]);
            const remainingValue = privateBalance - amountAsBigInt;
            userClient.updateCommitment(
              remainingValue.toString(),
              newLeafIndex
            );
            userClient.postMetadata();
          }
        }
        onSuccess();
        onClose();
      }
      reset();
    }
    if (txError) {
      toast.error("Transaction Failed", { description: txError.message });
      reset();
    }
  }, [isConfirmed, txError, receipt]);

  const isLoading = isPending || isConfirming || isGeneratingProof;

  return (
    <>
      <ProofGenerationLoader isActive={isGeneratingProof} />
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-md glass-panel">
          <DialogHeader>
            <DialogTitle className="text-glow">
              {type === "deposit" ? "Deposit" : "Withdraw"} Collateral
            </DialogTitle>
            <DialogDescription>Mode: {tradingMode}</DialogDescription>
          </DialogHeader>

          {type === "deposit" && isPrivateMode && (
            <div className="py-2">
              <Label>Source</Label>
              <ToggleGroup
                type="single"
                value={source}
                onValueChange={(value: DepositSource) =>
                  value && setSource(value)
                }
                className="grid grid-cols-2 mt-2"
              >
                <ToggleGroupItem value="eoa" aria-label="From EOA Wallet">
                  From Wallet
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="darkPool"
                  aria-label="From Dark Pool Balance"
                >
                  From Private Balance
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="collateral-amount">Amount (USDC)</Label>
            <Input
              id="collateral-amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={isLoading}
            />
            {isPrivateMode && source === "darkPool" && (
              <p className="text-xs text-muted-foreground">
                Available Private Balance: {formatUnits(privateBalance, 18)}{" "}
                USDC
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            {needsApproval ? (
              <Button
                variant="neon"
                onClick={handleApprove}
                disabled={isLoading}
              >
                {isLoading ? "Approving..." : "Approve USDC"}
              </Button>
            ) : (
              <Button
                variant="neon"
                onClick={handleConfirm}
                disabled={isLoading || !amount || parseFloat(amount) <= 0}
              >
                {isLoading
                  ? "Processing..."
                  : `Confirm ${type.charAt(0).toUpperCase() + type.slice(1)}`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
