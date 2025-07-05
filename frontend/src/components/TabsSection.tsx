import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PositionsTable from './PositionsTable';

const TabsSection = () => {
  const mockOrders = [
    // {
    //   id: '1',
    //   asset: 'BTC/USDC',
    //   type: 'Limit',
    //   side: 'Long',
    //   size: 25000,
    //   price: 42000,
    //   filled: 0,
    //   status: 'Open',
    // },
  ];

  const mockHistory = [
    // {
    //   id: '1',
    //   asset: 'BTC/USDC',
    //   type: 'Market',
    //   side: 'Long',
    //   size: 15000,
    //   price: 42800,
    //   time: '2024-01-15 14:30:22',
    //   status: 'Filled',
    // },
  ];

  return (
    <div className="glass-panel">
      <Tabs defaultValue="positions" className="w-full">
        <TabsList className="grid w-full grid-cols-3 bg-card/20 border-b border-primary/20">
          <TabsTrigger 
            value="positions"
            className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
          >
            Positions
          </TabsTrigger>
          <TabsTrigger 
            value="orders"
            className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
          >
            Open Orders
          </TabsTrigger>
          <TabsTrigger 
            value="history"
            className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
          >
            Trade History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="positions" className="mt-0">
          <PositionsTable />
        </TabsContent>

        <TabsContent value="orders" className="mt-0">
          <div className="p-6 space-y-4">
            <h3 className="text-lg font-semibold text-glow">Open Orders</h3>
            {mockOrders.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <p>No open orders</p>
                <p className="text-sm">Place orders to see them here</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 px-2 text-muted-foreground">Asset</th>
                      <th className="text-left py-3 px-2 text-muted-foreground">Type</th>
                      <th className="text-left py-3 px-2 text-muted-foreground">Side</th>
                      <th className="text-right py-3 px-2 text-muted-foreground">Size</th>
                      <th className="text-right py-3 px-2 text-muted-foreground">Price</th>
                      <th className="text-right py-3 px-2 text-muted-foreground">Filled</th>
                      <th className="text-center py-3 px-2 text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mockOrders.map((order) => (
                      <tr key={order.id} className="border-b border-border/50 hover:bg-primary/5">
                        <td className="py-4 px-2 font-mono">{order.asset}</td>
                        <td className="py-4 px-2">{order.type}</td>
                        <td className={`py-4 px-2 ${order.side === 'Long' ? 'text-success' : 'text-destructive'}`}>
                          {order.side}
                        </td>
                        <td className="py-4 px-2 text-right font-mono">${order.size.toLocaleString()}</td>
                        <td className="py-4 px-2 text-right font-mono">${order.price.toLocaleString()}</td>
                        <td className="py-4 px-2 text-right font-mono">{order.filled}%</td>
                        <td className="py-4 px-2 text-center">
                          <span className="text-yellow-400">{order.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="history" className="mt-0">
          <div className="p-6 space-y-4">
            <h3 className="text-lg font-semibold text-glow">Trade History</h3>
            {mockHistory.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <p>No trade history</p>
                <p className="text-sm">Execute trades to see history here</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 px-2 text-muted-foreground">Time</th>
                      <th className="text-left py-3 px-2 text-muted-foreground">Asset</th>
                      <th className="text-left py-3 px-2 text-muted-foreground">Type</th>
                      <th className="text-left py-3 px-2 text-muted-foreground">Side</th>
                      <th className="text-right py-3 px-2 text-muted-foreground">Size</th>
                      <th className="text-right py-3 px-2 text-muted-foreground">Price</th>
                      <th className="text-center py-3 px-2 text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mockHistory.map((trade) => (
                      <tr key={trade.id} className="border-b border-border/50 hover:bg-primary/5">
                        <td className="py-4 px-2 font-mono text-xs">{trade.time}</td>
                        <td className="py-4 px-2 font-mono">{trade.asset}</td>
                        <td className="py-4 px-2">{trade.type}</td>
                        <td className={`py-4 px-2 ${trade.side === 'Long' ? 'text-success' : 'text-destructive'}`}>
                          {trade.side}
                        </td>
                        <td className="py-4 px-2 text-right font-mono">${trade.size.toLocaleString()}</td>
                        <td className="py-4 px-2 text-right font-mono">${trade.price.toLocaleString()}</td>
                        <td className="py-4 px-2 text-center">
                          <span className="text-success">{trade.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default TabsSection;