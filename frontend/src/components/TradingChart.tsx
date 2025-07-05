import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    TradingView: any;
  }
}

const TradingChart = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/tv.js';
    script.async = true;
    script.onload = () => {
      if (containerRef.current && window.TradingView) {
        new window.TradingView.widget({
          width: '100%',
          height: '100%',
          symbol: 'BINANCE:BTCUSDT',
          interval: '15',
          timezone: 'Etc/UTC',
          theme: 'dark',
          style: '1',
          locale: 'en',
          toolbar_bg: '#030617',
          enable_publishing: false,
          hide_top_toolbar: false,
          hide_legend: false,
          save_image: false,
          container_id: 'tradingview_chart',
          backgroundColor: '#030617',
          gridColor: '#1a1a2e',
          overrides: {
            'paneProperties.background': '#030617',
            'paneProperties.vertGridProperties.color': '#1a1a2e',
            'paneProperties.horzGridProperties.color': '#1a1a2e',
            'symbolWatermarkProperties.transparency': 90,
            'scalesProperties.textColor': '#ffffff',
            'mainSeriesProperties.candleStyle.upColor': '#00ff87',
            'mainSeriesProperties.candleStyle.downColor': '#ff2d55',
            'mainSeriesProperties.candleStyle.borderUpColor': '#00ff87',
            'mainSeriesProperties.candleStyle.borderDownColor': '#ff2d55',
            'mainSeriesProperties.candleStyle.wickUpColor': '#00ff87',
            'mainSeriesProperties.candleStyle.wickDownColor': '#ff2d55',
          },
        });
      }
    };
    document.head.appendChild(script);

    return () => {
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, []);

  return (
    <div className="h-full glass-panel neon-border">
      <div 
        id="tradingview_chart" 
        ref={containerRef}
        className="w-full h-full rounded-lg overflow-hidden"
      />
    </div>
  );
};

export default TradingChart;