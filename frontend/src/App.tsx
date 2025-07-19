import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

import { useEffect } from "react";
import { useAccount } from "wagmi";
import { useAppActions } from "./store/useAppStore";
import ExplorerPage from "./pages/ExplorerPage";


const queryClient = new QueryClient();

const App = () => {
  const { address } = useAccount();
  const { disconnectUserClient } = useAppActions();

  useEffect(() => {
    disconnectUserClient();
  }, [address, disconnectUserClient]);

  return (
  
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/explorer" element={<ExplorerPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
)};

export default App;
