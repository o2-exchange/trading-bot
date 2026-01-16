/**
 * Pro Mode Backtest Types
 * Types for backtesting configuration, results, and metrics
 */

// ============================================
// BAR DATA
// ============================================

export interface BarData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type BarResolution = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1D';

export const BAR_RESOLUTION_LABELS: Record<BarResolution, string> = {
  '1m': '1 Minute',
  '5m': '5 Minutes',
  '15m': '15 Minutes',
  '30m': '30 Minutes',
  '1h': '1 Hour',
  '4h': '4 Hours',
  '1D': '1 Day',
};

export const BAR_RESOLUTION_MS: Record<BarResolution, number> = {
  '1m': 60000,
  '5m': 300000,
  '15m': 900000,
  '30m': 1800000,
  '1h': 3600000,
  '4h': 14400000,
  '1D': 86400000,
};

// ============================================
// DATA SOURCE CONFIGURATION
// ============================================

export type DataSourceType = 'o2-api' | 'binance' | 'bitget' | 'pyth' | 'coingecko' | 'csv-upload';

export const DATA_SOURCE_LABELS: Record<DataSourceType, string> = {
  'o2-api': 'O2 API',
  'binance': 'Binance',
  'bitget': 'Bitget',
  'pyth': 'Pyth Network',
  'coingecko': 'CoinGecko',
  'csv-upload': 'CSV Upload',
};

export interface DataSourceConfig {
  type: DataSourceType;
  marketId?: string;
  symbol?: string;
  uploadedFileId?: string;
}

// ============================================
// SLIPPAGE MODELS
// ============================================

export type SlippageModel = 'none' | 'fixed' | 'percentage';

export interface SlippageConfig {
  model: SlippageModel;
  fixedAmount?: number;
  percentage?: number;
}

// ============================================
// BACKTEST CONFIGURATION
// ============================================

export interface BacktestConfig {
  id: string;
  strategyId: string;
  strategyVersionId: string;
  startDate: number;
  endDate: number;
  dataSource: DataSourceConfig;
  initialCapital: number;
  feeRate: number;
  slippage: SlippageConfig;
  barResolution: BarResolution;
  createdAt: number;
}

// ============================================
// BACKTEST TRADE
// ============================================

export interface BacktestTrade {
  id: string;
  timestamp: number;
  side: 'buy' | 'sell';
  price: number;
  quantity: number;
  value: number;
  fee: number;
  slippage: number;
  pnl?: number;
  pnlPercent?: number;
  holdingPeriodMs?: number;
  signal: string;
  indicatorValues?: Record<string, number>;
  orderType: 'market' | 'limit';
}

// ============================================
// EQUITY CURVE
// ============================================

export interface EquityPoint {
  timestamp: number;
  equity: number;
  cash: number;
  positionValue: number;
  drawdown: number;
  drawdownPercent: number;
}

// ============================================
// DRAWDOWN
// ============================================

export interface DrawdownPoint {
  timestamp: number;
  drawdown: number;
  drawdownPercent: number;
  peakEquity: number;
  currentEquity: number;
}

// ============================================
// BACKTEST METRICS
// ============================================

export interface BacktestMetrics {
  totalReturn: number;
  totalReturnPercent: number;
  annualizedReturn: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  maxDrawdownDuration: number;
  volatility: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  averageWin: number;
  averageLoss: number;
  largestWin: number;
  largestLoss: number;
  averageTradeReturn: number;
  averageTradeReturnPercent: number;
  averageHoldingPeriodMs: number;
  tradingDays: number;
  profitableDays: number;
  profitableDaysPercent: number;
  totalVolume: number;
  totalFees: number;
  totalSlippage: number;
  expectancy: number;
  expectancyPercent: number;
}

export const EMPTY_BACKTEST_METRICS: BacktestMetrics = {
  totalReturn: 0,
  totalReturnPercent: 0,
  annualizedReturn: 0,
  sharpeRatio: 0,
  sortinoRatio: 0,
  calmarRatio: 0,
  maxDrawdown: 0,
  maxDrawdownPercent: 0,
  maxDrawdownDuration: 0,
  volatility: 0,
  totalTrades: 0,
  winningTrades: 0,
  losingTrades: 0,
  winRate: 0,
  profitFactor: 0,
  averageWin: 0,
  averageLoss: 0,
  largestWin: 0,
  largestLoss: 0,
  averageTradeReturn: 0,
  averageTradeReturnPercent: 0,
  averageHoldingPeriodMs: 0,
  tradingDays: 0,
  profitableDays: 0,
  profitableDaysPercent: 0,
  totalVolume: 0,
  totalFees: 0,
  totalSlippage: 0,
  expectancy: 0,
  expectancyPercent: 0,
};

// ============================================
// BACKTEST RESULT
// ============================================

export type BacktestStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface BacktestResult {
  id: string;
  configId: string;
  strategyId: string;
  strategyVersionId: string;
  status: BacktestStatus;
  progress: number;
  statusMessage?: string;
  errorMessage?: string;
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  drawdownCurve: DrawdownPoint[];
  executionTimeMs: number;
  barsProcessed: number;
  totalBars: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

// ============================================
// FACTORY FUNCTIONS
// ============================================

export function createEmptyBacktestResult(
  configId: string,
  strategyId: string,
  strategyVersionId: string
): BacktestResult {
  return {
    id: crypto.randomUUID(),
    configId,
    strategyId,
    strategyVersionId,
    status: 'pending',
    progress: 0,
    metrics: { ...EMPTY_BACKTEST_METRICS },
    trades: [],
    equityCurve: [],
    drawdownCurve: [],
    executionTimeMs: 0,
    barsProcessed: 0,
    totalBars: 0,
    createdAt: Date.now(),
  };
}

export function createBacktestConfig(
  strategyId: string,
  strategyVersionId: string,
  dataSource: DataSourceConfig,
  startDate: number,
  endDate: number
): BacktestConfig {
  return {
    id: crypto.randomUUID(),
    strategyId,
    strategyVersionId,
    startDate,
    endDate,
    dataSource,
    initialCapital: 10000,
    feeRate: 0.001,
    slippage: {
      model: 'percentage',
      percentage: 0.05,
    },
    barResolution: '1h',
    createdAt: Date.now(),
  };
}
