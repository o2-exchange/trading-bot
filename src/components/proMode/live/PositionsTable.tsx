/**
 * Positions Table Component
 * Display open positions with unrealized P&L
 */

import { PaperPosition } from '../../../types/proMode';

interface PositionsTableProps {
  positions: PaperPosition[];
}

export default function PositionsTable({ positions }: PositionsTableProps) {
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

  if (positions.length === 0) {
    return (
      <div className="config-section">
        <h3>Open Positions</h3>
        <div style={{
          padding: '16px',
          textAlign: 'center',
          color: 'var(--muted-foreground)',
          fontSize: '12px',
        }}>
          No open positions
        </div>
      </div>
    );
  }

  return (
    <div className="config-section">
      <h3>Open Positions ({positions.length})</h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
              <th style={{ padding: '8px 6px' }}>Market</th>
              <th style={{ padding: '8px 6px' }}>Side</th>
              <th style={{ padding: '8px 6px' }}>Quantity</th>
              <th style={{ padding: '8px 6px' }}>Entry Price</th>
              <th style={{ padding: '8px 6px' }}>Current Price</th>
              <th style={{ padding: '8px 6px' }}>Unrealized P&L</th>
              <th style={{ padding: '8px 6px' }}>Opened</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((position) => (
              <tr key={position.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 6px', fontWeight: 500 }}>
                  {position.marketId.slice(0, 8)}...
                </td>
                <td style={{
                  padding: '8px 6px',
                  color: position.side === 'long' ? '#22c55e' : '#ef4444',
                  fontWeight: 600,
                }}>
                  {position.side.toUpperCase()}
                </td>
                <td style={{ padding: '8px 6px' }}>
                  {position.quantity.toFixed(4)}
                </td>
                <td style={{ padding: '8px 6px' }}>
                  {formatCurrency(position.averageEntryPrice)}
                </td>
                <td style={{ padding: '8px 6px' }}>
                  {formatCurrency(position.currentPrice)}
                </td>
                <td style={{ padding: '8px 6px' }}>
                  <span style={{
                    color: position.unrealizedPnl >= 0 ? '#22c55e' : '#ef4444',
                    fontWeight: 500,
                  }}>
                    {formatCurrency(position.unrealizedPnl)}
                  </span>
                  <span style={{
                    marginLeft: '4px',
                    fontSize: '10px',
                    color: position.unrealizedPnlPercent >= 0 ? '#22c55e' : '#ef4444',
                  }}>
                    ({formatPercent(position.unrealizedPnlPercent)})
                  </span>
                </td>
                <td style={{ padding: '8px 6px', color: 'var(--muted-foreground)', fontSize: '11px' }}>
                  {new Date(position.openedAt).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
