import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

const REFRESH_INTERVAL_MS = 40000; // 40 seconds

export const RefreshTimer = ({ onRefresh }: { onRefresh: () => void }) => {
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL_MS / 1000);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          handleRefresh();
          return REFRESH_INTERVAL_MS / 1000;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [onRefresh]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await onRefresh();
    setCountdown(REFRESH_INTERVAL_MS / 1000);
    setIsRefreshing(false);
  };

  const progress = (countdown / (REFRESH_INTERVAL_MS / 1000)) * 100;

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground font-mono">
        Auto-refresh in {countdown}s
      </span>
      <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={isRefreshing}>
        <div className="relative">
          <svg className="w-6 h-6" viewBox="0 0 24 24">
            <circle className="text-primary/20" strokeWidth="2" stroke="currentColor" fill="transparent" r="10" cx="12" cy="12"/>
            <circle
              className="text-primary"
              strokeWidth="2" stroke="currentColor" fill="transparent" r="10" cx="12" cy="12"
              strokeDasharray={2 * Math.PI * 10}
              strokeDashoffset={(2 * Math.PI * 10) * (1 - progress / 100)}
              style={{ transition: 'stroke-dashoffset 1s linear' }}
              transform="rotate(-90 12 12)"
            />
          </svg>
          <RefreshCw className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        </div>
      </Button>
    </div>
  );
};