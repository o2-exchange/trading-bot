import Decimal from 'decimal.js'
import { Market } from '../types/market'
import { StrategyConfig, StrategyExecutionResult, OrderExecution } from '../types/strategy'
import { OrderSide, OrderType } from '../types/order'
import { marketService } from './marketService'
import { orderService } from './orderService'
import { balanceService } from './balanceService'
import { orderFulfillmentService } from './orderFulfillmentService'
import { db } from './dbService'
import { validateOrderParams } from '../utils/orderValidation'

/**
 * Rounds down a quantity to market's allowed precision.
 * Uses market's step_size if available, otherwise uses base.max_precision.
 */
function roundDownToMarketPrecision(quantity: Decimal, market: Market): Decimal {
  // Use step_size if available (most precise method)
  if (market.step_size) {
    const stepSize = new Decimal(market.step_size)
    if (!stepSize.isZero()) {
      const result = quantity.div(stepSize).floor().mul(stepSize)
      console.log(`[roundDownToMarketPrecision] ${market.base.symbol}: using step_size=${market.step_size}, ${quantity.toString()} -> ${result.toString()}`)
      return result
    }
  }

  // Fallback to base.max_precision (the exchange's allowed precision for order quantities)
  // This is different from base.decimals which is the token's full precision
  const maxPrecision = market.base.max_precision ?? Math.min(market.base.decimals, 6)
  const multiplier = new Decimal(10).pow(maxPrecision)
  const result = quantity.mul(multiplier).floor().div(multiplier)
  console.log(`[roundDownToMarketPrecision] ${market.base.symbol}: using max_precision=${maxPrecision} (base.max_precision=${market.base.max_precision}, base.decimals=${market.base.decimals}), ${quantity.toString()} -> ${result.toString()}`)
  return result
}

/**
 * Legacy function for backward compatibility - rounds to 3 decimals
 * @deprecated Use roundDownToMarketPrecision instead
 */
function roundDownTo3Decimals(quantity: Decimal): Decimal {
  const multiplier = new Decimal(1000)
  return quantity.mul(multiplier).floor().div(multiplier)
}

/**
 * Scales up a Decimal by a given number of decimals and truncates it
 * according to the maximum precision or tick size.
 *
 * If tickSize is provided, the price will be aligned to the tick size.
 * Otherwise, truncation is based on max_precision.
 *
 * @param amount - Price in human-readable format
 * @param decimals - Number of decimals for the quote asset
 * @param maxPrecision - Maximum precision allowed (usually less than decimals)
 * @param tickSize - Optional tick size string from market config (in human-readable format)
 * @returns Scaled and truncated price as integer
 */
function scaleUpAndTruncateToInt(
  amount: Decimal,
  decimals: number,
  maxPrecision: number,
  tickSize?: string
): Decimal {
  // If tick_size is available, use it for alignment (more precise than max_precision)
  if (tickSize) {
    const tickSizeDecimal = new Decimal(tickSize)
    if (!tickSizeDecimal.isZero()) {
      // Align price to tick size first (in human format)
      const tickAlignedPrice = amount.div(tickSizeDecimal).floor().mul(tickSizeDecimal)
      // Then scale to raw integer
      return tickAlignedPrice.mul(new Decimal(10).pow(decimals)).floor()
    }
  }

  // Fallback to max_precision-based truncation
  // Ensure maxPrecision has a valid value (default to decimals if undefined)
  const effectivePrecision = maxPrecision !== undefined && maxPrecision >= 0 ? maxPrecision : decimals
  const priceInt = amount.mul(new Decimal(10).pow(decimals))
  const truncateFactor = new Decimal(10).pow(decimals - effectivePrecision)

  // If truncateFactor is less than or equal to 1, no truncation needed
  if (truncateFactor.lte(1)) {
    return priceInt.floor()
  }

  return priceInt.div(truncateFactor).floor().mul(truncateFactor)
}

/**
 * Format price with appropriate decimal places based on value, removing trailing zeros.
 * Uses Decimal comparisons to avoid precision loss from .toNumber() conversion.
 */
