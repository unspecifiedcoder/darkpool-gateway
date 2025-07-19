import Header from '@/components/Header';
import TradingChart from '@/components/TradingChart';
import TradingPanel from '@/components/TradingPanel';
import {TabsSection} from '@/components/TabsSection';
import FaucetModal from '@/components/FaucetModal';
import { AnimatedBackground } from "@/components/animated-background"
import { DarkAccountPanel } from '@/components/DarkAccountPanel';


const Index = () => {
  return (
    <div className="min-h-screen bg-background relative">
      <AnimatedBackground />
      
      <div className="relative z-10">
        <Header />
        
        <div className="grid grid-cols-1 lg:grid-cols-10 gap-6 p-6 h-full">
          {/* Left Column - Trading Chart and Positions */}
          <div className="lg:col-span-7 space-y-6 flex flex-col">
            {/* Trading Chart */}
            <div className="flex-1 min-h-[400px]">
              <TradingChart />
            </div>
            
            {/* Tabs Section */}
            <div className="h-80">
              <TabsSection />
            </div>
          </div>
          
          {/* Right Column - Trading Panel */}
          <div className="lg:col-span-3">
            <TradingPanel />
          </div>
        </div>
      </div>
      <FaucetModal />
      <DarkAccountPanel />
    </div>
  );
};

export default Index;
