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
Custom Trading Strategy Template

This template provides the basic structure for a trading strategy.
Implement the on_init and on_bar methods to define your strategy logic.

Available in context:
- context.params: User-configured parameters
- context.indicators: Indicator library (SMA, EMA, RSI, MACD, etc.)
- context.logger: Logging utility

Available in on_bar:
- bar: { open, high, low, close, volume, timestamp }
- position: { side, quantity, avg_price, unrealized_pnl } or None
- orders: List of open orders
"""

class Strategy:
    def __init__(self, context):
        """
        Initialize your strategy here.
        Set up indicators and any state you need.
        """
        self.context = context

        # Example: Initialize moving averages
        # self.sma_fast = context.indicators.SMA(period=10)
        # self.sma_slow = context.indicators.SMA(period=50)

    def on_bar(self, bar, position, orders):
        """
        Called on each new bar (candle).

        Args:
            bar: dict with open, high, low, close, volume, timestamp
            position: Current position or None if flat
            orders: List of open orders

        Returns:
            List of signals: [{ 'type': 'buy'|'sell', 'quantity': float,
                               'order_type': 'market'|'limit', 'price': float (optional) }]
        """
        signals = []

        # Your strategy logic here
        # Example:
        # if some_buy_condition:
        #     signals.append({
        #         'type': 'buy',
        #         'quantity': 1.0,
        #         'order_type': 'market'
        #     })

        return signals
`;
