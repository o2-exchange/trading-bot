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
  balancePercentage: number // % of available balance to use (0-100) - DEPRECATED, use baseBalancePercentage/quoteBalancePercentage instead
  baseBalancePercentage: number // % of base balance to use for sell orders (0-100)
  quoteBalancePercentage: number // % of quote balance to use for buy orders (0-100)
  balanceType: 'base' | 'quote' | 'both' // DEPRECATED - kept for backward compatibility only
  
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
  
  // Order Replacement
  cancelAndReplace: boolean // Cancel existing orders before placing new ones
}

// ============================================
// RISK MANAGEMENT
// ============================================
// Note: Risk management features are not yet implemented
// This interface is kept for future use but currently empty
export interface RiskManagementConfig {
  // Reserved for future implementation
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
  
  // Metadata
  isActive: boolean
  createdAt: number
  updatedAt: number
  
  // Strategy-specific properties (optional, for backward compatibility)
  // Balance Threshold Strategy
  baseThreshold?: number
  quoteThreshold?: number
  
  // Market Making Strategy
  buyPriceAdjustmentPercent?: number
  sellPriceAdjustmentPercent?: number
  spreadPercent?: number // Deprecated, kept for backward compatibility
  orderSizeUsd?: number // Deprecated, kept for backward compatibility
  rebalanceThreshold?: number // Deprecated, kept for backward compatibility
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
      balancePercentage: 100, // DEPRECATED - kept for backward compatibility
      baseBalancePercentage: 100, // Use 100% of base balance for sell orders
      quoteBalancePercentage: 100, // Use 100% of quote balance for buy orders
      balanceType: 'both', // DEPRECATED - kept for backward compatibility
      minOrderSizeUsd: 5, // Minimum $5 per order
      maxOrderSizeUsd: undefined, // No maximum cap by default
    },
    
    orderManagement: {
      trackFillPrices: true,
      onlySellAboveBuyPrice: true, // Only sell if profitable
      maxOpenOrders: 2, // Max 2 buy + 2 sell orders
      cancelAndReplace: true, // Cancel old orders before placing new ones
    },
    
    riskManagement: {
      // Risk management features not yet implemented
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
  price?: string
  quantity?: string
  filledQuantity?: string
  error?: string
}

export interface StrategyExecutionResult {
  executed: boolean
  orders: OrderExecution[]
  nextRunAt?: number
}