function formatPrice(price: Decimal): string {
  if (price.isZero() || price.isNaN() || !price.isFinite()) {
    return '0'
  }

  const absPrice = price.abs()
  let decimals: number

  // Use Decimal comparisons to determine precision needed
  if (absPrice.gte(10000)) {
    decimals = 0
  } else if (absPrice.gte(1000)) {
    decimals = 1
  } else if (absPrice.gte(1)) {
    decimals = 2
  } else if (absPrice.gte(0.01)) {
    decimals = 4
  } else if (absPrice.gte(0.0001)) {
    decimals = 6
  } else {
    decimals = 8
  }

  // For very small prices, ensure we have enough decimals to show significant figures
  if (absPrice.lt(1) && absPrice.gt(0)) {
    // Calculate how many decimals we need for 2 significant figures
    const magnitude = Math.floor(Math.log10(absPrice.toNumber()))
    const neededDecimals = -magnitude + 1 // +1 for 2 sig figs
    decimals = Math.max(decimals, Math.min(neededDecimals, 8))
  }

  const formatted = price.toFixed(decimals)

  // Remove trailing zeros
  return formatted.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

/**
 * Validates that a price is valid for order calculations (prevents divide by zero)
 */
function isValidPrice(price: Decimal): boolean {
  return !price.isZero() && !price.isNaN() && price.isFinite() && price.gt(0)
}

class UnifiedStrategyExecutor {
  /**
   * Check if stop loss has been triggered
   * Compares current market price vs averageBuyPrice * (1 - stopLossPercent/100)
   * If triggered, cancels all open orders and places a market sell for entire base balance
   *
   * @returns true if stop loss was triggered (caller should exit), false otherwise
   */
  async checkStopLoss(
    market: Market,
    config: StrategyConfig,
    ownerAddress: string,
    tradingAccountId: string
  ): Promise<{ triggered: boolean; orders: OrderExecution[] }> {
    const orders: OrderExecution[] = []

    // Check if stop loss is enabled
    if (!config.riskManagement?.stopLossEnabled || !config.riskManagement?.stopLossPercent) {
      return { triggered: false, orders }
    }

    // Check if we have an average buy price to compare against
    if (!config.averageBuyPrice || config.averageBuyPrice === '0') {
      return { triggered: false, orders }
    }

    // Get current market price
    const ticker = await marketService.getTicker(market.market_id)
    if (!ticker || !ticker.last_price) {
      console.warn('[UnifiedStrategyExecutor] No ticker data for stop loss check')
      return { triggered: false, orders }
    }

    const currentPrice = new Decimal(ticker.last_price).div(10 ** market.quote.decimals)
    const avgBuyPrice = new Decimal(config.averageBuyPrice)
    const stopLossPercent = config.riskManagement.stopLossPercent

    // Calculate stop loss threshold: avgBuyPrice * (1 - stopLossPercent/100)
    const stopLossThreshold = avgBuyPrice.mul(1 - stopLossPercent / 100)

    console.log('[UnifiedStrategyExecutor] Stop loss check:', {
      currentPrice: currentPrice.toString(),
      avgBuyPrice: avgBuyPrice.toString(),
      stopLossPercent: `${stopLossPercent}%`,
      stopLossThreshold: stopLossThreshold.toString(),
      triggered: currentPrice.lt(stopLossThreshold)
    })

    // Check if current price is below stop loss threshold
    if (currentPrice.gte(stopLossThreshold)) {
      return { triggered: false, orders }
    }

    // STOP LOSS TRIGGERED!
    console.log('[UnifiedStrategyExecutor] ⚠️ STOP LOSS TRIGGERED! Current price:', currentPrice.toString(), 'Threshold:', stopLossThreshold.toString())

    // 1. Cancel all open orders (buy and sell)
    try {
      const openOrders = await orderService.getOpenOrders(market.market_id, ownerAddress)
      for (const order of openOrders) {
        try {
          await orderService.cancelOrder(order.order_id, market.market_id, ownerAddress)
          console.log(`[UnifiedStrategyExecutor] Stop loss: Cancelled order ${order.order_id}`)
        } catch (error) {
          console.error(`[UnifiedStrategyExecutor] Stop loss: Failed to cancel order ${order.order_id}:`, error)
        }
      }
    } catch (error) {
      console.error('[UnifiedStrategyExecutor] Stop loss: Failed to fetch/cancel open orders:', error)
    }

    // 2. Clear balance cache to get fresh data
    balanceService.clearCache()

    // 3. Get current base balance
    const balances = await balanceService.getMarketBalances(
      market,
      tradingAccountId,
      ownerAddress
    )

    const baseBalanceHuman = new Decimal(balances.base.unlocked).div(10 ** market.base.decimals)

    // Check if we have any base to sell
    if (baseBalanceHuman.lte(0)) {
      console.log('[UnifiedStrategyExecutor] Stop loss: No base balance to sell')
      return { triggered: true, orders }
    }

    // Check minimum order size
    const orderValueUsd = baseBalanceHuman.mul(currentPrice).toNumber()
    if (orderValueUsd < config.positionSizing.minOrderSizeUsd) {
      console.log(`[UnifiedStrategyExecutor] Stop loss: Order value $${orderValueUsd.toFixed(2)} below minimum $${config.positionSizing.minOrderSizeUsd}`)
      return { triggered: true, orders }
    }

    // 4. Place market sell order for entire base balance
    try {
      // Round quantity to market precision (uses step_size or base decimals)
      const quantityRounded = roundDownToMarketPrecision(baseBalanceHuman, market)
      const quantityScaled = quantityRounded.mul(10 ** market.base.decimals).toFixed(0)

      // Use current market price (no profit requirement for stop loss)
      const sellPriceTruncated = scaleUpAndTruncateToInt(
        currentPrice,
        market.quote.decimals,
        market.quote.max_precision,
        market.tick_size
      )
      const sellPriceScaled = sellPriceTruncated.toFixed(0)

      // Place MARKET sell order (not limit)
      const order = await orderService.placeOrder(
        market,
        OrderSide.Sell,
        OrderType.Market, // Use market order for immediate execution
        sellPriceScaled,
        quantityScaled,
        ownerAddress
      )

      console.log('[UnifiedStrategyExecutor] Stop loss: Market sell order placed:', order.order_id)

      const marketPair = `${market.base.symbol}/${market.quote.symbol}`
      // Use market precision for quantity display (max 8 decimals)
      const quantityPrecision = Math.min(market.base.decimals, 8)
      orders.push({
        orderId: order.order_id,
        side: 'Sell',
        success: true,
        price: sellPriceScaled,
        quantity: quantityScaled,
        priceHuman: formatPrice(currentPrice),
        quantityHuman: quantityRounded.toFixed(quantityPrecision).replace(/\.?0+$/, ''),
        marketPair,
      })

      // 5. Clear the average buy price since we've exited the position
      // This prevents the stop loss from triggering again on the next cycle
      // NOTE: For market orders, execution is immediate on O2. If there's a partial fill,
      // the next cycle will detect remaining balance and potentially trigger stop loss again,
      // but without averageBuyPrice it won't calculate loss % (which is acceptable for stop loss recovery)
      const updatedConfig = { ...config }
      updatedConfig.averageBuyPrice = '0'
      // Keep lastFillPrices for historical tracking, just clear buy prices for stop loss
      updatedConfig.lastFillPrices = {
        buy: [], // Clear buy history since position is exited
        sell: config.lastFillPrices?.sell || [] // Keep sell history for reference
      }
      // Update with incremented version for change detection
      const storedConfig = await db.strategyConfigs.get(market.market_id)
      await db.strategyConfigs.update(market.market_id, {
        config: updatedConfig,
        version: (storedConfig?.version ?? 0) + 1,
      })
      console.log('[UnifiedStrategyExecutor] Stop loss: Cleared average buy price')

    } catch (error: any) {
      console.error('[UnifiedStrategyExecutor] Stop loss: Failed to place market sell order:', error)
      const marketPair = `${market.base.symbol}/${market.quote.symbol}`
      orders.push({
        orderId: '',
        side: 'Sell',
        success: false,
        error: `Stop loss sell failed: ${error.message}`,
        errorDetails: error,
        marketPair,
      })
    }

    return { triggered: true, orders }
  }

  /**
   * Execute strategy based on configuration
   * @param prefetchedData Optional pre-fetched market data to avoid duplicate API calls
   */
  async execute(
    market: Market,
    config: StrategyConfig,
    ownerAddress: string,
    tradingAccountId: string,
    prefetchedData?: {
      ticker?: any
      orderBook?: any
      balances?: { base: any; quote: any }
      openOrders?: any[] // Prefetched open orders to avoid duplicate API calls
    }
  ): Promise<StrategyExecutionResult> {
    const orders: OrderExecution[] = []
    
    // Calculate next run time at the start
    const minInterval = config.timing.cycleIntervalMinMs
    const maxInterval = config.timing.cycleIntervalMaxMs
    const executionStartTime = Date.now()
    const nextRunAt = executionStartTime + (minInterval + Math.random() * (maxInterval - minInterval))
    
    try {
      console.log('[UnifiedStrategyExecutor] Starting execution for market:', market.market_id)

      // CHECK STOP LOSS FIRST - before any other order placement
      // If stop loss is triggered, we exit immediately
      const stopLossResult = await this.checkStopLoss(market, config, ownerAddress, tradingAccountId)
      if (stopLossResult.triggered) {
        console.log('[UnifiedStrategyExecutor] Stop loss triggered, skipping normal execution')
        return {
          executed: stopLossResult.orders.length > 0,
          orders: stopLossResult.orders,
          nextRunAt,
        }
      }

      // Get current market data (use prefetched data if available)
      const ticker = prefetchedData?.ticker || await marketService.getTicker(market.market_id)
      if (!ticker) {
        console.warn('[UnifiedStrategyExecutor] No ticker data available')
        return {
          executed: false,
          orders: [],
        }
      }

      // Get orderbook for spread calculation (use prefetched data if available)
      const orderBook = prefetchedData?.orderBook || await marketService.getOrderBook(market.market_id)
      
      // Check spread if orderbook is available (depth-aware calculation)
      if (orderBook && config.orderConfig.maxSpreadPercent > 0) {
        // Use minOrderSizeUsd as reference for depth-aware spread calculation
        const referenceOrderSizeUsd = config.positionSizing.minOrderSizeUsd || 10
        const spreadResult = this.calculateEffectiveSpread(orderBook, market, referenceOrderSizeUsd)

        if (spreadResult && spreadResult.spread > config.orderConfig.maxSpreadPercent) {
          const pair = `${market.base.symbol}/${market.quote.symbol}`

          let skipReason: string
          if (spreadResult.insufficientLiquidity) {
            // Not enough liquidity to fill even the minimum order
            skipReason = `${pair}: Insufficient liquidity - cannot fill $${referenceOrderSizeUsd} order, skipping`
          } else {
            const isDepthIssue = spreadResult.spread > spreadResult.topOfBookSpread * 1.1 // 10% higher means depth is the issue
            if (isDepthIssue) {
              skipReason = `${pair}: Effective spread ${spreadResult.spread.toFixed(2)}% for $${referenceOrderSizeUsd} order exceeds max ${config.orderConfig.maxSpreadPercent}% (top-of-book: ${spreadResult.topOfBookSpread.toFixed(2)}%), skipping`
            } else {
              skipReason = `${pair}: Spread ${spreadResult.spread.toFixed(2)}% exceeds max ${config.orderConfig.maxSpreadPercent}%, skipping`
            }
          }

          console.log(`[UnifiedStrategyExecutor] ${skipReason}`)
          return {
            executed: false,
            orders: [],
            nextRunAt,
            skipReason,
          }
        }
      }

      // Get current balances (use prefetched data if available, otherwise fetch fresh)
      let balances: { base: any; quote: any }
      if (prefetchedData?.balances) {
        balances = prefetchedData.balances
      } else {
        // Clear balance cache to ensure fresh data only when not prefetched
        balanceService.clearCache()
        balances = await balanceService.getMarketBalances(
          market,
          tradingAccountId,
          ownerAddress
        )
      }

      // Log available balances for debugging
      const baseBalanceHuman = new Decimal(balances.base.unlocked).div(10 ** market.base.decimals)
      const quoteBalanceHuman = new Decimal(balances.quote.unlocked).div(10 ** market.quote.decimals)
      console.log('[UnifiedStrategyExecutor] Available balances:', {
        base: `${baseBalanceHuman.toFixed(6)} ${market.base.symbol}`,
        quote: `${quoteBalanceHuman.toFixed(2)} ${market.quote.symbol}`,
        orderType: config.orderConfig.orderType
      })

      // Check max open orders if configured (use prefetched data if available)
      let shouldPlaceBuy = true
      let shouldPlaceSell = true

      if (config.orderManagement.maxOpenOrders > 0) {
        const openOrders = prefetchedData?.openOrders || await orderService.getOpenOrders(market.market_id, ownerAddress)
        const buyOrders = openOrders.filter((o: any) => o.side === OrderSide.Buy)
        const sellOrders = openOrders.filter((o: any) => o.side === OrderSide.Sell)
        
        if (config.orderConfig.side === 'Buy' || config.orderConfig.side === 'Both') {
          if (buyOrders.length >= config.orderManagement.maxOpenOrders) {
            console.log(`[UnifiedStrategyExecutor] Max buy orders (${buyOrders.length}) reached, skipping buy`)
            shouldPlaceBuy = false
          }
        }
        
        if (config.orderConfig.side === 'Sell' || config.orderConfig.side === 'Both') {
          if (sellOrders.length >= config.orderManagement.maxOpenOrders) {
            console.log(`[UnifiedStrategyExecutor] Max sell orders (${sellOrders.length}) reached, skipping sell`)
            shouldPlaceSell = false
          }
        }
      }

      // Calculate prices based on price mode
      const prices = this.calculatePrices(market, ticker, orderBook, config.orderConfig)
      
      // Place buy orders if configured and not at max limit
      if (shouldPlaceBuy && (config.orderConfig.side === 'Buy' || config.orderConfig.side === 'Both')) {
        const buyOrder = await this.placeBuyOrder(
          market,
          config,
          prices.buyPrice,
          balances,
          ticker,
          orderBook,
          ownerAddress
        )
        if (buyOrder) {
          orders.push(buyOrder)
        }
      }

      // Place sell orders if configured and not at max limit
      if (shouldPlaceSell && (config.orderConfig.side === 'Sell' || config.orderConfig.side === 'Both')) {
        // Read fresh config from database to ensure we have latest averageBuyPrice
        // This is critical for profit protection logic
        const storedConfig = await db.strategyConfigs.get(market.market_id)
        const configToUse = storedConfig?.config || config
        
        const sellOrder = await this.placeSellOrder(
          market,
          configToUse,
          prices.sellPrice,
          balances,
          ticker,
          orderBook,
          ownerAddress
        )
        if (sellOrder) {
          orders.push(sellOrder)
        }
      }

      console.log('[UnifiedStrategyExecutor] Execution complete:', {
        executed: orders.length > 0,
        ordersCount: orders.length,
        nextRunAt: new Date(nextRunAt).toLocaleTimeString()
      })

      return {
        executed: orders.length > 0,
        orders,
        nextRunAt,
      }
    } catch (error: any) {
      console.error('[UnifiedStrategyExecutor] Error:', error)
      return {
        executed: false,
        orders: [
          {
            orderId: '',
            side: 'Buy',
            success: false,
            error: error.message,
            errorDetails: error,
          },
        ],
      }
    }
  }

  /**
   * Calculate prices based on price mode
   */
  private calculatePrices(
    market: Market,
    ticker: any,
    orderBook: any,
    orderConfig: StrategyConfig['orderConfig']
  ): { buyPrice: Decimal; sellPrice: Decimal } {
    let referencePrice: Decimal

    // Get reference price based on price mode
    switch (orderConfig.priceMode) {
      case 'market':
        // Use market price (for market orders)
        referencePrice = new Decimal(ticker.last_price).div(10 ** market.quote.decimals)
        break
      
      case 'offsetFromBestBid':
        if (orderBook && orderBook.bids && orderBook.bids.length > 0 && orderBook.bids[0] && orderBook.bids[0][0]) {
          referencePrice = new Decimal(orderBook.bids[0][0]).div(10 ** market.quote.decimals)
        } else {
          referencePrice = new Decimal(ticker.last_price).div(10 ** market.quote.decimals)
        }
        break
      
      case 'offsetFromBestAsk':
        if (orderBook && orderBook.asks && orderBook.asks.length > 0 && orderBook.asks[0] && orderBook.asks[0][0]) {
          referencePrice = new Decimal(orderBook.asks[0][0]).div(10 ** market.quote.decimals)
        } else {
          referencePrice = new Decimal(ticker.last_price).div(10 ** market.quote.decimals)
        }
        break
      
      case 'offsetFromMid':
      default:
        // Calculate mid price from orderbook or use ticker
        if (orderBook && orderBook.bids && orderBook.bids.length > 0 && orderBook.asks && orderBook.asks.length > 0 &&
            orderBook.bids[0] && orderBook.bids[0][0] && orderBook.asks[0] && orderBook.asks[0][0]) {
          const bestBid = new Decimal(orderBook.bids[0][0]).div(10 ** market.quote.decimals)
          const bestAsk = new Decimal(orderBook.asks[0][0]).div(10 ** market.quote.decimals)
          referencePrice = bestBid.plus(bestAsk).div(2)
        } else {
          referencePrice = new Decimal(ticker.last_price).div(10 ** market.quote.decimals)
        }
        break
    }

    // Apply offset
    // Buy BELOW reference price (subtract offset) - pay less
    // Sell ABOVE reference price (add offset) - receive more
    const buyPrice = referencePrice.mul(1 - (orderConfig.priceOffsetPercent / 100))
    const sellPrice = referencePrice.mul(1 + (orderConfig.priceOffsetPercent / 100))

    return { buyPrice, sellPrice }
  }

  /**
   * Calculate VWAP (Volume-Weighted Average Price) for a given order size
   * Walks through orderbook levels to find the average price you'd pay/receive
   *
   * @param levels - Orderbook levels (bids or asks) as [price, quantity] tuples or {price, quantity} objects
   * @param orderSizeBase - Order size in base currency (e.g., ETH amount)
   * @param quoteDecimals - Decimals for quote currency (for price conversion)
   * @param baseDecimals - Decimals for base currency (for quantity conversion)
   * @returns VWAP in human-readable format, or null if insufficient liquidity
   */
  private calculateVWAP(
    levels: Array<[string, string]> | Array<{price: string, quantity: string}>,
    orderSizeBase: Decimal,
    quoteDecimals: number,
    baseDecimals: number
  ): Decimal | null {
    if (!levels || levels.length === 0) {
      return null
    }

    let remainingSize = orderSizeBase
    let totalCost = new Decimal(0)
    let totalFilled = new Decimal(0)

    for (const level of levels) {
      if (remainingSize.lte(0)) break

      // Handle both array format [price, quantity] and object format {price, quantity}
      const priceRaw = Array.isArray(level) ? level[0] : (level as {price: string, quantity: string}).price
      const quantityRaw = Array.isArray(level) ? level[1] : (level as {price: string, quantity: string}).quantity

      const price = new Decimal(priceRaw).div(10 ** quoteDecimals)
      const quantity = new Decimal(quantityRaw).div(10 ** baseDecimals)

      if (quantity.lte(0) || price.lte(0)) continue

      const fillSize = Decimal.min(remainingSize, quantity)
      totalCost = totalCost.plus(fillSize.mul(price))
      totalFilled = totalFilled.plus(fillSize)
      remainingSize = remainingSize.minus(fillSize)
    }

    // If we couldn't fill the entire order, return null (insufficient liquidity)
    if (remainingSize.gt(0) || totalFilled.lte(0)) {
      return null
    }

    return totalCost.div(totalFilled)
  }

  /**
   * Calculate effective spread percentage considering orderbook depth
   *
   * This walks through the orderbook to find what price you'd actually pay/receive
   * for a given order size, accounting for thin liquidity at the top of book.
   *
   * @param orderBook - The orderbook with bids and asks
   * @param market - Market info for decimal conversion
   * @param orderSizeUsd - Reference order size in USD to check depth for
   * @returns Object with spread percentage and details, or null if insufficient data
   */
  private calculateEffectiveSpread(
    orderBook: any,
    market: Market,
    orderSizeUsd: number
  ): { spread: number; effectiveBid: Decimal; effectiveAsk: Decimal; midPrice: Decimal; topOfBookSpread: number; insufficientLiquidity?: boolean } | null {
    if (!orderBook.bids || orderBook.bids.length === 0 || !orderBook.asks || orderBook.asks.length === 0) {
      return null
    }

    const bestBidEntry = orderBook.bids[0]
    const bestAskEntry = orderBook.asks[0]

    if (!bestBidEntry || !bestAskEntry) {
      return null
    }

    // Handle both array format [price, quantity] and object format {price, quantity}
    const bestBidPrice = Array.isArray(bestBidEntry) ? bestBidEntry[0] : bestBidEntry.price
    const bestAskPrice = Array.isArray(bestAskEntry) ? bestAskEntry[0] : bestAskEntry.price

    if (bestBidPrice === undefined || bestAskPrice === undefined) {
      return null
    }

    // Calculate top-of-book prices and mid price
    const bestBid = new Decimal(bestBidPrice).div(10 ** market.quote.decimals)
    const bestAsk = new Decimal(bestAskPrice).div(10 ** market.quote.decimals)
    const midPrice = bestBid.plus(bestAsk).div(2)

    // Calculate top-of-book spread for comparison
    const topOfBookSpread = bestAsk.minus(bestBid).div(midPrice).mul(100).toNumber()

    // Convert USD order size to base currency amount using mid price
    const orderSizeBase = new Decimal(orderSizeUsd).div(midPrice)

    // Calculate VWAP for selling (walking through bids - highest to lowest)
    const effectiveBid = this.calculateVWAP(
      orderBook.bids,
      orderSizeBase,
      market.quote.decimals,
      market.base.decimals
    )

    // Calculate VWAP for buying (walking through asks - lowest to highest)
    const effectiveAsk = this.calculateVWAP(
      orderBook.asks,
      orderSizeBase,
      market.quote.decimals,
      market.base.decimals
    )

    // If we couldn't calculate VWAP (insufficient liquidity), return a high spread to trigger skip
    // This is more conservative - if we can't fill even the minimum order, we shouldn't trade
    if (!effectiveBid || !effectiveAsk) {
      return {
        spread: 999, // Very high spread to ensure we skip
        effectiveBid: bestBid,
        effectiveAsk: bestAsk,
        midPrice,
        topOfBookSpread,
        insufficientLiquidity: true
      }
    }

    // Calculate effective spread
    const effectiveSpread = effectiveAsk.minus(effectiveBid).div(midPrice).mul(100)

    return {
      spread: effectiveSpread.toNumber(),
      effectiveBid,
      effectiveAsk,
      midPrice,
      topOfBookSpread
    }
  }

  /**
   * Place buy order
   */
  private async placeBuyOrder(
    market: Market,
    config: StrategyConfig,
    buyPriceHuman: Decimal,
    balances: { base: any; quote: any },
    ticker: any,
    orderBook: any,
    ownerAddress: string
  ): Promise<OrderExecution | null> {
    // Validate and cap against orderbook best ask price for limit orders
    if (orderBook?.asks?.[0]?.[0]) {
      const bestAskPrice = new Decimal(orderBook.asks[0][0]).div(10 ** market.quote.decimals)
      if (buyPriceHuman.gt(bestAskPrice)) {
        if (config.orderConfig.orderType === 'Spot') {
          // For limit orders, cap buy price to best ask to avoid immediate market execution
          console.warn('[UnifiedStrategyExecutor] Capping buy price to best ask for limit order:', {
            originalBuyPrice: buyPriceHuman.toString(),
            bestAskPrice: bestAskPrice.toString()
          })
          buyPriceHuman = bestAskPrice
        } else {
          // For market orders, just log a warning
          console.log('[UnifiedStrategyExecutor] Buy order price above best ask (market order):', {
            buyPrice: buyPriceHuman.toString(),
            bestAskPrice: bestAskPrice.toString()
          })
        }
      }
    }
    
    // Calculate order size (apply slippage buffer for market orders)
    const isMarketOrder = config.orderConfig.orderType !== 'Spot'
    const orderSize = this.calculateOrderSize(market, config.positionSizing, balances, 'buy', buyPriceHuman, ticker, isMarketOrder)
    if (!orderSize || orderSize.quantity.eq(0)) {
      console.log('[UnifiedStrategyExecutor] Buy order skipped: insufficient balance or below minimum')
      return null
    }

    // Truncate price according to tick_size (or max_precision as fallback)
    const buyPriceTruncated = scaleUpAndTruncateToInt(
      buyPriceHuman,
      market.quote.decimals,
      market.quote.max_precision,
      market.tick_size
    )
    const buyPriceScaled = buyPriceTruncated.toFixed(0)

    // Round quantity to market precision (uses step_size or base decimals)
    const quantityRounded = roundDownToMarketPrecision(orderSize.quantity, market)
    const quantityScaled = quantityRounded.mul(10 ** market.base.decimals).toFixed(0)

    // Check minimum order size
    const orderValueUsd = quantityRounded.mul(buyPriceHuman).toNumber()
    if (orderValueUsd < config.positionSizing.minOrderSizeUsd) {
      console.log(`[UnifiedStrategyExecutor] Buy order skipped: value $${orderValueUsd.toFixed(2)} below minimum $${config.positionSizing.minOrderSizeUsd}`)
      return null
    }

    // Additional orderbook validation for buy orders
    if (orderBook && orderBook.asks && orderBook.asks.length > 0 && orderBook.asks[0] && orderBook.asks[0][0]) {
      const bestAskPrice = new Decimal(orderBook.asks[0][0]).div(10 ** market.quote.decimals)
      console.log('[UnifiedStrategyExecutor] Buy order validation:', {
        buyPrice: buyPriceHuman.toString(),
        bestAskPrice: bestAskPrice.toString(),
        orderbookAvailable: true
      })
    }

    // Validate order parameters against market constraints
    const validation = validateOrderParams(buyPriceHuman, quantityRounded, market)
    if (!validation.valid) {
      console.error('[UnifiedStrategyExecutor] Buy order invalid:', validation.errors)
      const marketPair = `${market.base.symbol}/${market.quote.symbol}`
      return {
        orderId: '',
        side: 'Buy',
        success: false,
        error: validation.errors.join('; '),
        marketPair,
      }
    }
    if (validation.warnings.length > 0) {
      console.warn('[UnifiedStrategyExecutor] Buy order warnings:', validation.warnings)
    }

    try {
      // Direct mapping: UI only shows Market and Spot
      const orderType: OrderType = config.orderConfig.orderType === 'Spot' 
        ? OrderType.Spot 
        : OrderType.Market
      const order = await orderService.placeOrder(
        market,
        OrderSide.Buy,
        orderType,
        buyPriceScaled,
        quantityScaled,
        ownerAddress
      )

      console.log('[UnifiedStrategyExecutor] Buy order placed:', order.order_id)
      const marketPair = `${market.base.symbol}/${market.quote.symbol}`
      
      // Use ticker price as fallback if calculated price is 0 or invalid
      let displayPrice = buyPriceHuman
      if (buyPriceHuman.eq(0) || buyPriceHuman.isNaN() || !buyPriceHuman.isFinite()) {
        if (ticker && ticker.last_price) {
          displayPrice = new Decimal(ticker.last_price).div(10 ** market.quote.decimals)
        }
      }
      
      const isLimitOrder = config.orderConfig.orderType === 'Spot'
      // Use market precision for quantity display (max 8 decimals)
      const quantityPrecision = Math.min(market.base.decimals, 8)
      return {
        orderId: order.order_id,
        side: 'Buy',
        success: true,
        price: buyPriceScaled,
        quantity: quantityScaled,
        priceHuman: formatPrice(displayPrice),
        quantityHuman: quantityRounded.toFixed(quantityPrecision).replace(/\.?0+$/, ''),
        marketPair,
        isLimitOrder,
      }
    } catch (error: any) {
      console.error('[UnifiedStrategyExecutor] Buy order failed:', error)
      const marketPair = `${market.base.symbol}/${market.quote.symbol}`
      return {
        orderId: '',
        side: 'Buy',
        success: false,
        error: error.message,
        errorDetails: error,
        marketPair,
      }
    }
  }

  /**
   * Place sell order
   */
  private async placeSellOrder(
    market: Market,
    config: StrategyConfig,
    sellPriceHuman: Decimal,
    balances: { base: any; quote: any },
    ticker: any,
    orderBook: any,
    ownerAddress: string
  ): Promise<OrderExecution | null> {
    // Use takeProfitPercent from config, default to 0.02% (round-trip fees: 0.01% buy + 0.01% sell)
    const takeProfitRate = (config.riskManagement?.takeProfitPercent ?? 0.02) / 100

    // Check if profit protection is enabled and we have an average buy price
    let adjustedSellPrice = sellPriceHuman
    let forceLimitOrder = false // Force limit order when placing at profitable price above market

    if (config.orderManagement.onlySellAboveBuyPrice && config.averageBuyPrice && config.averageBuyPrice !== '0') {
      // Calculate minimum profitable sell price: buy price * (1 + take profit rate)
      const avgBuyPriceDecimal = new Decimal(config.averageBuyPrice)
      const minProfitablePrice = avgBuyPriceDecimal.mul(1 + takeProfitRate)

      // If current market price is below minimum profitable price, place a LIMIT order at the profitable price
      if (sellPriceHuman.lt(minProfitablePrice)) {
        adjustedSellPrice = minProfitablePrice
        forceLimitOrder = true // Must use limit order since we're placing above current market price
        console.log('[UnifiedStrategyExecutor] Adjusted sell price for profitability (placing limit order):', {
          originalSellPrice: sellPriceHuman.toString(),
          adjustedSellPrice: adjustedSellPrice.toString(),
          averageBuyPrice: config.averageBuyPrice,
          minProfitablePrice: minProfitablePrice.toString(),
          takeProfitRate: `${(takeProfitRate * 100).toFixed(4)}%`,
          forceLimitOrder: true
        })
      }
    }

    // Convert sell price to human-readable format for comparison
    const sellPriceString = adjustedSellPrice.toString()

    // Get current best bid price from orderbook for validation
    let bestBidPrice: Decimal | null = null
    if (orderBook && orderBook.bids && orderBook.bids.length > 0 && orderBook.bids[0] && orderBook.bids[0][0]) {
      bestBidPrice = new Decimal(orderBook.bids[0][0]).div(10 ** market.quote.decimals)
    }

    // Skip profit protection check if we're forcing a limit order at the profitable price
    // (because we've already adjusted the price to be profitable)
    if (!forceLimitOrder && !orderFulfillmentService.shouldPlaceSellOrder(config, sellPriceString, bestBidPrice)) {
      const reason = !config.averageBuyPrice || config.averageBuyPrice === '0'
        ? 'no average buy price tracked yet'
        : bestBidPrice && sellPriceHuman.lte(bestBidPrice)
        ? `sell price ${sellPriceString} <= best bid ${bestBidPrice.toString()}`
        : `sell price ${sellPriceString} <= average buy price ${config.averageBuyPrice}`

      console.log('[UnifiedStrategyExecutor] Sell order skipped:', {
        reason,
        sellPrice: sellPriceString,
        averageBuyPrice: config.averageBuyPrice || 'not set',
        bestBidPrice: bestBidPrice?.toString() || 'not available',
        onlySellAboveBuyPrice: config.orderManagement.onlySellAboveBuyPrice
      })
      return null
    }

    // Calculate order size using adjusted sell price
    // Don't apply slippage buffer if we're forcing a limit order
    const isSellMarketOrder = !forceLimitOrder && config.orderConfig.orderType !== 'Spot'
    const orderSize = this.calculateOrderSize(market, config.positionSizing, balances, 'sell', adjustedSellPrice, ticker, isSellMarketOrder)
    if (!orderSize || orderSize.quantity.eq(0)) {
      console.log('[UnifiedStrategyExecutor] Sell order skipped: insufficient balance or below minimum')
      return null
    }

    // Truncate price according to tick_size (or max_precision as fallback)
    const sellPriceTruncated = scaleUpAndTruncateToInt(
      adjustedSellPrice,
      market.quote.decimals,
      market.quote.max_precision,
      market.tick_size
    )
    const sellPriceScaled = sellPriceTruncated.toFixed(0)

    // Round quantity to market precision (uses step_size or base decimals)
    const quantityRounded = roundDownToMarketPrecision(orderSize.quantity, market)
    const quantityScaled = quantityRounded.mul(10 ** market.base.decimals).toFixed(0)

    // Check minimum order size (use adjusted price)
    const orderValueUsd = quantityRounded.mul(adjustedSellPrice).toNumber()
    if (orderValueUsd < config.positionSizing.minOrderSizeUsd) {
      console.log(`[UnifiedStrategyExecutor] Sell order skipped: value $${orderValueUsd.toFixed(2)} below minimum $${config.positionSizing.minOrderSizeUsd}`)
      return null
    }

    // Additional orderbook validation for sell orders
    if (orderBook && orderBook.bids && orderBook.bids.length > 0 && orderBook.bids[0] && orderBook.bids[0][0]) {
      const bestBidPrice = new Decimal(orderBook.bids[0][0]).div(10 ** market.quote.decimals)
      console.log('[UnifiedStrategyExecutor] Sell order validation:', {
        sellPrice: adjustedSellPrice.toString(),
        originalSellPrice: sellPriceHuman.toString(),
        bestBidPrice: bestBidPrice.toString(),
        averageBuyPrice: config.averageBuyPrice || 'not set',
        orderbookAvailable: true,
        forceLimitOrder,
        priceAdjusted: !adjustedSellPrice.eq(sellPriceHuman)
      })
    }

    // Validate order parameters against market constraints
    const validation = validateOrderParams(adjustedSellPrice, quantityRounded, market)
    if (!validation.valid) {
      console.error('[UnifiedStrategyExecutor] Sell order invalid:', validation.errors)
      const marketPair = `${market.base.symbol}/${market.quote.symbol}`
      return {
        orderId: '',
        side: 'Sell',
        success: false,
        error: validation.errors.join('; '),
        marketPair,
      }
    }
    if (validation.warnings.length > 0) {
      console.warn('[UnifiedStrategyExecutor] Sell order warnings:', validation.warnings)
    }

    try {
      // Use Spot (limit) order if forcing limit order for profit protection,
      // otherwise use the configured order type
      const orderType: OrderType = forceLimitOrder
        ? OrderType.Spot
        : (config.orderConfig.orderType === 'Spot' ? OrderType.Spot : OrderType.Market)
      const order = await orderService.placeOrder(
        market,
        OrderSide.Sell,
        orderType,
        sellPriceScaled,
        quantityScaled,
        ownerAddress
      )

      console.log('[UnifiedStrategyExecutor] Sell order placed:', {
        orderId: order.order_id,
        orderType: forceLimitOrder ? 'Limit (profit protection)' : orderType,
        price: adjustedSellPrice.toString(),
        quantity: quantityRounded.toString()
      })
      const marketPair = `${market.base.symbol}/${market.quote.symbol}`

      // Use adjusted price for display (or ticker price as fallback if invalid)
      let displayPrice = adjustedSellPrice
      if (adjustedSellPrice.eq(0) || adjustedSellPrice.isNaN() || !adjustedSellPrice.isFinite()) {
        if (ticker && ticker.last_price) {
          displayPrice = new Decimal(ticker.last_price).div(10 ** market.quote.decimals)
        }
      }
      
      // Limit order if forced (profit protection) or config is Spot
      const isLimitOrder = forceLimitOrder || config.orderConfig.orderType === 'Spot'
      // Use market precision for quantity display (max 8 decimals)
      const quantityPrecision = Math.min(market.base.decimals, 8)
      return {
        orderId: order.order_id,
        side: 'Sell',
        success: true,
        price: sellPriceScaled,
        quantity: quantityScaled,
        priceHuman: formatPrice(displayPrice),
        quantityHuman: quantityRounded.toFixed(quantityPrecision).replace(/\.?0+$/, ''),
        marketPair,
        isLimitOrder,
      }
    } catch (error: any) {
      console.error('[UnifiedStrategyExecutor] Sell order failed:', error)
      const marketPair = `${market.base.symbol}/${market.quote.symbol}`
      return {
        orderId: '',
        side: 'Sell',
        success: false,
        error: error.message,
        errorDetails: error,
        marketPair,
      }
    }
  }

  /**
   * Calculate order size based on position sizing config
   * @param isMarketOrder - If true, applies slippage buffer for market orders
   */
  private calculateOrderSize(
    market: Market,
    positionSizing: StrategyConfig['positionSizing'],
    balances: { base: any; quote: any },
    side: 'buy' | 'sell',
    price: Decimal,
    ticker: any,
    isMarketOrder: boolean = false
  ): { quantity: Decimal; valueUsd: number } | null {
    // Validate price to prevent divide by zero
    if (!isValidPrice(price)) {
      console.warn('[UnifiedStrategyExecutor] Invalid price for order sizing:', { price: price.toString(), side })
      return null
    }

    // For market orders, apply slippage buffer (2%) to account for price movement
    // This reduces the effective balance we use for calculations
    const MARKET_ORDER_SLIPPAGE_BUFFER = isMarketOrder ? 0.98 : 1.0

    if (positionSizing.sizeMode === 'fixedUsd') {
      // Fixed USD amount
      const fixedAmount = positionSizing.fixedUsdAmount || 0
      if (fixedAmount <= 0) {
        return null
      }

      // Apply maxOrderSizeUsd cap if configured
      let orderValue = new Decimal(fixedAmount)
      if (positionSizing.maxOrderSizeUsd && orderValue.gt(positionSizing.maxOrderSizeUsd)) {
        orderValue = new Decimal(positionSizing.maxOrderSizeUsd)
      }

      // Calculate quantity from order value
      // quantity = orderValue / price
      const quantity = orderValue.div(price)

      // Check if we have enough balance (with slippage buffer for market orders)
      if (side === 'buy') {
        const quoteBalanceHuman = new Decimal(balances.quote.unlocked).div(10 ** market.quote.decimals)
        // Apply slippage buffer - use less of available balance for market orders
        const effectiveBalance = quoteBalanceHuman.mul(MARKET_ORDER_SLIPPAGE_BUFFER)
        const requiredQuote = quantity.mul(price)
        if (requiredQuote.gt(effectiveBalance)) {
          // Use available balance instead (with buffer)
          const maxQuantity = effectiveBalance.div(price)
          console.log('[UnifiedStrategyExecutor] Capping buy order to available balance:', {
            requestedValue: orderValue.toString(),
            availableBalance: quoteBalanceHuman.toString(),
            effectiveBalance: effectiveBalance.toString(),
            maxQuantity: maxQuantity.toString(),
            isMarketOrder
          })
          return {
            quantity: maxQuantity,
            valueUsd: maxQuantity.mul(price).toNumber(),
          }
        }
      } else {
        const baseBalanceHuman = new Decimal(balances.base.unlocked).div(10 ** market.base.decimals)
        const effectiveBalance = baseBalanceHuman.mul(MARKET_ORDER_SLIPPAGE_BUFFER)
        if (quantity.gt(effectiveBalance)) {
          // Use available balance instead
          return {
            quantity: effectiveBalance,
            valueUsd: effectiveBalance.mul(price).toNumber(),
          }
        }
      }

      return {
        quantity,
        valueUsd: orderValue.toNumber(),
      }
    }

    // Percentage-based sizing
    // Use separate percentages for base/quote if available, otherwise fallback to balancePercentage
    let balancePercentage: number
    if (side === 'buy') {
      balancePercentage = (positionSizing.quoteBalancePercentage !== undefined)
        ? positionSizing.quoteBalancePercentage / 100
        : positionSizing.balancePercentage / 100
    } else {
      balancePercentage = (positionSizing.baseBalancePercentage !== undefined)
        ? positionSizing.baseBalancePercentage / 100
        : positionSizing.balancePercentage / 100
    }

    if (side === 'buy') {
      // For buy orders, use quote balance
      const quoteBalanceHuman = new Decimal(balances.quote.unlocked).div(10 ** market.quote.decimals)
      // Apply slippage buffer for market orders
      const effectiveBalance = quoteBalanceHuman.mul(MARKET_ORDER_SLIPPAGE_BUFFER)
      let orderValue = effectiveBalance.mul(balancePercentage)

      // Apply maxOrderSizeUsd cap if configured
      if (positionSizing.maxOrderSizeUsd && orderValue.gt(positionSizing.maxOrderSizeUsd)) {
        orderValue = new Decimal(positionSizing.maxOrderSizeUsd)
      }

      // CRITICAL: Verify we don't exceed available balance after maxOrderSizeUsd cap
      if (orderValue.gt(effectiveBalance)) {
        console.log('[UnifiedStrategyExecutor] maxOrderSizeUsd exceeds available balance, capping:', {
          maxOrderSizeUsd: positionSizing.maxOrderSizeUsd,
          effectiveBalance: effectiveBalance.toString(),
          isMarketOrder
        })
        orderValue = effectiveBalance
      }

      // Calculate quantity from order value
      const quantity = orderValue.div(price)

      return {
        quantity,
        valueUsd: orderValue.toNumber(),
      }
    } else {
      // For sell orders, use base balance
      const baseBalanceHuman = new Decimal(balances.base.unlocked).div(10 ** market.base.decimals)
      // Apply slippage buffer for market orders
      const effectiveBalance = baseBalanceHuman.mul(MARKET_ORDER_SLIPPAGE_BUFFER)
      let quantity = effectiveBalance.mul(balancePercentage)

      // Calculate order value in USD
      let orderValue = quantity.mul(price)

      // Apply maxOrderSizeUsd cap if configured
      if (positionSizing.maxOrderSizeUsd && orderValue.gt(positionSizing.maxOrderSizeUsd)) {
        orderValue = new Decimal(positionSizing.maxOrderSizeUsd)
        // Recalculate quantity based on capped value
        quantity = orderValue.div(price)
      }

      // CRITICAL: Verify quantity doesn't exceed available balance after maxOrderSizeUsd cap
      if (quantity.gt(effectiveBalance)) {
        console.log('[UnifiedStrategyExecutor] maxOrderSizeUsd requires more than available balance, capping:', {
          maxOrderSizeUsd: positionSizing.maxOrderSizeUsd,
          effectiveBalance: effectiveBalance.toString(),
          isMarketOrder
        })
        quantity = effectiveBalance
        orderValue = quantity.mul(price)
      }

      return {
        quantity,
        valueUsd: orderValue.toNumber(),
      }
    }
  }
}

export const unifiedStrategyExecutor = new UnifiedStrategyExecutor()

