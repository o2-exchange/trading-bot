/**
 * Pro Mode Live Trading Types
 * Types for paper trading, live trading, and risk management
 */

// ============================================
// TRADING MODE
// ============================================

export type TradingMode = 'paper' | 'live';

// ============================================
// PAPER TRADING
// ============================================

export interface PaperPosition {
  id: string;
  marketId: string;
  side: 'long' | 'short';
  quantity: number;
  averageEntryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  openedAt: number;
}

export interface PaperOrder {
  id: string;
  strategyId: string;
  marketId: string;
  side: 'buy' | 'sell';
  orderType: 'market' | 'limit' | 'stop' | 'stop_limit';
  price?: number;
  stopPrice?: number;
  quantity: number;
  filledQuantity: number;
  status: 'pending' | 'open' | 'partial' | 'filled' | 'cancelled' | 'rejected';
  createdAt: number;
  filledAt?: number;
  reason?: string;
  fillPrice?: number;
}

export interface PaperTrade {
  id: string;
  strategyId: string;
  orderId: string;
  marketId: string;
  side: 'buy' | 'sell';
  price: number;
  quantity: number;
  fee: number;
  slippage: number;
  timestamp: number;
  pnl?: number;
  pnlPercent?: number;
}

export interface PaperTradingState {
  mode: 'paper';
  initialCapital: number;
  currentCapital: number;
  cash: number;
  positions: Map<string, PaperPosition>; // marketId -> position
  openOrders: PaperOrder[];
  orderHistory: PaperOrder[];
  tradeHistory: PaperTrade[];
  totalPnl: number;
  totalPnlPercent: number;
  totalFees: number;
  startedAt: number;
  lastUpdatedAt: number;
}

// ============================================
// RISK MANAGEMENT
// ============================================

export interface RiskLimits {
  // Position limits
  maxPositionSize: number;           // Max quantity per position
  maxPositionValue: number;          // Max USD value per position
  maxTotalExposure: number;          // Max total USD exposure
  maxTotalExposurePercent: number;   // Max exposure as % of capital

  // Loss limits
  maxDailyLoss: number;              // Max daily loss in USD
  maxDailyLossPercent: number;       // Max daily loss as % of capital
  maxTotalLoss: number;              // Max total loss (emergency stop)
  maxTotalLossPercent: number;       // Max total loss as % of initial capital

  // Drawdown limits
  maxDrawdownPercent: number;        // Max drawdown from peak

  // Order limits
  maxOrdersPerMinute: number;        // Rate limit for orders
  maxOrderValue: number;             // Max value per order
}

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxPositionSize: 1000,
  maxPositionValue: 10000,
  maxTotalExposure: 50000,
  maxTotalExposurePercent: 50,
  maxDailyLoss: 1000,
  maxDailyLossPercent: 10,
  maxTotalLoss: 5000,
  maxTotalLossPercent: 50,
  maxDrawdownPercent: 25,
  maxOrdersPerMinute: 60,
  maxOrderValue: 5000,
};

export interface RiskStatus {
  dailyPnl: number;
  dailyPnlPercent: number;
  totalPnl: number;
  totalPnlPercent: number;
  currentDrawdown: number;
  currentDrawdownPercent: number;
  peakEquity: number;
  currentEquity: number;
  totalExposure: number;
  totalExposurePercent: number;
  ordersThisMinute: number;
  isHalted: boolean;
  haltReason?: string;
  lastCheckedAt: number;
}

export type RiskViolationType =
  | 'max_position_size'
  | 'max_position_value'
  | 'max_total_exposure'
  | 'max_daily_loss'
  | 'max_total_loss'
  | 'max_drawdown'
  | 'max_orders_per_minute'
  | 'max_order_value';

export interface RiskViolation {
  type: RiskViolationType;
  message: string;
  currentValue: number;
  limitValue: number;
  timestamp: number;
}

// ============================================
// LIVE STRATEGY RUNNER
// ============================================

export type LiveStrategyStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'paused'
  | 'stopping'
  | 'stopped'
  | 'error';

export interface LiveStrategyConfig {
  strategyId: string;
  marketId: string;
  tradingMode: TradingMode;
  initialCapital: number;
  riskLimits: RiskLimits;
  feeRate: number;
  slippagePercent: number;
}

// Live position (for live trading mode)
export interface LivePosition {
  marketId: string;
  side: 'long' | 'short';
  quantity: number;
  averageEntryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  openedAt: number;
}

// Live order (for live trading mode)
export interface LiveOrder {
  orderId: string;
  marketId: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  price: number;
  quantity: number;
  status: 'pending' | 'filled' | 'cancelled' | 'failed';
  createdAt: number;
  filledAt?: number;
  error?: string;
}

export interface LiveStrategyState {
  config: LiveStrategyConfig;
  status: LiveStrategyStatus;
  error?: string;
  paperState?: PaperTradingState;
  livePositions?: LivePosition[];  // For live trading mode
  liveOrders?: LiveOrder[];        // For live trading mode
  riskStatus: RiskStatus;
  startedAt?: number;
  stoppedAt?: number;
  lastBarTimestamp?: number;
  barsProcessed: number;
  signalsGenerated: number;
  ordersPlaced: number;
  tradesExecuted: number;
}

// ============================================
// LIVE DATA FEED
// ============================================

export interface LiveBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isComplete: boolean;  // True if bar is closed, false if still forming
}

export type LiveDataStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface LiveDataFeedState {
  status: LiveDataStatus;
  marketId: string;
  lastPrice?: number;
  lastBar?: LiveBar;
  connectedAt?: number;
  lastMessageAt?: number;
  error?: string;
}

// ============================================
// FACTORY FUNCTIONS
// ============================================

export function createEmptyPaperTradingState(initialCapital: number): PaperTradingState {
  const now = Date.now();
  return {
    mode: 'paper',
    initialCapital,
    currentCapital: initialCapital,
    cash: initialCapital,
    positions: new Map(),
    openOrders: [],
    orderHistory: [],
    tradeHistory: [],
    totalPnl: 0,
    totalPnlPercent: 0,
    totalFees: 0,
    startedAt: now,
    lastUpdatedAt: now,
  };
}

export function createEmptyRiskStatus(initialCapital: number): RiskStatus {
  return {
    dailyPnl: 0,
    dailyPnlPercent: 0,
    totalPnl: 0,
    totalPnlPercent: 0,
    currentDrawdown: 0,
    currentDrawdownPercent: 0,
    peakEquity: initialCapital,
    currentEquity: initialCapital,
    totalExposure: 0,
    totalExposurePercent: 0,
    ordersThisMinute: 0,
    isHalted: false,
    lastCheckedAt: Date.now(),
  };
}

export function createLiveStrategyConfig(
  strategyId: string,
  marketId: string,
  initialCapital: number = 10000,
  tradingMode: TradingMode = 'paper'
): LiveStrategyConfig {
  return {
    strategyId,
    marketId,
    tradingMode,
    initialCapital,
    riskLimits: { ...DEFAULT_RISK_LIMITS },
    feeRate: 0.001,
    slippagePercent: 0.05,
  };
}
