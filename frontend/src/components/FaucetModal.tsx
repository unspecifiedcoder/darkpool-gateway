import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger
} from '@/components/ui/dialog';
import { useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi';
import { contracts } from '@/lib/contracts';
import { parseUnits } from 'viem';
import { toast } from 'sonner';
import { scrollSepolia } from 'viem/chains';
// import { scrollSepolia } from '@/lib/chains';

const FaucetModal = () => {
  const [amount, setAmount] = useState<string>('1000');
  const [isOpen, setIsOpen] = useState(false);

  const { data: hash, error, isPending, writeContract } = useWriteContract();

  const account = useAccount();

  const handleMint = async () => {
    const amountAsBigInt = parseUnits(amount, 18); // USDC has 18 decimals
    writeContract({
      address: contracts.faucet.address,
      abi: contracts.faucet.abi,
      functionName: 'requestTokens',
      args: [amountAsBigInt],
      chain: scrollSepolia,
      account: account.address,
    });
  };

  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isConfirmed) {
      toast.success('Tokens minted successfully!', {
        description: `You have received ${amount} mock USDC.`,
        action: {
            label: 'View Tx',
            onClick: () => window.open(`https://sepolia.scrollscan.com/tx/${hash}`, '_blank'),
        },
      });
      setIsOpen(false);
      setAmount('1000');
    }
    if (error) {
        toast.error('Minting Failed', {
            description: error.message,
        });
    }
  }, [isConfirmed, error, amount, hash]);


  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild onClick={() => setIsOpen(true)}>
        <Button 
          variant="neon" 
          size="sm" 
          className="fixed bottom-6 right-6 z-50 cursor-pointer"
        >
          Testnet Faucet
        </Button>
      </DialogTrigger>
      
      <DialogContent className="sm:max-w-md glass-panel border-primary/30">
        <DialogHeader>
          <DialogTitle className="text-glow">Testnet Faucet</DialogTitle>
          <DialogDescription>
            Mint mock USDC tokens for testing on Scroll Sepolia.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="faucet-amount">Amount (USDC)</Label>
            <Input
              id="faucet-amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter amount to mint"
              className="bg-input/20 border-primary/30 focus:border-primary/60 font-mono"
            />
          </div>
          <div className="text-xs text-muted-foreground">
            <p>• Max: 10,000 USDC per request.</p>
          </div>
        </div>
        
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setIsOpen(false)} disabled={isPending || isConfirming}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="neon"
            onClick={handleMint}
            disabled={isPending || isConfirming || !amount || parseFloat(amount) <= 0}
            className="glitch-effect"
          >
            {isPending ? 'Confirm in wallet...' : isConfirming ? 'Minting...' : 'Mint Tokens'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default FaucetModal;