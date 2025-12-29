export interface Trade {
  id?: number
  timestamp: number
  marketId: string
  orderId: string
  sessionId?: string
  side: 'Buy' | 'Sell'
  price: string // Limit price (for backward compatibility)
  priceFill?: string // Actual execution price (price_fill from order)
  quantity: string
  filledQuantity?: string // Actual filled quantity
  valueUsd?: number
  feeUsd?: number
  baseBalance?: string
  quoteBalance?: string
  success: boolean
  error?: string
}

export interface TradeExecution {
  trade: Trade
  orderId: string
  marketId: string
}

