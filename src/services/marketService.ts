import { o2ApiService } from './o2ApiService'
import { Market, MarketTicker, OrderBookDepth, MarketsResponse } from '../types/market'
import { db } from './dbService'
import { DEFAULT_PRECISION } from '../constants/o2Constants'

class MarketService {
  private marketsCache: Map<string, Market> = new Map()
  private tickerCache: Map<string, MarketTicker> = new Map()
  private orderBookCache: Map<string, OrderBookDepth> = new Map()
  private booksWhitelistId: string | null = null
  private accountsRegistryId: string | null = null

  async fetchMarkets(forceRefresh: boolean = false): Promise<Market[]> {
    // Check cache first - if we have markets cached and not forcing refresh, return them
    if (!forceRefresh && this.marketsCache.size > 0) {
      return Array.from(this.marketsCache.values())
    }

    // Check database if not forcing refresh
    if (!forceRefresh) {
      const storedMarkets = await db.markets.toArray()
      if (storedMarkets.length > 0) {
        // Restore cache from database
        for (const market of storedMarkets) {
          this.marketsCache.set(market.market_id, market)
        }
        // Only fetch from API if we don't have books_whitelist_id or accounts_registry_id yet
        if (!this.booksWhitelistId || !this.accountsRegistryId) {
          const response = await o2ApiService.getMarkets()
          if (response.books_whitelist_id) {
            this.booksWhitelistId = response.books_whitelist_id
          }
          if (response.accounts_registry_id) {
            this.accountsRegistryId = response.accounts_registry_id
          }
        }
        return storedMarkets
      }
    }

    // Fetch from API only if not cached or forcing refresh
    const response = await o2ApiService.getMarkets()
    
    // Store books_whitelist_id and accounts_registry_id
    if (response.books_whitelist_id) {
      this.booksWhitelistId = response.books_whitelist_id
    }
    if (response.accounts_registry_id) {
      this.accountsRegistryId = response.accounts_registry_id
    }
    
    // Cache markets
    for (const market of response.markets) {
      this.marketsCache.set(market.market_id, market)
      await db.markets.put(market)
    }

    return response.markets
  }

  getBooksWhitelistId(): string | null {
    return this.booksWhitelistId
  }

  getAccountsRegistryId(): string | null {
    return this.accountsRegistryId
  }

  async getMarket(marketId: string): Promise<Market | null> {
    // Check cache first
    if (this.marketsCache.has(marketId)) {
      return this.marketsCache.get(marketId) || null
    }

    // Check database
    const stored = await db.markets.get(marketId)
    if (stored) {
      this.marketsCache.set(marketId, stored)
      return stored
    }

    // Fetch from API
    const markets = await this.fetchMarkets()
    return markets.find((m) => m.market_id === marketId) || null
  }

  async getTicker(marketId: string): Promise<MarketTicker | null> {
    try {
      const ticker = await o2ApiService.getTicker(marketId)
      this.tickerCache.set(marketId, ticker)
      return ticker
    } catch (error) {
      console.error('Failed to fetch ticker', error)
      return this.tickerCache.get(marketId) || null
    }
  }

  async getOrderBook(marketId: string, precision: number = DEFAULT_PRECISION): Promise<OrderBookDepth | null> {
    try {
      const depth = await o2ApiService.getDepth(marketId, precision)
      depth.timestamp = Date.now()
      this.orderBookCache.set(marketId, depth)
      return depth
    } catch (error) {
      console.error('Failed to fetch order book', error)
      return this.orderBookCache.get(marketId) || null
    }
  }

  getCachedMarket(marketId: string): Market | null {
    return this.marketsCache.get(marketId) || null
  }

  getCachedTicker(marketId: string): MarketTicker | null {
    return this.tickerCache.get(marketId) || null
  }

  getCachedOrderBook(marketId: string): OrderBookDepth | null {
    return this.orderBookCache.get(marketId) || null
  }
}

export const marketService = new MarketService()

