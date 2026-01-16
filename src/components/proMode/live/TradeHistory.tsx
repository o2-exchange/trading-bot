/**
 * Trade History Component
 * Display completed trades with realized P&L
 */

import { PaperTrade } from '../../../types/proMode';

interface TradeHistoryProps {
  trades: PaperTrade[];
  maxDisplay?: number;
}

export default function TradeHistory({ trades, maxDisplay = 50 }: TradeHistoryProps) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(value);
  };

  const formatPercent = (value: number) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
  };

  // Show most recent trades first
  const displayTrades = [...trades].reverse().slice(0, maxDisplay);

  if (trades.length === 0) {
    return (
      <div className="config-section">
        <h3>Trade History</h3>
        <div style={{
          padding: '16px',
          textAlign: 'center',
          color: 'var(--muted-foreground)',
          fontSize: '12px',
        }}>
          No trades executed yet
        </div>
      </div>
    );
  }

  // Calculate summary stats
  const totalPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const totalFees = trades.reduce((sum, t) => sum + t.fee, 0);
  const winningTrades = trades.filter(t => (t.pnl || 0) > 0).length;
  const losingTrades = trades.filter(t => (t.pnl || 0) < 0).length;

  return (
    <div className="config-section">
      <h3>Trade History ({trades.length} trades)</h3>

      {/* Summary Stats */}
      <div style={{
        display: 'flex',
        gap: '16px',
        marginBottom: '10px',
        padding: '8px 10px',
        background: 'var(--background)',
        borderRadius: '6px',
        fontSize: '11px',
      }}>
        <div>
          <span style={{ color: 'var(--muted-foreground)' }}>P&L: </span>
          <span style={{ color: totalPnl >= 0 ? '#22c55e' : '#ef4444', fontWeight: 500 }}>
            {formatCurrency(totalPnl)}
          </span>
        </div>
        <div>
          <span style={{ color: 'var(--muted-foreground)' }}>Wins: </span>
          <span style={{ color: '#22c55e' }}>{winningTrades}</span>
        </div>
        <div>
          <span style={{ color: 'var(--muted-foreground)' }}>Losses: </span>
          <span style={{ color: '#ef4444' }}>{losingTrades}</span>
        </div>
        <div>
          <span style={{ color: 'var(--muted-foreground)' }}>Win Rate: </span>
          <span>{trades.length > 0 ? ((winningTrades / trades.length) * 100).toFixed(1) : 0}%</span>
        </div>
        <div>
          <span style={{ color: 'var(--muted-foreground)' }}>Fees: </span>
          <span>{formatCurrency(totalFees)}</span>
        </div>
      </div>

      {/* Trade Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
              <th style={{ padding: '8px 6px' }}>Time</th>
              <th style={{ padding: '8px 6px' }}>Market</th>
              <th style={{ padding: '8px 6px' }}>Side</th>
              <th style={{ padding: '8px 6px' }}>Price</th>
              <th style={{ padding: '8px 6px' }}>Quantity</th>
              <th style={{ padding: '8px 6px' }}>Value</th>
              <th style={{ padding: '8px 6px' }}>Fee</th>
              <th style={{ padding: '8px 6px' }}>P&L</th>
            </tr>
          </thead>
          <tbody>
            {displayTrades.map((trade) => (
              <tr key={trade.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 6px', color: 'var(--muted-foreground)', fontSize: '11px' }}>
                  {new Date(trade.timestamp).toLocaleString()}
                </td>
                <td style={{ padding: '8px 6px' }}>
                  {trade.marketId.slice(0, 8)}...
                </td>
                <td style={{
                  padding: '8px 6px',
                  color: trade.side === 'buy' ? '#22c55e' : '#ef4444',
                  fontWeight: 600,
                }}>
                  {trade.side.toUpperCase()}
                </td>
                <td style={{ padding: '8px 6px' }}>
                  {formatCurrency(trade.price)}
                </td>
                <td style={{ padding: '8px 6px' }}>
                  {trade.quantity.toFixed(4)}
                </td>
                <td style={{ padding: '8px 6px' }}>
                  {formatCurrency(trade.price * trade.quantity)}
                </td>
                <td style={{ padding: '8px 6px', color: 'var(--muted-foreground)' }}>
                  {formatCurrency(trade.fee)}
                </td>
                <td style={{ padding: '8px 6px' }}>
                  {trade.pnl !== undefined ? (
                    <>
                      <span style={{
                        color: trade.pnl >= 0 ? '#22c55e' : '#ef4444',
                        fontWeight: 500,
                      }}>
                        {formatCurrency(trade.pnl)}
                      </span>
                      {trade.pnlPercent !== undefined && (
                        <span style={{
                          marginLeft: '4px',
                          fontSize: '10px',
                          color: trade.pnlPercent >= 0 ? '#22c55e' : '#ef4444',
                        }}>
                          ({formatPercent(trade.pnlPercent)})
                        </span>
                      )}
                    </>
                  ) : (
                    <span style={{ color: 'var(--muted-foreground)' }}>-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {trades.length > maxDisplay && (
          <p style={{ color: 'var(--muted-foreground)', marginTop: '8px', textAlign: 'center', fontSize: '11px' }}>
            Showing {maxDisplay} of {trades.length} trades
          </p>
        )}
      </div>
    </div>
  );
}
