
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Search, LoaderCircle } from 'lucide-react';

interface SearchBarProps {
  onSearch: (id: string) => void;
  isLoading: boolean;
}

export const SearchBar: React.FC<SearchBarProps> = ({ onSearch, isLoading }) => {
  const [inputValue, setInputValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  const handleSearch = () => {
    if (inputValue.trim() && !isLoading) {
      onSearch(inputValue.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };
  
  const showButton = inputValue.length > 0;

  return (
    <motion.div 
      className="relative w-full"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut', delay: 0.4 } }}
    >
      <div className="relative flex items-center">
        <Search className="absolute left-4 text-slate-400" size={20} />
        <motion.input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          placeholder="Enter Position ID (e.g., 0x123...)"
          className="w-full pl-12 pr-28 py-3 bg-black/30 text-slate-200 placeholder-slate-500 rounded-lg border border-cyan-400/30 focus:border-cyan-400 focus:ring-0 focus:outline-none backdrop-blur-md transition-all duration-300"
          animate={{
            scale: isFocused ? 1.02 : 1,
            boxShadow: isFocused ? '0 0 20px rgba(0, 246, 255, 0.5)' : '0 0 0px rgba(0, 246, 255, 0)',
          }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        />
        <motion.div
          className="absolute right-2"
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: showButton ? 1 : 0, x: showButton ? 0 : 10 }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
        >
          <button
            onClick={handleSearch}
            disabled={isLoading || !inputValue.trim()}
            className="flex items-center justify-center px-4 py-2 bg-cyan-500/80 hover:bg-cyan-500 text-white font-bold rounded-md disabled:bg-gray-600 disabled:cursor-not-allowed transition-all duration-300"
          >
            {isLoading ? (
              <LoaderCircle className="animate-spin" size={20} />
            ) : (
              'Search'
            )}
          </button>
        </motion.div>
      </div>
    </motion.div>
  );
};
