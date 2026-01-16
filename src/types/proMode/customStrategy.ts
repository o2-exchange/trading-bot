/**
 * Pro Mode Custom Strategy Types
 * Types for user-defined Python trading strategies
 */

// ============================================
// STRATEGY CONFIGURATION SCHEMA
// ============================================

export interface StrategyConfigSchema {
  type: 'object';
  properties: Record<string, StrategyConfigProperty>;
  required?: string[];
}

export interface StrategyConfigProperty {
  type: 'number' | 'string' | 'boolean' | 'array';
  title: string;
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  enum?: unknown[];
}

// ============================================
// SANDBOX CONFIGURATION
// ============================================

export interface SandboxConfig {
  allowedImports: string[];
  maxExecutionTimeMs: number;     // Default: 30000ms (30 seconds)
  maxMemoryMB: number;            // Default: 256MB
  maxIterations: number;          // Default: 1000000
  maxOutputSize: number;          // Default: 1MB
}

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  allowedImports: [
    'numpy',
    'pandas',
    'math',
    'statistics',
    'decimal',
    'datetime',
    'json',
    're',
    'collections',
    'itertools',
    'functools',
  ],
  maxExecutionTimeMs: 30000,
  maxMemoryMB: 256,
  maxIterations: 1000000,
  maxOutputSize: 1024 * 1024, // 1MB
};

// ============================================
// STRATEGY VERSION
// ============================================

export interface StrategyVersion {
  id: string;
  strategyId: string;
  version: string;                    // Semantic version: "1.0.0", "1.2.3"
  pythonCode: string;
  configValues: Record<string, unknown>;
  changeLog: string;
  parentVersionId?: string;
  backtestSummary?: StrategyVersionBacktestSummary;
  createdAt: number;
}

export interface StrategyVersionBacktestSummary {
  totalReturn: number;
  totalReturnPercent: number;
  sharpeRatio: number;
  maxDrawdownPercent: number;
  winRate: number;
  totalTrades: number;
}

// ============================================
// TEMPLATE CATEGORIES
// ============================================

export type TemplateCategory =
  | 'momentum'
  | 'mean-reversion'
  | 'arbitrage'
  | 'market-making'
  | 'trend-following'
  | 'statistical'
  | 'breakout'
  | 'oscillator'
  | 'volume-based'
  | 'custom';

export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  'momentum': 'Momentum',
  'mean-reversion': 'Mean Reversion',
  'arbitrage': 'Arbitrage',
  'market-making': 'Market Making',
  'trend-following': 'Trend Following',
  'statistical': 'Statistical',
  'breakout': 'Breakout',
  'oscillator': 'Oscillator',
  'volume-based': 'Volume Based',
  'custom': 'Custom',
};

// ============================================
// CUSTOM STRATEGY
// ============================================

export type StrategyStatus = 'draft' | 'validated' | 'backtested' | 'live';

export interface CustomStrategy {
  id: string;
  name: string;
  description?: string;

  // Code & Configuration
  pythonCode: string;
  configSchema?: StrategyConfigSchema;
  configValues: Record<string, unknown>;

  // Versioning
  version: string;                    // Current version
  versionHistory: StrategyVersion[];

  // Metadata
  tags: string[];
  status: StrategyStatus;
  isTemplate: boolean;
  templateCategory?: TemplateCategory;

  // Security
  sandboxConfig: SandboxConfig;

  // Timestamps
  createdAt: number;
  updatedAt: number;
}

// ============================================
// STRATEGY SIGNALS
// ============================================

export type SignalType = 'buy' | 'sell' | 'close' | 'cancel';
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit';

export interface StrategySignal {
  type: SignalType;
  quantity: number;
  price?: number;                     // Required for limit orders
  stopPrice?: number;                 // Required for stop orders
  orderType: OrderType;
  reason?: string;                    // Optional explanation for logging
  indicatorValues?: Record<string, number>;  // Indicator values at signal time
  timestamp: number;
}

// ============================================
// EXECUTION CONTEXT
// ============================================

export interface StrategyExecutionContext {
  strategyId: string;
  marketId: string;
  params: Record<string, unknown>;    // User-configured parameters
  initialCapital: number;
  currentCapital: number;
  position: StrategyPosition | null;
  openOrders: StrategyOrder[];
}

export interface StrategyPosition {
  side: 'long' | 'short';
  quantity: number;
  averageEntryPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  openedAt: number;
}

