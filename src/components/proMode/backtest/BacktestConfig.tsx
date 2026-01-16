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
import { externalDataService, O2Environment } from '../../../services/proMode/externalDataService';

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
  const [dataSourceType, setDataSourceType] = useState<DataSourceType>('o2-api');
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [bitgetSymbol, setBitgetSymbol] = useState('BTCUSDT');
  const [bitgetSymbols, setBitgetSymbols] = useState<Array<{ symbol: string; baseCoin: string; quoteCoin: string }>>([]);
  const [isLoadingBitgetSymbols, setIsLoadingBitgetSymbols] = useState(false);
  const [o2MarketId, setO2MarketId] = useState('');
  const [o2Markets, setO2Markets] = useState<Array<{ id: string; baseSymbol: string; quoteSymbol: string }>>([]);
  const [isLoadingO2Markets, setIsLoadingO2Markets] = useState(false);
  const [o2MarketsError, setO2MarketsError] = useState<string | null>(null);
  const [o2Environment, setO2Environment] = useState<O2Environment>('testnet');
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

  // Fetch O2 markets when data source is O2 or environment changes
  useEffect(() => {
    if (dataSourceType === 'o2-api') {
      setIsLoadingO2Markets(true);
      setO2Markets([]); // Clear markets while loading
      setO2MarketId(''); // Reset selection
      setO2MarketsError(null); // Clear previous error

      // Update the environment in the service
      externalDataService.setO2Environment(o2Environment);

      externalDataService.getO2Markets()
        .then(markets => {
          setO2Markets(markets);
          if (markets.length > 0) {
            setO2MarketId(markets[0].id);
          } else {
            setO2MarketsError('No markets available on this network');
          }
        })
        .catch(error => {
          console.error('Failed to fetch O2 markets:', error);
          setO2Markets([]);
          setO2MarketsError(`Failed to load markets: ${error instanceof Error ? error.message : 'Network error'}`);
        })
        .finally(() => {
          setIsLoadingO2Markets(false);
        });
    }
  }, [dataSourceType, o2Environment]);

  // Fetch Bitget symbols when data source is Bitget
  useEffect(() => {
    if (dataSourceType === 'bitget') {
      setIsLoadingBitgetSymbols(true);
      setBitgetSymbols([]); // Clear symbols while loading

      externalDataService.getBitgetSymbols()
        .then(symbols => {
          setBitgetSymbols(symbols);
          if (symbols.length > 0) {
            setBitgetSymbol(symbols[0].symbol);
          }
        })
        .catch(error => {
          console.error('Failed to fetch Bitget symbols:', error);
          setBitgetSymbols([]);
        })
        .finally(() => {
          setIsLoadingBitgetSymbols(false);
        });
    }
  }, [dataSourceType]);

  // Update config when form changes
  useEffect(() => {
    if (!strategy || !startDate || !endDate) return;

    const dataSource: DataSourceConfig = {
      type: dataSourceType,
      symbol: dataSourceType === 'binance' ? symbol : dataSourceType === 'bitget' ? bitgetSymbol : undefined,
      marketId: dataSourceType === 'o2-api' ? o2MarketId : undefined,
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
  }, [strategy, dataSourceType, symbol, bitgetSymbol, o2MarketId, resolution, startDate, endDate, initialCapital, feeRate, slippagePercent]);

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
              <option value="o2-api">O2 Exchange</option>
              <option value="bitget">Bitget</option>
              <option value="binance">Binance</option>
              <option value="coingecko">CoinGecko</option>
              <option value="csv-upload">CSV Upload</option>
            </select>
          </div>

          {dataSourceType === 'o2-api' && (
            <>
              <div className="config-field">
                <label>Network</label>
                <select
                  value={o2Environment}
                  onChange={(e) => setO2Environment(e.target.value as O2Environment)}
                >
                  <option value="testnet">Testnet</option>
                  <option value="mainnet">Mainnet</option>
                  <option value="devnet">Devnet</option>
                </select>
              </div>
              <div className="config-field">
                <label>Market</label>
                <select
                  value={o2MarketId}
                  onChange={(e) => setO2MarketId(e.target.value)}
                  disabled={isLoadingO2Markets || !!o2MarketsError}
                >
                  {isLoadingO2Markets ? (
                    <option>Loading markets...</option>
                  ) : o2MarketsError ? (
                    <option>Error loading markets</option>
                  ) : o2Markets.length === 0 ? (
                    <option>No markets available</option>
                  ) : (
                    o2Markets.map(market => (
                      <option key={market.id} value={market.id}>
                        {market.baseSymbol}/{market.quoteSymbol}
                      </option>
                    ))
                  )}
                </select>
                {o2MarketsError && (
                  <span className="config-error" style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                    {o2MarketsError}
                  </span>
                )}
              </div>
            </>
          )}

          {dataSourceType === 'bitget' && (
            <div className="config-field">
              <label>Symbol</label>
              <select
                value={bitgetSymbol}
                onChange={(e) => setBitgetSymbol(e.target.value)}
                disabled={isLoadingBitgetSymbols}
              >
                {isLoadingBitgetSymbols ? (
                  <option>Loading symbols...</option>
                ) : bitgetSymbols.length === 0 ? (
                  <>
                    <option value="BTCUSDT">BTC/USDT</option>
                    <option value="ETHUSDT">ETH/USDT</option>
                    <option value="SOLUSDT">SOL/USDT</option>
                    <option value="XRPUSDT">XRP/USDT</option>
                  </>
                ) : (
                  bitgetSymbols.map(s => (
                    <option key={s.symbol} value={s.symbol}>
                      {s.baseCoin}/{s.quoteCoin}
                    </option>
                  ))
                )}
              </select>
            </div>
          )}

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
