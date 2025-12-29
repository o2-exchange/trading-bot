export interface TradingAccount {
  id: string // Contract ID
  ownerAddress: string
  createdAt: number
  nonce: number
}

// API response type - matches actual API structure
export interface BalanceApiResponse {
  order_books: Record<string, {
    locked: string
    unlocked: string
  }>
  total_unlocked: string
  total_locked: string
  trading_account_balance: string
  block_timestamp?: number
  event_timestamp?: number
}

// Display type - mapped from API response
export interface Balance {
  assetId: string
  assetSymbol: string
  unlocked: string // Available balance (total_unlocked)
  locked: string // Locked in orders (total_locked)
  total: string // trading_account_balance + total_unlocked
  decimals: number
  valueUsd?: string // USD value of total balance
}

export interface TradingAccountBalances {
  accountId: string
  balances: Balance[]
  totalValueUsd?: number
  lastUpdated: number
}

