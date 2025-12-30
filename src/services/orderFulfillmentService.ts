import Decimal from 'decimal.js'
import { StrategyConfig } from '../types/strategy'
import { Order, OrderStatus, OrderSide, OrderType } from '../types/order'
import { Market } from '../types/market'
import { orderService } from './orderService'
import { db } from './dbService'
import { marketService } from './marketService'
import { balanceService } from './balanceService'

interface FillPrice {
  price: string
  quantity: string
  timestamp: number
}

/**
 * Rounds down a quantity to 3 decimal places
 */
function roundDownTo3Decimals(quantity: Decimal): Decimal {
  const multiplier = new Decimal(1000)
  return quantity.mul(multiplier).floor().div(multiplier)
}

/**
 * Scales up a Decimal by a given number of decimals and truncates it
 * according to the maximum precision.
 */
function scaleUpAndTruncateToInt(amount: Decimal, decimals: number, maxPrecision: number): Decimal {
  const priceInt = amount.mul(new Decimal(10).pow(decimals))
  const truncateFactor = new Decimal(10).pow(decimals - maxPrecision)
  return priceInt.div(truncateFactor).floor().mul(truncateFactor)
}

class OrderFulfillmentService {
  // In-memory cache of processed fills (synced with database)
  // Maps order_id -> last processed filled_quantity
  private processedFillsCache: Map<string, string> = new Map()
  // Track which markets have had their fills loaded from database
  private loadedMarkets: Set<string> = new Set()

  /**
   * Load processed fills from database into cache for a specific market
   */
  private async loadProcessedFillsFromDb(marketId: string): Promise<void> {
    // Skip if already loaded for this market
    if (this.loadedMarkets.has(marketId)) {
      return
    }

    try {
      const fills = await db.processedFills.where('marketId').equals(marketId).toArray()
      for (const fill of fills) {
        this.processedFillsCache.set(fill.orderId, fill.filledQuantity)
      }
      this.loadedMarkets.add(marketId)
    } catch (error) {
      console.error('[OrderFulfillmentService] Failed to load processed fills from database:', error)
    }
  }

  /**
   * Get processed fill quantity from cache (with db fallback)
   */
  private async getProcessedFill(orderId: string, marketId: string): Promise<string> {
    // Check cache first
    if (this.processedFillsCache.has(orderId)) {
      return this.processedFillsCache.get(orderId)!
    }

    // If cache miss, try database
    try {
      const fill = await db.processedFills.get(orderId)
      if (fill) {
        this.processedFillsCache.set(orderId, fill.filledQuantity)
        return fill.filledQuantity
      }
    } catch (error) {
      console.error('[OrderFulfillmentService] Failed to get processed fill from database:', error)
    }

    return '0'
  }

  /**
   * Update processed fill in both cache and database
   */
  private async updateProcessedFill(orderId: string, filledQuantity: string, marketId: string): Promise<void> {
    // Update cache
    this.processedFillsCache.set(orderId, filledQuantity)

    // Persist to database
    try {
      await db.processedFills.put({
        orderId,
        filledQuantity,
        marketId,
        updatedAt: Date.now()
      })
    } catch (error) {
      console.error('[OrderFulfillmentService] Failed to persist processed fill to database:', error)
    }
  }

  /**
   * Clear processed fills tracking (call when stopping trading or resetting)
   */
  clearProcessedFills(): void {
    this.processedFillsCache.clear()
    this.loadedMarkets.clear()
  }

  /**
   * Clear old processed fills from database (older than 24 hours)
   */
  async cleanupOldProcessedFills(): Promise<void> {
    try {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000 // 24 hours ago
      await db.processedFills.where('updatedAt').below(cutoff).delete()
      console.log('[OrderFulfillmentService] Cleaned up old processed fills')
    } catch (error) {
      console.error('[OrderFulfillmentService] Failed to cleanup old processed fills:', error)
    }
  }

