import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useAppStore } from '@/store/useAppStore';
import { UserClient } from '@/lib/UserClient'; 

type ApiNote = { note: { value: string, note_nonce: number } };

export const DarkAccountPanel = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { userClient } = useAppStore();

  // Local state to hold the fetched data
  const [unspentNotes, setUnspentNotes] = useState<ApiNote[]>([]);
  const [metadata, setMetadata] = useState<any>(null);

  useEffect(() => {
    // Fetch data only when the panel is opened and the userClient is available
    if (isOpen && userClient) {
      const fetchData = async () => {
        setIsLoading(true);
        // sublog("Fetching dark account data...");
        try {
          // In the real implementation, userClient will be fully fleshed out
          // const notes = await userClient.getUnspentNotes();
          // const meta = await userClient.fetchAndSetMetadata();
          
          // Using mock data for now
          await new Promise(r => setTimeout(r, 1000));
          const mockNotes: ApiNote[] = [
            { note: { value: '500000000000000000000', note_nonce: 1 } },
            { note: { value: '123000000000000000000', note_nonce: 2 } },
          ];
          const mockMeta = { last_used_nullifier_nonce: 5, commitment_info: { value: '10000000000000000000000' } };
          
          setUnspentNotes(mockNotes);
          setMetadata(mockMeta);
          // sublog("Successfully fetched dark account data.");
        } catch (error) {
          console.error("Failed to fetch dark account data:", error);
        } finally {
          setIsLoading(false);
        }
      };
      fetchData();
    }
  }, [isOpen, userClient]);

  const formatUSDC = (value: string) => {
    return parseFloat(ethers.formatUnits(value, 18)).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" className="fixed bottom-20 right-6 z-50 neon-border text-primary">
          Dark Account
        </Button>
      </SheetTrigger>
      <SheetContent className="glass-panel border-l-primary/30 w-[480px] sm:max-w-none flex flex-col">
        <SheetHeader>
          <SheetTitle className="text-glow text-2xl">Private Account</SheetTitle>
          <SheetDescription>
            Manage your private funds and notes within the Dark Pool.
          </SheetDescription>
        </SheetHeader>
        
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <p>Loading private state...</p>
          </div>
        ) : !userClient ? (
            <div className="flex-1 flex items-center justify-center text-center text-muted-foreground">
                <p>Switch to Private Mode to view your dark account.</p>
            </div>
        ) : (
          <div className="flex-1 space-y-8 py-6 overflow-y-auto">
            {/* Private Balance Section */}
            <div>
              <h4 className="text-lg font-semibold mb-3">Private Balance</h4>
              <div className="p-4 bg-card/20 rounded-lg">
                <p className="text-sm text-muted-foreground">Consolidated Value (in Dark Pool)</p>
                <p className="text-3xl font-mono text-primary">
                  {metadata?.commitment_info ? formatUSDC(metadata.commitment_info.value) : '0.00'} USDC
                </p>
              </div>
            </div>

            {/* Unspent Notes Section */}
            <div>
              <h4 className="text-lg font-semibold mb-3">Unspent Notes</h4>
              <div className="space-y-3">
                {unspentNotes.length > 0 ? (
                  unspentNotes.map((note) => (
                    <div key={note.note.note_nonce} className="p-4 bg-card/20 rounded-lg flex justify-between items-center">
                      <div>
                        <p className="text-sm text-muted-foreground">Note #{note.note.note_nonce}</p>
                        <p className="font-mono text-lg">{formatUSDC(note.note.value)} USDC</p>
                      </div>
                      <Button size="sm" variant="neon">Claim</Button>
                    </div>
                  ))
                ) : (
                  <div className="p-4 text-center text-muted-foreground">No unspent notes found.</div>
                )}
              </div>
            </div>

            {/* Metadata Section */}
            <div>
              <h4 className="text-lg font-semibold mb-3">Account Metadata</h4>
              <div className="p-4 bg-card/20 rounded-lg space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Latest Nullifier Nonce:</span>
                  <span className="font-mono">{metadata?.last_used_nullifier_nonce ?? 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Current Leaf Index:</span>
                  <span className="font-mono">{metadata?.commitment_info?.leaf_index ?? 'N/A'}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};