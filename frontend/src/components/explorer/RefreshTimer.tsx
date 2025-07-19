
import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';

interface RefreshTimerProps {
  onRefresh: () => void;
}

export const RefreshTimer: React.FC<RefreshTimerProps> = ({ onRefresh }) => {
  const [key, setKey] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setKey(prev => prev + 1);
      // Optional: auto-refresh logic can be added here
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  const handleClick = () => {
    setKey(prev => prev + 1);
    onRefresh();
  };

  return (
    <button onClick={handleClick} className="relative w-8 h-8 group" aria-label="Refresh Data">
      <RefreshCw className="absolute inset-0 m-auto text-slate-400 group-hover:text-cyan-400 transition-colors duration-300" size={18} />
      <svg className="w-full h-full" viewBox="0 0 100 100">
        <circle
          className="text-slate-700"
          stroke="currentColor"
          strokeWidth="8"
          cx="50"
          cy="50"
          r="45"
          fill="transparent"
        />
        <circle
          key={key}
          className="text-cyan-400 animate-refresh"
          stroke="currentColor"
          strokeWidth="8"
          cx="50"
          cy="50"
          r="45"
          fill="transparent"
          strokeDasharray="283"
          strokeDashoffset="283"
          transform="rotate(-90 50 50)"
        />
      </svg>
    </button>
  );
};
