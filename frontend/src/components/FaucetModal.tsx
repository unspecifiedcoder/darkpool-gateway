import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

const FaucetModal = () => {
  const [amount, setAmount] = useState<string>('1000');
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleMint = async () => {
    setIsLoading(true);
    try {
      // This will be replaced with actual smart contract interaction
      console.log(`Minting ${amount} USDC`);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate transaction
      setIsOpen(false);
      setAmount('1000');
    } catch (error) {
      console.error('Minting failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild onClick={() => setIsOpen(true)}>
        <Button 
          variant="neon" 
          size="sm" 
          className="fixed bottom-6 right-6 z-50"
        >
          <span className='cursor-pointer'>
          Testnet Faucet
          </span>
        </Button>
      </DialogTrigger>
      
      <DialogContent className="sm:max-w-md glass-panel border-primary/30">
        <DialogHeader>
          <DialogTitle className="text-glow cursor-pointer">Testnet Faucet</DialogTitle>
          <DialogDescription>
            Mint mock USDC tokens for testing on Optimism Sepolia
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
          
          <div className="text-xs text-muted-foreground space-y-1">
            <p>• Maximum: 10,000 USDC per request</p>
            <p>• Cooldown: 24 hours between requests</p>
            <p>• Only available on Optimism Sepolia testnet</p>
          </div>
        </div>
        
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setIsOpen(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="neon"
            onClick={handleMint}
            disabled={isLoading || !amount || parseFloat(amount) <= 0}
            className="glitch-effect"
          >
            {isLoading ? 'Minting...' : 'Mint Tokens'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default FaucetModal;