import { Market } from './market'

// ============================================
// CORE ORDER CONFIGURATION
// ============================================
export interface OrderConfig {
  // Order Type
  orderType: 'Market' | 'Spot'
  
  // Price Configuration
  priceMode: 'offsetFromMid' | 'offsetFromBestBid' | 'offsetFromBestAsk' | 'market'
  priceOffsetPercent: number // % offset from reference price (positive = above, negative = below)
  
  // Spread Management
  maxSpreadPercent: number // Don't trade if spread exceeds this %
  
  // Order Side
  side: 'Buy' | 'Sell' | 'Both' // Both = place buy and sell orders
}

// ============================================
// POSITION SIZING
// ============================================
export interface PositionSizingConfig {
  // Size Mode
  sizeMode: 'percentageOfBalance' | 'fixedUsd'

  // Percentage-based (most common)
  balancePercentage: number // Legacy fallback - use baseBalancePercentage/quoteBalancePercentage instead
  baseBalancePercentage: number // % of base balance to use for sell orders (0-100)
  quoteBalancePercentage: number // % of quote balance to use for buy orders (0-100)

  // Fixed USD (alternative)
  fixedUsdAmount?: number // Fixed USD value per order

  // Constraints
  minOrderSizeUsd: number // Minimum order size (e.g., 5 USD)
  maxOrderSizeUsd?: number // Maximum order size per order (optional cap)
}

// ============================================
// ORDER MANAGEMENT
// ============================================
export interface OrderManagementConfig {
  // Profit Protection
  trackFillPrices: boolean // Remember prices at which orders were filled
  onlySellAboveBuyPrice: boolean // Only place sell orders above average buy price

  // Order Limits
  maxOpenOrders: number // Maximum open orders per side (e.g., 2 = max 2 buy + 2 sell)
}

// ============================================
// RISK MANAGEMENT
// ============================================
export interface RiskManagementConfig {
  // Take Profit - minimum profit margin above fees
  takeProfitPercent: number  // default 0.02 (covers 0.01% buy + 0.01% sell fees)

  // Stop Loss - Price Based
  stopLossEnabled: boolean
  stopLossPercent: number  // e.g., 5 = sell if price drops 5% below avg buy

  // Stop Loss - Time Based (Order Timeout)
  orderTimeoutEnabled: boolean
  orderTimeoutMinutes: number  // e.g., 30 = cancel if not filled in 30 min

  // Max Daily Loss
  maxDailyLossEnabled: boolean
  maxDailyLossUsd: number  // e.g., 100 = pause if lost $100 today
}

// ============================================
// TIMING
// ============================================
export interface TimingConfig {
  // Execution Interval
  cycleIntervalMinMs: number // Minimum time between order cycles (ms)
  cycleIntervalMaxMs: number // Maximum time between order cycles (ms)
}

// ============================================
// MAIN STRATEGY CONFIG
// ============================================
export interface StrategyConfig {
  // Basic Info
  marketId: string
  name?: string
  
  // Core Configurations
  orderConfig: OrderConfig
  positionSizing: PositionSizingConfig
  orderManagement: OrderManagementConfig
  riskManagement: RiskManagementConfig
  timing: TimingConfig
  
  // Internal State (managed by system)
  lastFillPrices?: {
    buy: Array<{ price: string; quantity: string; timestamp: number }>
    sell: Array<{ price: string; quantity: string; timestamp: number }>
  }
  averageBuyPrice?: string
  averageSellPrice?: string

  // Daily P&L Tracking
  dailyPnL?: {
    date: string  // YYYY-MM-DD
    realizedPnL: number  // USD
    pausedUntil?: number  // Timestamp when trading can resume (midnight)
  }
  
  // Metadata
  isActive: boolean
  createdAt: number
  updatedAt: number
}

export interface StrategyConfigStore {
  id: string
  marketId: string
  config: StrategyConfig
  isActive: boolean
  createdAt: number
  updatedAt: number
}

// ============================================
// DEFAULT STRATEGY CONFIGURATION
// ============================================
export function getDefaultStrategyConfig(marketId: string): StrategyConfig {
  return {
    marketId,
    name: 'Default Trading Strategy',
    
    orderConfig: {
      orderType: 'Market',
      priceMode: 'offsetFromMid',
      priceOffsetPercent: 0.1, // 0.1% from mid price
      maxSpreadPercent: 2.0, // Don't trade if spread > 2%
      side: 'Both', // Place both buy and sell orders
    },
    
    positionSizing: {
      sizeMode: 'percentageOfBalance',
      balancePercentage: 100, // Legacy fallback
      baseBalancePercentage: 100, // Use 100% of base balance for sell orders
      quoteBalancePercentage: 100, // Use 100% of quote balance for buy orders
      minOrderSizeUsd: 5, // Minimum $5 per order
      maxOrderSizeUsd: undefined, // No maximum cap by default
    },

    orderManagement: {
      trackFillPrices: true,
      onlySellAboveBuyPrice: true, // Only sell if profitable
      maxOpenOrders: 2, // Max 2 buy + 2 sell orders
    },
    
    riskManagement: {
      takeProfitPercent: 0.02,  // 0.02% covers round-trip fees (0.01% buy + 0.01% sell)
      stopLossEnabled: false,
      stopLossPercent: 5,  // Sell if price drops 5% below avg buy
      orderTimeoutEnabled: false,
      orderTimeoutMinutes: 30,  // Cancel orders not filled in 30 minutes
      maxDailyLossEnabled: false,
      maxDailyLossUsd: 100,  // Pause trading if lost $100 today
    },
    
    timing: {
      cycleIntervalMinMs: 3000, // 3 seconds minimum
      cycleIntervalMaxMs: 5000, // 5 seconds maximum
    },
    
    isActive: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

// ============================================
// ORDER EXECUTION & RESULTS
// ============================================
export interface OrderExecution {
  orderId: string
  side: 'Buy' | 'Sell'
  success: boolean
  price?: string // Scaled price (for API)
  quantity?: string // Scaled quantity (for API)
  filledQuantity?: string
  error?: string
  // Human-readable values for display
  priceHuman?: string // Human-readable price (e.g., "50000.00")
  quantityHuman?: string // Human-readable quantity (e.g., "0.5")
  marketPair?: string // Market pair name (e.g., "BTC/USDC")
}

export interface StrategyExecutionResult {
  executed: boolean
  orders: OrderExecution[]
  nextRunAt?: number
}
