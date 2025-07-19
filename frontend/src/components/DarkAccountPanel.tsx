import { useEffect, useState, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useAppStore, useAppActions } from "@/store/useAppStore";
import { formatUnits } from "viem";
import {
  RefreshCw,
  ArrowUpRight,
  ArrowDownLeft,
  Send,
  Sparkles,
  PlusCircle,
} from "lucide-react";
import { UserMetadata, ApiNote } from "@/lib/types";
import { DepositModal } from "./dark-account/DepositModal";
import { WithdrawModal } from "./dark-account/WithdrawModal";
import { TransferModal } from "./dark-account/TransferModal";
import { TopupModal } from "./dark-account/TopupModal";
import { ClaimModal } from "./dark-account/ClaimModel";

export const DarkAccountPanel = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeModal, setActiveModal] = useState<
    "deposit" | "withdraw" | "transfer" | "topup" | null
  >(null);
  const [noteToClaim, setNoteToClaim] = useState<ApiNote | null>(null);

  const { userClient, refetchSignal } = useAppStore();
  const { triggerRefetch } = useAppActions();

  // Local state to hold the fetched data
  const [unspentNotes, setUnspentNotes] = useState<ApiNote[]>([]);
  const [metadata, setMetadata] = useState<UserMetadata | null>(null);

  const fetchData = useCallback(async () => {
    if (!userClient) return;

    setIsLoading(true);
    console.log("Fetching dark account data...");
    try {
      // Parallelize API calls for a faster experience
      const [notes] = await Promise.all([
        userClient.getUnspentNotes(),
        userClient.fetchAndSetMetadata(), // This updates the client's internal state
      ]);

      setUnspentNotes(notes);
      setMetadata(userClient.currentMetadata);
      console.log("Successfully fetched dark account data.");
    } catch (error) {
      console.error("Failed to fetch dark account data:", error);
    } finally {
      setIsLoading(false);
    }
  }, [userClient]);

  // Fetch data when the panel is opened or a global refetch is signaled
  useEffect(() => {
    if (isOpen && userClient) {
      fetchData();
    }
  }, [isOpen, userClient, refetchSignal, fetchData]);

  const formatUSDC = (value: string) => {
    return parseFloat(formatUnits(BigInt(value), 18)).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  return (
    <>
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTrigger asChild>
          <Button
            variant="outline"
            className="fixed bottom-20 right-6 z-50 neon-border text-primary"
          >
            Dark Account
          </Button>
        </SheetTrigger>
        <SheetContent className="glass-panel border-l-primary/30 w-[480px] sm:max-w-none flex flex-col">
          <SheetHeader className="flex flex-row justify-between items-center">
            <div>
              <SheetTitle className="text-glow text-2xl">
                Private Account
              </SheetTitle>
              <SheetDescription>
                Manage your private funds and notes within the Dark Pool.
              </SheetDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={fetchData}
              disabled={isLoading}
            >
              <RefreshCw
                className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`}
              />
            </Button>
          </SheetHeader>

          {!userClient ? (
            <div className="flex-1 flex items-center justify-center text-center text-muted-foreground">
              <p>Switch to Private Mode to view your dark account.</p>
            </div>
          ) : isLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <p>Loading private state...</p>
            </div>
          ) : (
            <div className="flex-1 space-y-6 py-4 overflow-y-auto">
              {/* Actions Section */}
              <div>
                <h4 className="text-sm font-semibold mb-3 text-muted-foreground uppercase">
                  Actions
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="neon"
                    onClick={() => setActiveModal("deposit")}
                  >
                    <ArrowDownLeft className="w-4 h-4 mr-2" />
                    Deposit
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setActiveModal("withdraw")}
                  >
                    <ArrowUpRight className="w-4 h-4 mr-2" />
                    Withdraw
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setActiveModal("transfer")}
                  >
                    <Send className="w-4 h-4 mr-2" />
                    Transfer
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setActiveModal("topup")}
                  >
                    <PlusCircle className="w-4 h-4 mr-2" />
                    Top Up (Note)
                  </Button>
                </div>
              </div>

              {/* Private Balance Section */}
              <div>
                <h4 className="text-sm font-semibold mb-3 text-muted-foreground uppercase">
                  Private Balance
                </h4>
                <div className="p-4 bg-card/20 rounded-lg">
                  <p className="text-sm text-muted-foreground">
                    Consolidated Value in Dark Pool
                  </p>
                  <p className="text-3xl font-mono text-primary">
                    {metadata?.commitment_info
                      ? formatUSDC(metadata.commitment_info.value)
                      : "0.00"}{" "}
                    USDC
                  </p>
                </div>
              </div>

              {/* Unspent Notes Section */}
              <div>
                <h4 className="text-sm font-semibold mb-3 text-muted-foreground uppercase">
                  Unspent Notes ({unspentNotes.length})
                </h4>
                <div className="space-y-3 max-h-60 overflow-y-auto pr-2">
                  {unspentNotes.length > 0 ? (
                    unspentNotes.map((note) => (
                      <div
                        key={note.note_nonce}
                        className="p-4 bg-card/20 rounded-lg flex justify-between items-center"
                      >
                        <div>
                          <p className="text-sm text-muted-foreground">
                            Note #{note.note_nonce}
                          </p>
                          <p className="font-mono text-lg">
                            {formatUSDC(note.value)} USDC
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="neon"
                          onClick={() => setNoteToClaim(note)}
                        >
                          <Sparkles className="w-4 h-4 mr-2" />
                          Claim
                        </Button>
                      </div>
                    ))
                  ) : (
                    <div className="p-4 text-center text-muted-foreground text-sm">
                      No unspent notes found.
                    </div>
                  )}
                </div>
              </div>

              {/* Metadata Section */}
              <div>
                <h4 className="text-sm font-semibold mb-3 text-muted-foreground uppercase">
                  Account Details
                </h4>
                <div className="p-4 bg-card/20 rounded-lg space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Next Nullifier Nonce:
                    </span>
                    <span className="font-mono">
                      {
                        // @ts-ignore
                      (metadata?.last_used_nullifier_nonce ?? "N/A") + 1
                      }
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Current Leaf Index:
                    </span>
                    <span className="font-mono">
                      {metadata?.commitment_info?.leaf_index ?? "N/A"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Render Modals based on active state */}
      <DepositModal
        isOpen={activeModal === "deposit"}
        onClose={() => setActiveModal(null)}
      />
      <WithdrawModal
        isOpen={activeModal === "withdraw"}
        onClose={() => setActiveModal(null)}
      />
      <TransferModal
        isOpen={activeModal === "transfer"}
        onClose={() => setActiveModal(null)}
      />
      <TopupModal
        isOpen={activeModal === "topup"}
        onClose={() => setActiveModal(null)}
      />
      <ClaimModal
        noteToClaim={noteToClaim}
        onClose={() => setNoteToClaim(null)}
      />
    </>
  );
};