export interface StrategyOrder {
  id: string;
  side: 'buy' | 'sell';
  orderType: OrderType;
  price?: number;
  stopPrice?: number;
  quantity: number;
  filledQuantity: number;
  status: 'pending' | 'partial' | 'filled' | 'cancelled';
  createdAt: number;
}

// ============================================
// VALIDATION
// ============================================

export type ValidationErrorType = 'syntax' | 'security' | 'interface' | 'runtime';

export interface ValidationError {
  type: ValidationErrorType;
  message: string;
  line?: number;
  column?: number;
  suggestion?: string;
}

export interface ValidationWarning {
  message: string;
  line?: number;
  suggestion?: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  syntaxCheckPassed: boolean;
  securityCheckPassed: boolean;
  interfaceCheckPassed: boolean;
}

// ============================================
// FACTORY FUNCTIONS
// ============================================

export function createEmptyStrategy(name: string = 'New Strategy'): CustomStrategy {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name,
    description: '',
    pythonCode: DEFAULT_STRATEGY_TEMPLATE,
    configSchema: undefined,
    configValues: {},
    version: '1.0.0',
    versionHistory: [],
    tags: [],
    status: 'draft',
    isTemplate: false,
    sandboxConfig: { ...DEFAULT_SANDBOX_CONFIG },
    createdAt: now,
    updatedAt: now,
  };
}

export function createStrategyVersion(
  strategy: CustomStrategy,
  changeLog: string
): StrategyVersion {
  return {
    id: crypto.randomUUID(),
    strategyId: strategy.id,
    version: strategy.version,
    pythonCode: strategy.pythonCode,
    configValues: { ...strategy.configValues },
    changeLog,
    createdAt: Date.now(),
  };
}

// ============================================
// DEFAULT TEMPLATE
// ============================================

export const DEFAULT_STRATEGY_TEMPLATE = `"""
Simple Moving Average Crossover Strategy

This strategy demonstrates a basic SMA crossover approach:
- Buy when fast SMA crosses above slow SMA
- Sell when fast SMA crosses below slow SMA

Available in context:
- context.params: User-configured parameters
- context.indicators: Indicator library (SMA, EMA, RSI, MACD, etc.)

Available in on_bar:
- bar: object with open, high, low, close, volume, timestamp
- position: { side, quantity, avg_price, unrealized_pnl } or None
- orders: List of open orders
"""

import numpy as np

class Strategy:
    def __init__(self, context):
        """Initialize strategy with indicator parameters."""
        self.context = context
        self.closes = []
        self.fast_period = context.get_param('fast_period', 10)
        self.slow_period = context.get_param('slow_period', 30)
        self.position_size = context.get_param('position_size', 1.0)
        self.prev_fast_sma = None
        self.prev_slow_sma = None

    def on_bar(self, bar, position, orders):
        """
        Called on each new bar.
        Returns list of signals when conditions are met.
        """
        signals = []

        # Collect closing prices
        self.closes.append(bar.close)

        # Need enough data for slow SMA
        if len(self.closes) < self.slow_period:
            return signals

        # Calculate SMAs
        closes_arr = np.array(self.closes)
        fast_sma = np.mean(closes_arr[-self.fast_period:])
        slow_sma = np.mean(closes_arr[-self.slow_period:])

        # Check for crossover signals
        if self.prev_fast_sma is not None and self.prev_slow_sma is not None:
            # Golden cross: fast crosses above slow
            if self.prev_fast_sma <= self.prev_slow_sma and fast_sma > slow_sma:
                if position is None:  # Only buy if not in position
                    signals.append({
                        'type': 'buy',
                        'quantity': self.position_size,
                        'order_type': 'market',
                        'reason': f'Golden cross: SMA{self.fast_period} ({fast_sma:.2f}) > SMA{self.slow_period} ({slow_sma:.2f})'
                    })

            # Death cross: fast crosses below slow
            elif self.prev_fast_sma >= self.prev_slow_sma and fast_sma < slow_sma:
                if position is not None and position.get('side') == 'long':
                    signals.append({
                        'type': 'sell',
                        'quantity': position.get('quantity', self.position_size),
                        'order_type': 'market',
                        'reason': f'Death cross: SMA{self.fast_period} ({fast_sma:.2f}) < SMA{self.slow_period} ({slow_sma:.2f})'
                    })

        # Store for next bar comparison
        self.prev_fast_sma = fast_sma
        self.prev_slow_sma = slow_sma

        return signals
`;
