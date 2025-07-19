import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PositionsTable } from './PositionsTable';
import { HistoryTable } from './HistoryTable'; // Import our new component

export const TabsSection = () => {
  return (
    <div className="glass-panel h-full">
      <Tabs defaultValue="positions" className="w-full h-full flex flex-col">
        <TabsList className="grid w-full grid-cols-2 bg-card/20 border-b border-primary/20">
          <TabsTrigger 
            value="positions"
            className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
          >
            Positions
          </TabsTrigger>
          <TabsTrigger 
            value="history"
            className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
          >
            Trade History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="positions" className="mt-0 flex-1 overflow-y-auto">
          <PositionsTable />
        </TabsContent>

        <TabsContent value="history" className="mt-0 flex-1 overflow-y-auto">
          <HistoryTable />
        </TabsContent>
      </Tabs>
    </div>
  );
};