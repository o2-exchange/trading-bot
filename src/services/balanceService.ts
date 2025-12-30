import { o2ApiService } from './o2ApiService'
import { sessionService } from './sessionService'
import { marketService } from './marketService'
import { Balance, BalanceApiResponse, TradingAccountBalances } from '../types/tradingAccount'
import { Market } from '../types/market'
import Decimal from 'decimal.js'

class BalanceService {
  private balanceCache: Map<string, BalanceApiResponse> = new Map()
  private cacheTimestamp: Map<string, number> = new Map()
  // Reduced from 5s to 2s to avoid stale data during rapid order cycles
  // Cycle intervals can be 3-5s, so 2s TTL ensures fresh data most of the time
  private readonly CACHE_TTL = 2000 // 2 seconds

  async getBalance(
    assetId: string,
    tradingAccountId: string,
    ownerAddress: string
  ): Promise<BalanceApiResponse> {
    // Normalize address
    const normalizedAddress = ownerAddress.toLowerCase()
    const cacheKey = `${tradingAccountId}-${assetId}`
    const cached = this.balanceCache.get(cacheKey)
    const cachedTime = this.cacheTimestamp.get(cacheKey) || 0

    if (cached && Date.now() - cachedTime < this.CACHE_TTL) {
      return cached
    }

    try {
      const balance = await o2ApiService.getBalance(assetId, tradingAccountId, normalizedAddress)
      this.balanceCache.set(cacheKey, balance)
      this.cacheTimestamp.set(cacheKey, Date.now())
      return balance
    } catch (error) {
      console.error('Failed to fetch balance', error)
      // Return cached balance if available, even if stale
      if (cached) {
        return cached
      }
      throw error
    }
  }

  async getMarketBalances(
    market: Market,
    tradingAccountId: string,
    ownerAddress: string
  ): Promise<{ base: Balance; quote: Balance }> {
    const normalizedAddress = ownerAddress.toLowerCase()
    const [baseApiResponse, quoteApiResponse] = await Promise.all([
      this.getBalance(market.base.asset, tradingAccountId, normalizedAddress),
      this.getBalance(market.quote.asset, tradingAccountId, normalizedAddress),
    ])

    // Map API responses to Balance format
    const baseTotalUnlocked = BigInt(baseApiResponse.total_unlocked || '0')
    const baseTotalLocked = BigInt(baseApiResponse.total_locked || '0')
    const baseTradingAccountBalance = BigInt(baseApiResponse.trading_account_balance || '0')
    
    // Get unlocked balance for THIS market's orderbook (if available)
    // This is the balance that settle_balance will move to trading_account
    const baseCurrentOrderbookUnlocked = baseApiResponse.order_books?.[market.contract_id]?.unlocked || '0'
    const baseCurrentOrderbookUnlockedBig = BigInt(baseCurrentOrderbookUnlocked)
    
    // Available balance = trading_account_balance + current_orderbook_unlocked
    // This is what will be available after settle_balance runs in the same transaction
    const baseAvailable = (baseTradingAccountBalance + baseCurrentOrderbookUnlockedBig).toString()
    const baseTotal = (baseTradingAccountBalance + baseTotalUnlocked).toString()

    const quoteTotalUnlocked = BigInt(quoteApiResponse.total_unlocked || '0')
    const quoteTotalLocked = BigInt(quoteApiResponse.total_locked || '0')
    const quoteTradingAccountBalance = BigInt(quoteApiResponse.trading_account_balance || '0')
    
    // Get unlocked balance for THIS market's orderbook (if available)
    const quoteCurrentOrderbookUnlocked = quoteApiResponse.order_books?.[market.contract_id]?.unlocked || '0'
    const quoteCurrentOrderbookUnlockedBig = BigInt(quoteCurrentOrderbookUnlocked)
    
    // Available balance = trading_account_balance + current_orderbook_unlocked
    const quoteAvailable = (quoteTradingAccountBalance + quoteCurrentOrderbookUnlockedBig).toString()
    const quoteTotal = (quoteTradingAccountBalance + quoteTotalUnlocked).toString()

    return {
      base: {
        assetId: market.base.asset,
        assetSymbol: market.base.symbol,
        unlocked: baseAvailable, // Use trading_account + current_orderbook only
        locked: baseApiResponse.total_locked,
        total: baseTotal,
        decimals: market.base.decimals,
      },
      quote: {
        assetId: market.quote.asset,
        assetSymbol: market.quote.symbol,
        unlocked: quoteAvailable, // Use trading_account + current_orderbook only
        locked: quoteApiResponse.total_locked,
        total: quoteTotal,
        decimals: market.quote.decimals,
      },
    }
  }

