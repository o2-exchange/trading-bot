/**
 * Live Trading Panel Component
 * Main interface for paper/live trading with strategies
 */

import { useState, useEffect } from 'react';
import {
  CustomStrategy,
  LiveStrategyState,
  LiveStrategyConfig,
  RiskLimits,
  TradingMode,
  DEFAULT_RISK_LIMITS,
  createLiveStrategyConfig,
} from '../../../types/proMode';
import { liveStrategyRunner } from '../../../services/proMode/liveStrategyRunner';
import { paperTradingService } from '../../../services/proMode/paperTradingService';
import { liveOrderExecutor } from '../../../services/proMode/liveOrderExecutor';
import { riskManager } from '../../../services/proMode/riskManager';
import { sessionService } from '../../../services/sessionService';
import { useWalletStore } from '../../../stores/useWalletStore';
import RiskControlsConfig from './RiskControlsConfig';
import PositionsTable from './PositionsTable';
import TradeHistory from './TradeHistory';

interface LiveTradingPanelProps {
  strategy: CustomStrategy | null;
  marketId: string;
  currentPrice?: number;
}

export default function LiveTradingPanel({
  strategy,
  marketId,
  currentPrice,
}: LiveTradingPanelProps) {
  const [tradingMode, setTradingMode] = useState<TradingMode>('paper');
  const [initialCapital, setInitialCapital] = useState(10000);
  const [riskLimits, setRiskLimits] = useState<RiskLimits>(DEFAULT_RISK_LIMITS);
  const [isConfiguring, setIsConfiguring] = useState(true);
  const [runnerState, setRunnerState] = useState<LiveStrategyState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasActiveSession, setHasActiveSession] = useState(false);
  const [showLiveWarning, setShowLiveWarning] = useState(false);

  const connectedWallet = useWalletStore((state) => state.connectedWallet);
  const isWalletConnected = !!connectedWallet;

  // Check for active session when wallet changes
  useEffect(() => {
    const checkSession = async () => {
      if (connectedWallet?.address) {
        const session = await sessionService.getActiveSession(connectedWallet.address);
        setHasActiveSession(!!session);
      } else {
        setHasActiveSession(false);
      }
    };
    checkSession();
  }, [connectedWallet?.address]);

  // Subscribe to runner state changes
  useEffect(() => {
    const unsubscribe = liveStrategyRunner.subscribe((state) => {
      setRunnerState(state);
    });
    return () => unsubscribe();
  }, []);

  // Update prices when they change
  useEffect(() => {
    if (currentPrice && runnerState?.status === 'running') {
      liveStrategyRunner.updatePrice(currentPrice);
    }
  }, [currentPrice, runnerState?.status]);

  const handleStart = async () => {
    if (!strategy) {
      setError('No strategy selected');
      return;
    }

    setError(null);
    setIsConfiguring(false);

    try {
      const config = createLiveStrategyConfig(
        strategy.id,
        marketId,
        initialCapital,
        tradingMode
      );
      config.riskLimits = riskLimits;

      await liveStrategyRunner.initialize(config);
      await liveStrategyRunner.start();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start trading');
      setIsConfiguring(true);
    }
  };

  const handleStop = async () => {
    await liveStrategyRunner.stop();
  };

  const handleEmergencyStop = async () => {
    await liveStrategyRunner.emergencyStop();
  };

  const handlePause = () => {
    liveStrategyRunner.pause();
  };

  const handleResume = () => {
    liveStrategyRunner.resume();
  };

  const handleReset = () => {
    liveStrategyRunner.destroy();
    setRunnerState(null);
    setIsConfiguring(true);
    setError(null);
  };

  if (!strategy) {
    return (
      <div className="live-trading-panel">
        <div className="empty-state">
          <h3>No Strategy Selected</h3>
          <p>Select a strategy to start paper or live trading</p>
        </div>
      </div>
    );
  }

  // Configuration mode
  if (isConfiguring) {
    return (
      <div className="live-trading-panel">
        <h2>Live Trading Setup</h2>
        <p style={{ color: 'var(--muted-foreground)', marginBottom: '12px', fontSize: '13px' }}>
          Strategy: <strong>{strategy.name}</strong>
        </p>

        {error && (
          <div className="error-banner" style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '6px',
            padding: '10px',
            marginBottom: '12px',
            color: '#ef4444',
            fontSize: '13px',
          }}>
            {error}
          </div>
        )}

        {/* Live Trading Warning Modal */}
        {showLiveWarning && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}>
            <div style={{
              background: 'var(--card)',
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '500px',
              border: '2px solid #ef4444',
            }}>
              <h3 style={{ color: '#ef4444', marginBottom: '16px', fontSize: '18px' }}>
                WARNING: Live Trading Mode
              </h3>
              <div style={{ fontSize: '13px', lineHeight: '1.6', marginBottom: '16px' }}>
                <p style={{ marginBottom: '12px' }}>
                  You are about to enable <strong style={{ color: '#ef4444' }}>LIVE TRADING</strong>.
                  This will execute real orders on the O2 exchange using your connected wallet.
                </p>
                <p style={{ marginBottom: '12px', color: '#eab308' }}>
                  <strong>REAL MONEY IS AT RISK.</strong> You may lose some or all of your funds.
                </p>
                <ul style={{ paddingLeft: '20px', marginBottom: '12px' }}>
                  <li>All orders will be executed with real funds</li>
                  <li>Strategy bugs could result in significant losses</li>
                  <li>Market conditions can change rapidly</li>
                  <li>Risk controls may not prevent all losses</li>
                </ul>
                <p>
                  Only proceed if you understand and accept these risks.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  onClick={() => setShowLiveWarning(false)}
                  style={{
                    flex: 1,
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    background: 'transparent',
                    cursor: 'pointer',
                    color: 'var(--foreground)',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setTradingMode('live');
                    setShowLiveWarning(false);
                  }}
                  style={{
                    flex: 1,
                    padding: '12px',
                    borderRadius: '8px',
                    border: 'none',
                    background: '#ef4444',
                    color: 'white',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  I Understand, Enable Live Trading
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Trading Mode */}
        <div className="config-section">
          <h3>Trading Mode</h3>
          <div className="config-row">
            <button
              className={`mode-btn ${tradingMode === 'paper' ? 'active' : ''}`}
              onClick={() => setTradingMode('paper')}
              style={{
                flex: 1,
                padding: '10px',
                borderRadius: '6px',
                border: tradingMode === 'paper' ? '2px solid var(--primary)' : '1px solid var(--border)',
                background: tradingMode === 'paper' ? 'rgba(34, 197, 94, 0.1)' : 'transparent',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: '13px' }}>Paper Trading</div>
              <div style={{ fontSize: '11px', color: 'var(--muted-foreground)' }}>
                Simulate trades with real market data
              </div>
            </button>

            <button
              className={`mode-btn ${tradingMode === 'live' ? 'active' : ''}`}
              onClick={() => {
                if (!isWalletConnected) {
                  setError('Please connect your wallet first');
                  return;
                }
                if (!hasActiveSession) {
                  setError('Please create a trading session from the main page first');
                  return;
                }
                setShowLiveWarning(true);
              }}
              style={{
                flex: 1,
                padding: '10px',
                borderRadius: '6px',
                border: tradingMode === 'live' ? '2px solid #ef4444' : '1px solid var(--border)',
                background: tradingMode === 'live' ? 'rgba(239, 68, 68, 0.1)' : 'transparent',
                cursor: (!isWalletConnected || !hasActiveSession) ? 'not-allowed' : 'pointer',
                opacity: (!isWalletConnected || !hasActiveSession) ? 0.5 : 1,
              }}
            >
              <div style={{ fontWeight: 600, fontSize: '13px', color: tradingMode === 'live' ? '#ef4444' : 'inherit' }}>
                Live Trading
              </div>
              <div style={{ fontSize: '11px', color: 'var(--muted-foreground)' }}>
                {!isWalletConnected
                  ? 'Connect wallet first'
                  : !hasActiveSession
                    ? 'Create session first'
                    : 'Execute real trades with real funds'}
              </div>
            </button>
          </div>
        </div>

        {/* Capital Configuration */}
        <div className="config-section">
          <h3>Initial Capital</h3>
          <div className="config-row">
            <div className="config-field">
              <label>Capital (USD)</label>
              <input
                type="number"
                value={initialCapital}
                onChange={(e) => setInitialCapital(Number(e.target.value))}
                min={100}
                max={10000000}
              />
            </div>
          </div>
        </div>

        {/* Risk Controls */}
        <RiskControlsConfig
          limits={riskLimits}
          onLimitsChange={setRiskLimits}
        />

        {/* Start Button */}
        <button
          className="run-backtest-btn"
          onClick={handleStart}
          style={{ background: tradingMode === 'paper' ? '#22c55e' : '#ef4444' }}
        >
          Start {tradingMode === 'paper' ? 'Paper' : 'Live'} Trading
        </button>
      </div>
    );
  }

  // Trading mode - show live status
  return (
    <div className="live-trading-panel">
      {/* Live Trading Warning Banner */}
      {tradingMode === 'live' && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.15)',
          border: '2px solid #ef4444',
          borderRadius: '8px',
          padding: '12px 16px',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '24px' }}>!</span>
            <div>
              <div style={{ color: '#ef4444', fontWeight: 700, fontSize: '14px' }}>
                LIVE TRADING MODE - REAL FUNDS AT RISK
              </div>
              <div style={{ color: '#ef4444', fontSize: '12px', opacity: 0.9 }}>
                All orders will be executed on O2 with your connected wallet
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header with status */}
      <div className="results-header" style={{ marginBottom: '24px' }}>
        <div>
          <h2 style={{ color: tradingMode === 'live' ? '#ef4444' : 'inherit' }}>
            {tradingMode === 'paper' ? 'Paper' : 'LIVE'} Trading
          </h2>
          <p style={{ color: 'var(--muted-foreground)', margin: 0 }}>
            {strategy.name}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span className={`strategy-status ${runnerState?.status || 'idle'}`}>
            {runnerState?.status || 'idle'}
          </span>

          {/* Emergency Stop Button */}
          <button
            onClick={handleEmergencyStop}
            style={{
              background: '#ef4444',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 16px',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            EMERGENCY STOP
          </button>
        </div>
      </div>

      {/* Risk Alert */}
      {runnerState?.riskStatus?.isHalted && (
        <div className="error-banner" style={{
          background: 'rgba(239, 68, 68, 0.1)',
          border: '2px solid rgba(239, 68, 68, 0.5)',
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '24px',
          color: '#ef4444',
          fontWeight: 600,
        }}>
          TRADING HALTED: {runnerState.riskStatus.haltReason}
          <button
            onClick={() => riskManager.resumeTrading()}
            style={{
              marginLeft: '16px',
              background: 'transparent',
              border: '1px solid #ef4444',
              borderRadius: '4px',
              padding: '4px 12px',
              color: '#ef4444',
              cursor: 'pointer',
            }}
          >
            Resume Trading
          </button>
        </div>
      )}

      {/* Key Metrics */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Current Capital</div>
          <div className="metric-value">
            ${tradingMode === 'paper'
              ? (runnerState?.paperState?.currentCapital.toFixed(2) || initialCapital.toFixed(2))
              : (runnerState?.riskStatus?.currentEquity.toFixed(2) || initialCapital.toFixed(2))}
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Total P&L</div>
          <div className={`metric-value ${(tradingMode === 'paper' ? (runnerState?.paperState?.totalPnl || 0) : (runnerState?.riskStatus?.totalPnl || 0)) >= 0 ? 'positive' : 'negative'}`}>
            ${tradingMode === 'paper'
              ? (runnerState?.paperState?.totalPnl.toFixed(2) || '0.00')
              : (runnerState?.riskStatus?.totalPnl.toFixed(2) || '0.00')}
          </div>
          <div className={`metric-percent ${(tradingMode === 'paper' ? (runnerState?.paperState?.totalPnlPercent || 0) : (runnerState?.riskStatus?.totalPnlPercent || 0)) >= 0 ? 'positive' : 'negative'}`}>
            {(tradingMode === 'paper' ? (runnerState?.paperState?.totalPnlPercent || 0) : (runnerState?.riskStatus?.totalPnlPercent || 0)) >= 0 ? '+' : ''}
            {tradingMode === 'paper'
              ? (runnerState?.paperState?.totalPnlPercent.toFixed(2) || '0.00')
              : (runnerState?.riskStatus?.totalPnlPercent.toFixed(2) || '0.00')}%
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Daily P&L</div>
          <div className={`metric-value ${(runnerState?.riskStatus?.dailyPnl || 0) >= 0 ? 'positive' : 'negative'}`}>
            ${runnerState?.riskStatus?.dailyPnl.toFixed(2) || '0.00'}
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Drawdown</div>
          <div className="metric-value negative">
            {runnerState?.riskStatus?.currentDrawdownPercent.toFixed(2) || '0.00'}%
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Signals</div>
          <div className="metric-value">
            {runnerState?.signalsGenerated || 0}
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Trades</div>
          <div className="metric-value">
            {runnerState?.tradesExecuted || 0}
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Bars Processed</div>
          <div className="metric-value">
            {runnerState?.barsProcessed || 0}
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Total Fees</div>
          <div className="metric-value">
            {tradingMode === 'paper'
              ? `$${runnerState?.paperState?.totalFees.toFixed(2) || '0.00'}`
              : 'On-chain'}
          </div>
        </div>
      </div>

      {/* Control Buttons */}
      <div style={{ display: 'flex', gap: '12px', marginTop: '24px', marginBottom: '24px' }}>
        {runnerState?.status === 'running' && (
          <button
            onClick={handlePause}
            style={{
              flex: 1,
              padding: '12px',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--foreground)',
            }}
          >
            Pause
          </button>
        )}

        {runnerState?.status === 'paused' && (
          <button
            onClick={handleResume}
            style={{
              flex: 1,
              padding: '12px',
              borderRadius: '8px',
              border: '1px solid var(--primary)',
              background: 'var(--primary)',
              cursor: 'pointer',
              color: 'white',
            }}
          >
            Resume
          </button>
        )}

        {(runnerState?.status === 'running' || runnerState?.status === 'paused') && (
          <button
            onClick={handleStop}
            style={{
              flex: 1,
              padding: '12px',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--foreground)',
            }}
          >
            Stop Trading
          </button>
        )}

        {(runnerState?.status === 'stopped' || runnerState?.status === 'error') && (
          <button
            onClick={handleReset}
            style={{
              flex: 1,
              padding: '12px',
              borderRadius: '8px',
              border: '1px solid var(--primary)',
              background: 'var(--primary)',
              cursor: 'pointer',
              color: 'white',
            }}
          >
            Reset & Configure
          </button>
        )}
      </div>

      {/* Positions Table */}
      <PositionsTable
        positions={
          tradingMode === 'paper'
            ? paperTradingService.getAllPositions()
            : (runnerState?.livePositions || []).map(p => ({
                id: p.marketId,
                marketId: p.marketId,
                side: p.side,
                quantity: p.quantity,
                averageEntryPrice: p.averageEntryPrice,
                currentPrice: p.currentPrice,
                unrealizedPnl: p.unrealizedPnl,
                unrealizedPnlPercent: p.unrealizedPnlPercent,
                openedAt: p.openedAt,
              }))
        }
      />

      {/* Trade History / Live Orders */}
      {tradingMode === 'paper' ? (
        <TradeHistory trades={paperTradingService.getTradeHistory()} />
      ) : (
        <div className="config-section">
          <h3>Live Orders ({runnerState?.liveOrders?.length || 0})</h3>
          {(!runnerState?.liveOrders || runnerState.liveOrders.length === 0) ? (
            <div style={{
              padding: '16px',
              textAlign: 'center',
              color: 'var(--muted-foreground)',
              fontSize: '12px',
            }}>
              No orders placed yet
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                    <th style={{ padding: '8px 6px' }}>Time</th>
                    <th style={{ padding: '8px 6px' }}>Order ID</th>
                    <th style={{ padding: '8px 6px' }}>Side</th>
                    <th style={{ padding: '8px 6px' }}>Type</th>
                    <th style={{ padding: '8px 6px' }}>Price</th>
                    <th style={{ padding: '8px 6px' }}>Quantity</th>
                    <th style={{ padding: '8px 6px' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[...(runnerState.liveOrders || [])].reverse().slice(0, 50).map((order) => (
                    <tr key={order.orderId} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 6px', color: 'var(--muted-foreground)', fontSize: '11px' }}>
                        {new Date(order.createdAt).toLocaleString()}
                      </td>
                      <td style={{ padding: '8px 6px', fontSize: '11px' }}>
                        {order.orderId.slice(0, 12)}...
                      </td>
                      <td style={{
                        padding: '8px 6px',
                        color: order.side === 'buy' ? '#22c55e' : '#ef4444',
                        fontWeight: 600,
                      }}>
                        {order.side.toUpperCase()}
                      </td>
                      <td style={{ padding: '8px 6px' }}>
                        {order.type.toUpperCase()}
                      </td>
                      <td style={{ padding: '8px 6px' }}>
                        ${order.price.toFixed(2)}
                      </td>
                      <td style={{ padding: '8px 6px' }}>
                        {order.quantity.toFixed(4)}
                      </td>
                      <td style={{ padding: '8px 6px' }}>
                        <span style={{
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '10px',
                          background: order.status === 'filled' ? 'rgba(34, 197, 94, 0.2)' :
                                      order.status === 'failed' ? 'rgba(239, 68, 68, 0.2)' :
                                      order.status === 'pending' ? 'rgba(234, 179, 8, 0.2)' :
                                      'rgba(107, 114, 128, 0.2)',
                          color: order.status === 'filled' ? '#22c55e' :
                                 order.status === 'failed' ? '#ef4444' :
                                 order.status === 'pending' ? '#eab308' :
                                 'var(--muted-foreground)',
                        }}>
                          {order.status.toUpperCase()}
                        </span>
                        {order.error && (
                          <div style={{ fontSize: '10px', color: '#ef4444', marginTop: '2px' }}>
                            {order.error}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