  /**
   * Update fill prices in strategy config when an order is filled
   */
  async updateFillPrices(
    config: StrategyConfig,
    order: Order,
    market: Market,
    previousFilledQuantity?: string
  ): Promise<StrategyConfig> {
    const updatedConfig = { ...config }
    
    // Initialize fill prices if not exists
    if (!updatedConfig.lastFillPrices) {
      updatedConfig.lastFillPrices = {
        buy: [],
        sell: [],
      }
    }

    // Check if order was filled (partially or fully)
    const currentFilled = new Decimal(order.filled_quantity || '0')
    const previousFilled = previousFilledQuantity ? new Decimal(previousFilledQuantity) : new Decimal(0)
    
    if (currentFilled.gt(previousFilled)) {
      // Order was filled (new fill or partial fill)
      const fillQuantity = currentFilled.minus(previousFilled)
      
      // Only use actual fill price (price_fill) - never fallback to limit price
      // Using limit price for averages would lead to incorrect profit calculations
      if (!order.price_fill || order.price_fill === '0' || order.price_fill === '') {
        console.warn(`[OrderFulfillmentService] Fill price unavailable for order ${order.order_id}, skipping average update`)
        return updatedConfig // Don't update averages with limit price
      }

      const fillPriceScaled = new Decimal(order.price_fill)
      console.log(`[OrderFulfillmentService] Using fill price ${order.price_fill} for order ${order.order_id} (vs limit price ${order.price})`)

      // Convert from scaled format to human-readable format with proper precision
      // Price is in scaled format (e.g., "1000000000" for $1000 with 6 decimals)
      const fillPriceHuman = fillPriceScaled.div(10 ** market.quote.decimals).toFixed(market.quote.decimals).replace(/\.?0+$/, '')

      // Also convert quantity from scaled to human-readable format with proper precision
      const fillQuantityScaled = new Decimal(fillQuantity)
      const fillQuantityHuman = fillQuantityScaled.div(10 ** market.base.decimals).toFixed(market.base.decimals).replace(/\.?0+$/, '')
      
      const fillEntry: FillPrice = {
        price: fillPriceHuman, // Store in human-readable format (actual execution price)
        quantity: fillQuantityHuman, // Store in human-readable format
        timestamp: Date.now(),
      }

      if (order.side === 'Buy') {
        updatedConfig.lastFillPrices.buy.push(fillEntry)
        // Use the LAST buy fill price (not average) for profit protection
        updatedConfig.averageBuyPrice = fillPriceHuman
      } else {
        updatedConfig.lastFillPrices.sell.push(fillEntry)
        updatedConfig.averageSellPrice = fillPriceHuman
      }

      console.log(`[OrderFulfillmentService] Updated last fill price for ${order.side} order ${order.order_id}:`, {
        lastBuyPrice: updatedConfig.averageBuyPrice,
        lastSellPrice: updatedConfig.averageSellPrice,
        fillPrice: fillPriceHuman
      })
    }

    return updatedConfig
  }

  /**
   * Calculate average price from fill prices
   * @param fills Array of fill prices
   * @param method 'weighted' (by quantity) or 'simple' (arithmetic mean)
   */
  calculateAveragePrice(fills: FillPrice[], method: 'weighted' | 'simple'): string {
    if (fills.length === 0) {
      return '0'
    }

    if (method === 'simple') {
      const sum = fills.reduce((acc, fill) => acc.plus(fill.price), new Decimal(0))
      return sum.div(fills.length).toString()
    }

    // Weighted average (by quantity)
    let totalValue = new Decimal(0)
    let totalQuantity = new Decimal(0)

    for (const fill of fills) {
      const price = new Decimal(fill.price)
      const quantity = new Decimal(fill.quantity)
      totalValue = totalValue.plus(price.mul(quantity))
      totalQuantity = totalQuantity.plus(quantity)
    }

    if (totalQuantity.eq(0)) {
      return '0'
    }

    return totalValue.div(totalQuantity).toString()
  }