  async getAllBalances(
    markets: Market[],
    tradingAccountId: string,
    ownerAddress: string
  ): Promise<TradingAccountBalances> {
    const normalizedAddress = ownerAddress.toLowerCase()
    const assetIds = new Set<string>()
    const assetMap = new Map<string, { symbol: string; decimals: number }>()
    
    // Build asset map from markets
    for (const market of markets) {
      assetIds.add(market.base.asset)
      assetMap.set(market.base.asset, {
        symbol: market.base.symbol,
        decimals: market.base.decimals
      })
      assetIds.add(market.quote.asset)
      assetMap.set(market.quote.asset, {
        symbol: market.quote.symbol,
        decimals: market.quote.decimals
      })
    }

    const balances: Balance[] = []
    for (const assetId of assetIds) {
      try {
        const apiResponse = await this.getBalance(assetId, tradingAccountId, normalizedAddress)
        const assetInfo = assetMap.get(assetId)

        if (assetInfo) {
          // Map API response to display format
          const totalUnlocked = BigInt(apiResponse.total_unlocked || '0')
          const totalLocked = BigInt(apiResponse.total_locked || '0')
          const tradingAccountBalance = BigInt(apiResponse.trading_account_balance || '0')

          // Total = trading account balance + unlocked in order books
          const total = (tradingAccountBalance + totalUnlocked).toString()

          balances.push({
            assetId,
            assetSymbol: assetInfo.symbol,
            unlocked: apiResponse.total_unlocked,
            locked: apiResponse.total_locked,
            total,
            decimals: assetInfo.decimals
          })
        }
      } catch (error) {
        console.error(`Failed to fetch balance for asset ${assetId}`, error)
      }
    }

    // Calculate USD values for each balance
    // Use unlocked + locked (what's displayed in the table) to avoid double-counting
    for (const balance of balances) {
      try {
        const unlockedBig = new Decimal(balance.unlocked || '0')
        const lockedBig = new Decimal(balance.locked || '0')
        const displayedTotal = unlockedBig.plus(lockedBig)
        const displayedTotalHuman = displayedTotal.div(new Decimal(10).pow(balance.decimals))

        if (balance.assetSymbol === 'USDC' || balance.assetSymbol === 'USDT') {
          // Stablecoins: 1:1 with USD
          balance.valueUsd = displayedTotalHuman.toFixed(2)
        } else {
          // Find market for this asset paired with USDC (e.g., FUEL/USDC)
          const market = markets.find(
            m => m.base.symbol === balance.assetSymbol && m.quote.symbol === 'USDC'
          )

          if (market) {
            const ticker = await marketService.getTicker(market.market_id)
            if (ticker?.last_price) {
              const priceHuman = new Decimal(ticker.last_price).div(new Decimal(10).pow(market.quote.decimals))
              const valueUsd = displayedTotalHuman.mul(priceHuman)
              balance.valueUsd = valueUsd.toFixed(2)
            }
          }
        }
      } catch (error) {
        console.error(`Failed to calculate USD value for ${balance.assetSymbol}:`, error)
      }
    }

    // Calculate total USD value
    const totalValueUsd = balances.reduce((sum, balance) => {
      return sum + parseFloat(balance.valueUsd || '0')
    }, 0)

    return {
      accountId: tradingAccountId,
      balances,
      totalValueUsd,
      lastUpdated: Date.now(),
    }
  }

  clearCache() {
    this.balanceCache.clear()
    this.cacheTimestamp.clear()
  }
}

export const balanceService = new BalanceService()

