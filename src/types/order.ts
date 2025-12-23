export enum OrderType {
  Spot = 'Spot',
  Market = 'Market',
  Limit = 'Limit',
  FillOrKill = 'FillOrKill',
  PostOnly = 'PostOnly',
}

export enum OrderSide {
  Buy = 'Buy',
  Sell = 'Sell',
}

export enum OrderStatus {
  Pending = 'pending',
  Open = 'open',
  PartiallyFilled = 'partially_filled',
  Filled = 'filled',
  Cancelled = 'cancelled',
  Failed = 'failed',
}

export interface Order {
  order_id: string
  market_id: string
  side: OrderSide
  order_type: OrderType
  price: string
  price_fill?: string // Actual execution price (weighted average of all fills)
  quantity: string
  filled_quantity: string
  remaining_quantity: string
  status: OrderStatus
  created_at: number
  updated_at: number
  tx_id?: string
}

export interface CreateOrderParams {
  market_id: string
  side: OrderSide
  order_type: OrderType
  price: string
  quantity: string
}

export interface CancelOrderParams {
  order_id: string
  market_id: string
}

