
import { useState, useCallback } from 'react';

type CopyFn = (text: string) => Promise<boolean>;

export const useCopyToClipboard = (): [boolean, CopyFn] => {
  const [isCopied, setIsCopied] = useState<boolean>(false);

  const copy: CopyFn = useCallback(async (text) => {
    if (!navigator?.clipboard) {
      console.warn('Clipboard not supported');
      return false;
    }

    try {
      await navigator.clipboard.writeText(text);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 1500); // Reset after 1.5 seconds
      return true;
    } catch (error) {
      console.warn('Copy failed', error);
      setIsCopied(false);
      return false;
    }
  }, []);

  return [isCopied, copy];
};