  /**
   * Check if sell order should be placed based on average buy price and orderbook
   * @param config Strategy configuration
   * @param sellPrice Sell price in human-readable format
   * @param bestBidPrice Current best bid price from orderbook (optional, in human-readable format)
   * @returns true if sell order should be placed, false otherwise
   */
  shouldPlaceSellOrder(config: StrategyConfig, sellPrice: string, bestBidPrice?: Decimal | null): boolean {
    if (!config.orderManagement.onlySellAboveBuyPrice) {
      return true // No restriction
    }

    const sellPriceDecimal = new Decimal(sellPrice)

    // Use takeProfitPercent from config, default to 0.02% (round-trip fees: 0.01% buy + 0.01% sell)
    const takeProfitRate = (config.riskManagement?.takeProfitPercent ?? 0.02) / 100

    // Check against average buy fill price (with take profit buffer)
    let avgBuyPriceDecimal: Decimal | null = null
    let minProfitablePriceFromBuy: Decimal | null = null
    if (config.averageBuyPrice && config.averageBuyPrice !== '0') {
      avgBuyPriceDecimal = new Decimal(config.averageBuyPrice)
      // Minimum profitable sell price = buy price * (1 + take profit rate)
      minProfitablePriceFromBuy = avgBuyPriceDecimal.mul(1 + takeProfitRate)
    }

    // Check against orderbook best bid price
    let bestBidDecimal: Decimal | null = null
    if (bestBidPrice) {
      bestBidDecimal = bestBidPrice
    }

    // Determine the minimum price we need to exceed
    // Priority: minProfitablePriceFromBuy (if exists) > bestBidPrice
    // If we have a minimum profitable price, we should use that regardless of best bid
    let minRequiredPrice: Decimal | null = null
    if (minProfitablePriceFromBuy) {
      // Always prioritize minimum profitable price when available
      // Only consider best bid if it's higher than minimum profitable price
      if (bestBidDecimal && bestBidDecimal.gt(minProfitablePriceFromBuy)) {
        minRequiredPrice = bestBidDecimal
      } else {
        minRequiredPrice = minProfitablePriceFromBuy
      }
    } else if (bestBidDecimal) {
      minRequiredPrice = bestBidDecimal
    }

    // If no price reference available, allow sell (no buy tracked yet)
    if (!minRequiredPrice) {
      console.log('[OrderFulfillmentService] No average buy price or best bid tracked yet, allowing sell order')
      return true
    }

    // Only sell if sell price >= minimum required price (accounting for fees)
    // Use gte to allow prices equal to minimum (which are already adjusted to be profitable)
    const shouldPlace = sellPriceDecimal.gte(minRequiredPrice)
    
    const reason = shouldPlace 
      ? `sell price ${sellPrice} >= min required ${minRequiredPrice.toString()}`
      : `sell price ${sellPrice} < min required ${minRequiredPrice.toString()}`
    
    console.log('[OrderFulfillmentService] Profit protection check:', {
      lastBuyPrice: config.averageBuyPrice || 'not set',
      minProfitablePriceFromBuy: minProfitablePriceFromBuy?.toString() || 'not calculated',
      bestBidPrice: bestBidDecimal?.toString() || 'not available',
      minRequiredPrice: minRequiredPrice.toString(),
      sellPrice: sellPrice,
      shouldPlace,
      onlySellAboveBuyPrice: config.orderManagement.onlySellAboveBuyPrice,
      takeProfitRate: `${(takeProfitRate * 100).toFixed(4)}%`,
      reason
    })
    
    if (!shouldPlace) {
      console.log(`[OrderFulfillmentService] BLOCKING sell order: ${reason}`)
    }

    return shouldPlace
  }

