/**
 * Backtest Configuration Component
 * Configure backtest parameters before running
 */

import { useState, useEffect } from 'react';
import {
  CustomStrategy,
  BacktestConfig as BacktestConfigType,
  DataSourceConfig,
  BarResolution,
  BAR_RESOLUTION_LABELS,
  DATA_SOURCE_LABELS,
  DataSourceType,
  createBacktestConfig,
} from '../../../types/proMode';

interface BacktestConfigProps {
  strategy: CustomStrategy | null;
  config: BacktestConfigType | null;
  onConfigChange: (config: BacktestConfigType) => void;
  onRunBacktest: () => void;
  isBacktesting: boolean;
}

export default function BacktestConfig({
  strategy,
  config,
  onConfigChange,
  onRunBacktest,
  isBacktesting,
}: BacktestConfigProps) {
  // Local state for form
  const [dataSourceType, setDataSourceType] = useState<DataSourceType>('binance');
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [resolution, setResolution] = useState<BarResolution>('1h');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [initialCapital, setInitialCapital] = useState(10000);
  const [feeRate, setFeeRate] = useState(0.01);
  const [slippagePercent, setSlippagePercent] = useState(0.05);

  // Initialize dates
  useEffect(() => {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 3); // Default to 3 months

    setEndDate(end.toISOString().split('T')[0]);
    setStartDate(start.toISOString().split('T')[0]);
  }, []);

  // Update config when form changes
  useEffect(() => {
    if (!strategy || !startDate || !endDate) return;

    const dataSource: DataSourceConfig = {
      type: dataSourceType,
      symbol: dataSourceType === 'binance' ? symbol : undefined,
    };

    const newConfig = createBacktestConfig(
      strategy.id,
      strategy.version,
      dataSource,
      new Date(startDate).getTime(),
      new Date(endDate).getTime()
    );

    newConfig.initialCapital = initialCapital;
    newConfig.feeRate = feeRate / 100; // Convert to decimal
    newConfig.barResolution = resolution;
    newConfig.slippage = {
      model: 'percentage',
      percentage: slippagePercent,
    };

    onConfigChange(newConfig);
  }, [strategy, dataSourceType, symbol, resolution, startDate, endDate, initialCapital, feeRate, slippagePercent]);

  if (!strategy) {
    return (
      <div className="backtest-config">
        <div className="empty-state">
          <h3>No Strategy Selected</h3>
          <p>Select or create a strategy to configure backtesting</p>
        </div>
      </div>
    );
  }

  return (
    <div className="backtest-config">
      <h2>Backtest Configuration</h2>
      <p style={{ color: 'var(--muted-foreground)', marginBottom: '24px' }}>
        Testing strategy: <strong>{strategy.name}</strong>
      </p>

      {/* Data Source */}
      <div className="config-section">
        <h3>Data Source</h3>
        <div className="config-row">
          <div className="config-field">
            <label>Source</label>
            <select
              value={dataSourceType}
              onChange={(e) => setDataSourceType(e.target.value as DataSourceType)}
            >
              <option value="binance">Binance</option>
              <option value="coingecko">CoinGecko</option>
              <option value="csv-upload">CSV Upload</option>
            </select>
          </div>

          {dataSourceType === 'binance' && (
            <div className="config-field">
              <label>Symbol</label>
              <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                <option value="BTCUSDT">BTC/USDT</option>
                <option value="ETHUSDT">ETH/USDT</option>
                <option value="SOLUSDT">SOL/USDT</option>
                <option value="BNBUSDT">BNB/USDT</option>
                <option value="XRPUSDT">XRP/USDT</option>
                <option value="ADAUSDT">ADA/USDT</option>
                <option value="DOGEUSDT">DOGE/USDT</option>
                <option value="AVAXUSDT">AVAX/USDT</option>
              </select>
            </div>
          )}

          <div className="config-field">
            <label>Resolution</label>
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value as BarResolution)}
            >
              <option value="1m">1 Minute</option>
              <option value="5m">5 Minutes</option>
              <option value="15m">15 Minutes</option>
              <option value="30m">30 Minutes</option>
              <option value="1h">1 Hour</option>
              <option value="4h">4 Hours</option>
              <option value="1D">1 Day</option>
            </select>
          </div>
        </div>
      </div>

      {/* Time Range */}
      <div className="config-section">
        <h3>Time Range</h3>
        <div className="config-row">
          <div className="config-field">
            <label>Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="config-field">
            <label>End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Capital & Fees */}
      <div className="config-section">
        <h3>Capital & Fees</h3>
        <div className="config-row">
          <div className="config-field">
            <label>Initial Capital (USD)</label>
            <input
              type="number"
              value={initialCapital}
              onChange={(e) => setInitialCapital(Number(e.target.value))}
              min={100}
              max={10000000}
            />
          </div>
          <div className="config-field">
            <label>Fee Rate (%)</label>
            <input
              type="number"
              value={feeRate}
              onChange={(e) => setFeeRate(Number(e.target.value))}
              min={0}
              max={1}
              step={0.001}
            />
          </div>
          <div className="config-field">
            <label>Slippage (%)</label>
            <input
              type="number"
              value={slippagePercent}
              onChange={(e) => setSlippagePercent(Number(e.target.value))}
              min={0}
              max={1}
              step={0.01}
            />
          </div>
        </div>
      </div>

      {/* Run Button */}
      <button
        className="run-backtest-btn"
        onClick={onRunBacktest}
        disabled={isBacktesting || !config}
      >
        {isBacktesting ? 'Running Backtest...' : 'Run Backtest'}
      </button>
    </div>
  );
}
