/**
 * Backtest Results Component
 * Display backtest metrics, equity curve, and trade log
 */

import { useRef, useEffect } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi } from 'lightweight-charts';
import { BacktestResult, EMPTY_BACKTEST_METRICS } from '../../../types/proMode';

interface BacktestResultsProps {
  result: BacktestResult | null;
  isLoading: boolean;
}

export default function BacktestResults({ result, isLoading }: BacktestResultsProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    chartRef.current = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 300,
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
        timeVisible: true,
      },
    });

    // Handle resize
    const handleResize = () => {
      if (chartRef.current && chartContainerRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, []);

  // Update chart data when result changes
  useEffect(() => {
    if (!chartRef.current || !result || result.equityCurve.length === 0) return;

    // Clear existing series
    chartRef.current.timeScale().resetTimeScale();

    // Add equity line series
    const equitySeries = chartRef.current.addSeries({
      type: 'Area',
      lineColor: '#22c55e',
      topColor: 'rgba(34, 197, 94, 0.3)',
      bottomColor: 'rgba(34, 197, 94, 0.0)',
      lineWidth: 2,
    } as any);

    const equityData = result.equityCurve.map((point) => ({
      time: Math.floor(point.timestamp / 1000) as any, // Convert to seconds
      value: point.equity,
    }));

    equitySeries.setData(equityData);
    chartRef.current.timeScale().fitContent();
  }, [result]);

  if (isLoading) {
    return (
      <div className="backtest-results">
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <span>Running backtest...</span>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="backtest-results">
        <div className="empty-state">
          <h3>No Results Yet</h3>
          <p>Configure and run a backtest to see results</p>
        </div>
      </div>
    );
  }

  const metrics = result.metrics || EMPTY_BACKTEST_METRICS;

  const formatPercent = (value: number) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(value);
  };

  const formatNumber = (value: number) => {
    return value.toFixed(2);
  };

  return (
    <div className="backtest-results">
      <div className="results-header">
        <h2>Backtest Results</h2>
        <span className={`strategy-status ${result.status}`}>
          {result.status}
        </span>
      </div>

      {/* Key Metrics Grid */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Total Return</div>
          <div className={`metric-value ${metrics.totalReturn >= 0 ? 'positive' : 'negative'}`}>
            {formatCurrency(metrics.totalReturn)}
          </div>
          <div className={`metric-percent ${metrics.totalReturnPercent >= 0 ? 'positive' : 'negative'}`}>
            {formatPercent(metrics.totalReturnPercent)}
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Sharpe Ratio</div>
          <div className={`metric-value ${metrics.sharpeRatio >= 1 ? 'positive' : ''}`}>
            {formatNumber(metrics.sharpeRatio)}
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Max Drawdown</div>
          <div className="metric-value negative">
            {formatPercent(-Math.abs(metrics.maxDrawdownPercent))}
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Win Rate</div>
          <div className={`metric-value ${metrics.winRate >= 50 ? 'positive' : ''}`}>
            {formatPercent(metrics.winRate)}
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Total Trades</div>
          <div className="metric-value">
            {metrics.totalTrades}
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Profit Factor</div>
          <div className={`metric-value ${metrics.profitFactor >= 1 ? 'positive' : 'negative'}`}>
            {formatNumber(metrics.profitFactor)}
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Avg Win</div>
          <div className="metric-value positive">
            {formatCurrency(metrics.averageWin)}
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Avg Loss</div>
          <div className="metric-value negative">
            {formatCurrency(-Math.abs(metrics.averageLoss))}
          </div>
        </div>
      </div>

      {/* Equity Curve Chart */}
      <div className="chart-container">
        <h3>Equity Curve</h3>
        <div ref={chartContainerRef} className="chart-area">
          {result.equityCurve.length === 0 && (
            <div className="chart-placeholder">
              No equity data available
            </div>
          )}
        </div>
      </div>

      {/* Additional Metrics */}
      <div className="config-section">
        <h3>Detailed Metrics</h3>
        <div className="config-row" style={{ gap: '24px' }}>
          <div>
            <div className="metric-label">Sortino Ratio</div>
            <div>{formatNumber(metrics.sortinoRatio)}</div>
          </div>
          <div>
            <div className="metric-label">Calmar Ratio</div>
            <div>{formatNumber(metrics.calmarRatio)}</div>
          </div>
          <div>
            <div className="metric-label">Winning Trades</div>
            <div>{metrics.winningTrades}</div>
          </div>
          <div>
            <div className="metric-label">Losing Trades</div>
            <div>{metrics.losingTrades}</div>
          </div>
          <div>
            <div className="metric-label">Largest Win</div>
            <div>{formatCurrency(metrics.largestWin)}</div>
          </div>
          <div>
            <div className="metric-label">Largest Loss</div>
            <div>{formatCurrency(-Math.abs(metrics.largestLoss))}</div>
          </div>
          <div>
            <div className="metric-label">Total Volume</div>
            <div>{formatCurrency(metrics.totalVolume)}</div>
          </div>
          <div>
            <div className="metric-label">Total Fees</div>
            <div>{formatCurrency(metrics.totalFees)}</div>
          </div>
        </div>
      </div>

      {/* Trade Log */}
      {result.trades.length > 0 && (
        <div className="config-section">
          <h3>Trade Log ({result.trades.length} trades)</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                  <th style={{ padding: '8px' }}>Time</th>
                  <th style={{ padding: '8px' }}>Side</th>
                  <th style={{ padding: '8px' }}>Price</th>
                  <th style={{ padding: '8px' }}>Quantity</th>
                  <th style={{ padding: '8px' }}>Value</th>
                  <th style={{ padding: '8px' }}>P&L</th>
                </tr>
              </thead>
              <tbody>
                {result.trades.slice(0, 50).map((trade, index) => (
                  <tr key={trade.id || index} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px', color: 'var(--muted-foreground)' }}>
                      {new Date(trade.timestamp).toLocaleString()}
                    </td>
                    <td style={{
                      padding: '8px',
                      color: trade.side === 'buy' ? '#22c55e' : '#ef4444',
                      fontWeight: 500,
                    }}>
                      {trade.side.toUpperCase()}
                    </td>
                    <td style={{ padding: '8px' }}>{formatCurrency(trade.price)}</td>
                    <td style={{ padding: '8px' }}>{trade.quantity.toFixed(4)}</td>
                    <td style={{ padding: '8px' }}>{formatCurrency(trade.value)}</td>
                    <td style={{
                      padding: '8px',
                      color: (trade.pnl || 0) >= 0 ? '#22c55e' : '#ef4444',
                    }}>
                      {trade.pnl !== undefined ? formatCurrency(trade.pnl) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.trades.length > 50 && (
              <p style={{ color: 'var(--muted-foreground)', marginTop: '12px', textAlign: 'center' }}>
                Showing first 50 of {result.trades.length} trades
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