  /**
   * Place a sell order immediately after a buy order fills
   * Uses best bid price from orderbook if profitable, otherwise uses minimum profitable price
   */
  async placeSellOrderAfterBuyFill(
    filledBuyOrder: Order,
    market: Market,
    config: StrategyConfig,
    ownerAddress: string,
    tradingAccountId: string
  ): Promise<{ order: Order; quantityHuman: string; priceHuman: string } | null> {
    try {
      // Get fresh config from database to ensure latest averageBuyPrice
      const storedConfig = await db.strategyConfigs.get(market.market_id)
      const configToUse = storedConfig?.config || config

      // Check if sell orders are allowed
      if (configToUse.orderConfig.side !== 'Sell' && configToUse.orderConfig.side !== 'Both') {
        console.log('[OrderFulfillmentService] Sell orders not allowed in config, skipping immediate sell placement')
        return null
      }

      // Check if profit protection is enabled and we have an average buy price
      if (configToUse.orderManagement.onlySellAboveBuyPrice) {
        if (!configToUse.averageBuyPrice || configToUse.averageBuyPrice === '0') {
          console.log('[OrderFulfillmentService] Average buy price not yet tracked, skipping immediate sell placement')
          return null
        }
      }

      // Check max open orders limit for sell orders
      if (configToUse.orderManagement.maxOpenOrders > 0) {
        const openOrders = await orderService.getOpenOrders(market.market_id, ownerAddress)
        const sellOrders = openOrders.filter(o => o.side === OrderSide.Sell)
        if (sellOrders.length >= configToUse.orderManagement.maxOpenOrders) {
          console.log('[OrderFulfillmentService] Max sell orders reached, skipping auto-sell')
          return null
        }
      }

      // Get current orderbook
      const orderBook = await marketService.getOrderBook(market.market_id)
      if (!orderBook) {
        console.log('[OrderFulfillmentService] Orderbook not available, skipping immediate sell placement')
        return null
      }

      // Get best bid from orderbook
      let bestBidPrice: Decimal | null = null
      if (orderBook.bids && orderBook.bids.length > 0 && orderBook.bids[0] && orderBook.bids[0][0]) {
        bestBidPrice = new Decimal(orderBook.bids[0][0]).div(10 ** market.quote.decimals)
      }

      // Determine sell price based on whether profit protection is enabled
      let sellPrice: Decimal

      if (configToUse.orderManagement.onlySellAboveBuyPrice) {
        // Profit protection is enabled - use minimum profitable price logic
        const takeProfitRate = (configToUse.riskManagement?.takeProfitPercent ?? 0.02) / 100

        // Calculate minimum profitable sell price: lastBuyPrice * (1 + take profit rate)
        let minProfitablePrice: Decimal | null = null
        if (configToUse.averageBuyPrice && configToUse.averageBuyPrice !== '0') {
          const lastBuyPriceDecimal = new Decimal(configToUse.averageBuyPrice)
          minProfitablePrice = lastBuyPriceDecimal.mul(1 + takeProfitRate)
        }

        if (minProfitablePrice) {
          if (bestBidPrice && bestBidPrice.gte(minProfitablePrice)) {
            // Use best bid price if it's profitable (or equal to minimum)
            sellPrice = bestBidPrice
            console.log('[OrderFulfillmentService] Using best bid price for immediate sell order (profit protection enabled):', {
              bestBidPrice: bestBidPrice.toString(),
              minProfitablePrice: minProfitablePrice.toString(),
              lastBuyPrice: configToUse.averageBuyPrice
            })
          } else {
            // Use minimum profitable price (either no best bid or best bid is below minimum)
            sellPrice = minProfitablePrice
            console.log('[OrderFulfillmentService] Using minimum profitable price for immediate sell order:', {
              minProfitablePrice: minProfitablePrice.toString(),
              bestBidPrice: bestBidPrice?.toString() || 'not available',
              lastBuyPrice: configToUse.averageBuyPrice
            })
          }
        } else {
          // No average buy price tracked yet, use best bid if available, otherwise skip
          if (bestBidPrice) {
            sellPrice = bestBidPrice
          } else {
            console.log('[OrderFulfillmentService] No average buy price or best bid available, skipping immediate sell placement')
            return null
          }
        }
      } else {
        // Profit protection is disabled - just use best bid (market price)
        if (bestBidPrice) {
          sellPrice = bestBidPrice
          console.log('[OrderFulfillmentService] Using best bid price for immediate sell order (profit protection disabled):', {
            bestBidPrice: bestBidPrice.toString(),
            onlySellAboveBuyPrice: false
          })
        } else {
          console.log('[OrderFulfillmentService] No best bid available, skipping immediate sell placement')
          return null
        }
      }

      // Calculate order size - use the filled quantity from the buy order
      const filledQuantityScaled = new Decimal(filledBuyOrder.filled_quantity || '0')
      const filledQuantityHuman = filledQuantityScaled.div(10 ** market.base.decimals)

      // Wait for balance to reflect the fill (with 1.5s timeout)
      // This handles the race condition where balance API hasn't updated yet after buy fill
      const expectedMinBalance = filledQuantityHuman
      const maxWaitMs = 1500 // 1.5 seconds max
      const pollIntervalMs = 250

      let balances: { base: { unlocked: string }; quote: { unlocked: string } } | null = null
      let baseBalanceHuman = new Decimal(0)
      const startTime = Date.now()

      while (Date.now() - startTime < maxWaitMs) {
        balanceService.clearCache()
        balances = await balanceService.getMarketBalances(market, tradingAccountId, ownerAddress)
        baseBalanceHuman = new Decimal(balances.base.unlocked).div(10 ** market.base.decimals)

        if (baseBalanceHuman.gte(expectedMinBalance)) {
          console.log(`[OrderFulfillmentService] Balance settled: ${baseBalanceHuman}`)
          break
        }

        console.log(`[OrderFulfillmentService] Waiting for balance settlement... current: ${baseBalanceHuman}, expected: ${expectedMinBalance}`)
        await new Promise(r => setTimeout(r, pollIntervalMs))
      }

      if (!balances || baseBalanceHuman.lt(expectedMinBalance)) {
        console.log(`[OrderFulfillmentService] Balance not settled after ${maxWaitMs}ms, skipping immediate sell`)
        return null
      }

      const quantityToSell = Decimal.min(filledQuantityHuman, baseBalanceHuman)

      if (quantityToSell.lte(0)) {
        console.log('[OrderFulfillmentService] Insufficient base balance for immediate sell order')
        return null
      }

      // Check minimum order size
      const orderValueUsd = quantityToSell.mul(sellPrice).toNumber()
      if (orderValueUsd < configToUse.positionSizing.minOrderSizeUsd) {
        console.log(`[OrderFulfillmentService] Order value $${orderValueUsd.toFixed(2)} below minimum $${configToUse.positionSizing.minOrderSizeUsd}, skipping immediate sell placement`)
        return null
      }

      // Round quantity to 3 decimal places
      const quantityRounded = roundDownTo3Decimals(quantityToSell)
      const quantityScaled = quantityRounded.mul(10 ** market.base.decimals).toFixed(0)

      // Truncate price according to max_precision
      const sellPriceTruncated = scaleUpAndTruncateToInt(
        sellPrice,
        market.quote.decimals,
        market.quote.max_precision
      )
      const sellPriceScaled = sellPriceTruncated.toFixed(0)

      // Place limit sell order (always use Spot/Limit for immediate orders on the book)
      // Refresh the trade account manager to ensure we have the latest nonce after the buy order
      // This ensures the immediate sell order uses the correct nonce
      const { sessionManagerService } = await import('./sessionManagerService')
      await sessionManagerService.getTradeAccountManager(ownerAddress, true) // refreshNonce = true

      // Place order with retry on NotEnoughBalance (handles edge cases where balance still hasn't settled)
      const placeWithRetry = async (retries = 2, delayMs = 400): Promise<Order> => {
        for (let i = 0; i <= retries; i++) {
          try {
            return await orderService.placeOrder(
              market,
              OrderSide.Sell,
              OrderType.Spot, // Always use Spot/Limit for orders that sit on the book
              sellPriceScaled,
              quantityScaled,
              ownerAddress
            )
          } catch (error: any) {
            const errorMsg = error?.response?.data?.reason || error?.message || ''
            if (errorMsg.includes('NotEnoughBalance') && i < retries) {
              console.log(`[OrderFulfillmentService] NotEnoughBalance, retry ${i + 1}/${retries} in ${delayMs}ms...`)
              await new Promise(r => setTimeout(r, delayMs))
              delayMs *= 2 // exponential backoff
              balanceService.clearCache()
              // Refresh nonce before retry
              await sessionManagerService.getTradeAccountManager(ownerAddress, true)
              continue
            }
            throw error
          }
        }
        throw new Error('Failed to place order after retries')
      }

      const order = await placeWithRetry()

      console.log('[OrderFulfillmentService] Placed immediate sell order after buy fill:', {
        orderId: order.order_id,
        sellPrice: sellPrice.toString(),
        quantity: quantityRounded.toString(),
        lastBuyPrice: configToUse.averageBuyPrice,
        onlySellAboveBuyPrice: configToUse.orderManagement.onlySellAboveBuyPrice,
        bestBidPrice: bestBidPrice?.toString()
      })

      // Return order with additional metadata for display
      return {
        order,
        quantityHuman: quantityRounded.toString(),
        priceHuman: sellPrice.toString()
      }
    } catch (error: any) {
      console.error('[OrderFulfillmentService] Error placing immediate sell order after buy fill:', error)
      return null
    }
  }

  /**
   * Track order fills by comparing current order state with previous state
   * Uses database-persisted fill tracking to survive restarts
   */
  async trackOrderFills(
    marketId: string,
    ownerAddress: string
  ): Promise<Map<string, { order: Order; previousFilledQuantity: string }>> {
    const normalizedAddress = ownerAddress.toLowerCase()

    // Load processed fills from database into cache for this market if not already loaded
    await this.loadProcessedFillsFromDb(marketId)

    // Get current open orders
    const currentOrders = await orderService.getOpenOrders(marketId, normalizedAddress)

    // Get previous order states from database
    // Query ALL orders created within the last 30 seconds (using created_at) to catch immediately filled orders
    // Also include orders that are Open or PartiallyFilled (regardless of when created)
    const recentTimeThreshold = Date.now() - 30000 // 30 seconds ago
    const allRecentOrders = await db.orders
      .where('market_id')
      .equals(marketId)
      .filter((order) => {
        const isOpenOrPartiallyFilled = order.status === OrderStatus.Open || order.status === OrderStatus.PartiallyFilled
        const isRecentlyCreated = order.created_at ? order.created_at >= recentTimeThreshold : false
        return isOpenOrPartiallyFilled || isRecentlyCreated
      })
      .toArray()

    const previousOrders = allRecentOrders.filter(o =>
      o.status === OrderStatus.Open || o.status === OrderStatus.PartiallyFilled
    )

    const fillsDetected = new Map<string, { order: Order; previousFilledQuantity: string }>()

    // Compare current orders with previous orders to detect fills
    for (const currentOrder of currentOrders) {
      const previousOrder = previousOrders.find((o) => o.order_id === currentOrder.order_id)

      if (previousOrder) {
        const currentFilled = new Decimal(currentOrder.filled_quantity || '0')
        const previousFilled = new Decimal(previousOrder.filled_quantity || '0')

        if (currentFilled.gt(previousFilled)) {
          // Order was filled
          fillsDetected.set(currentOrder.order_id, {
            order: currentOrder,
            previousFilledQuantity: previousOrder.filled_quantity || '0',
          })
          // Update tracking (persists to database)
          await this.updateProcessedFill(currentOrder.order_id, currentOrder.filled_quantity || '0', marketId)
        }
      } else {
        // New order, check if it has any fills (also check our tracking to avoid duplicates)
        const currentFilled = new Decimal(currentOrder.filled_quantity || '0')
        const lastProcessedFill = await this.getProcessedFill(currentOrder.order_id, marketId)
        const previousFilled = new Decimal(lastProcessedFill)

        if (currentFilled.gt(previousFilled)) {
          fillsDetected.set(currentOrder.order_id, {
            order: currentOrder,
            previousFilledQuantity: lastProcessedFill,
          })
          // Update tracking (persists to database)
          await this.updateProcessedFill(currentOrder.order_id, currentOrder.filled_quantity || '0', marketId)
        }
      }
    }

    // Also check for orders that moved from open to filled/cancelled, or recently updated orders
    for (const previousOrder of previousOrders) {
      const currentOrder = currentOrders.find((o) => o.order_id === previousOrder.order_id)

      if (!currentOrder) {
        // Order is no longer open - check if it was filled
        const updatedOrder = await orderService.getOrder(previousOrder.order_id, marketId, normalizedAddress)
        if (updatedOrder && updatedOrder.status === OrderStatus.Filled) {
          const currentFilled = new Decimal(updatedOrder.filled_quantity || '0')
          const previousFilled = new Decimal(previousOrder.filled_quantity || '0')

          if (currentFilled.gt(previousFilled)) {
            fillsDetected.set(updatedOrder.order_id, {
              order: updatedOrder,
              previousFilledQuantity: previousOrder.filled_quantity || '0',
            })
            // Update tracking (persists to database)
            await this.updateProcessedFill(updatedOrder.order_id, updatedOrder.filled_quantity || '0', marketId)
          }
        }
      }
    }

    // Also check recently created orders that might have filled immediately
    // These are orders that were created in the last 30 seconds but aren't in previousOrders
    // This handles the case where an order is placed and immediately fills, so it never appears
    // as Open in the database
    const recentlyCreatedOrders = allRecentOrders.filter(o =>
      o.created_at && o.created_at >= recentTimeThreshold &&
      !previousOrders.find(p => p.order_id === o.order_id) &&
      !fillsDetected.has(o.order_id)
    )

    for (const recentOrder of recentlyCreatedOrders) {
      // Check if this order has fills - if it was created recently and has fills, track it
      const currentFilled = new Decimal(recentOrder.filled_quantity || '0')

      // Use tracked fill amount if we've already processed this order, otherwise '0'
      const lastProcessedFill = await this.getProcessedFill(recentOrder.order_id, marketId)
      const previousFilled = new Decimal(lastProcessedFill)

      if (currentFilled.gt(previousFilled)) {
        // Order has new fills since we last processed it
        fillsDetected.set(recentOrder.order_id, {
          order: recentOrder,
          previousFilledQuantity: lastProcessedFill,
        })
        // Update our tracking to prevent re-processing this fill (persists to database)
        await this.updateProcessedFill(recentOrder.order_id, recentOrder.filled_quantity || '0', marketId)
        console.log(`[OrderFulfillmentService] Detected immediately filled order ${recentOrder.order_id} with ${recentOrder.filled_quantity} filled (previously processed: ${lastProcessedFill})`)
      }
    }

    return fillsDetected
  }

  /**
   * Get fill price from order
   * Uses price_fill (actual execution price) if available, otherwise falls back to order price
   */
  getFillPrice(order: Order, market: Market): string {
    // Use price_fill (actual execution price) if available
    if (order.price_fill && order.price_fill !== '0' && order.price_fill !== '') {
      const fillPriceScaled = new Decimal(order.price_fill)
      return fillPriceScaled.div(10 ** market.quote.decimals).toString()
    }
    // Fallback to order price (limit price) if price_fill not available
    const priceScaled = new Decimal(order.price)
    return priceScaled.div(10 ** market.quote.decimals).toString()
  }
}

export const orderFulfillmentService = new OrderFulfillmentService()

