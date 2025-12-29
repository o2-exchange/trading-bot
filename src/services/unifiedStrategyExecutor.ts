import Decimal from 'decimal.js'
import { Market } from '../types/market'
import { StrategyConfig, StrategyExecutionResult, OrderExecution } from '../types/strategy'
import { OrderSide, OrderType } from '../types/order'
import { marketService } from './marketService'
import { orderService } from './orderService'
import { balanceService } from './balanceService'
import { orderFulfillmentService } from './orderFulfillmentService'
import { db } from './dbService'

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

/**
 * Format price with appropriate decimal places based on value, removing trailing zeros
 */
function formatPrice(price: Decimal): string {
  const priceValue = price.toNumber()

  if (priceValue === 0 || isNaN(priceValue) || !isFinite(priceValue)) {
    return '0'
  }

  let formatted: string
  if (priceValue >= 1) {
    formatted = priceValue.toFixed(2)
  } else if (priceValue >= 0.01) {
    formatted = priceValue.toFixed(4)
  } else if (priceValue >= 0.0001) {
    formatted = priceValue.toFixed(6)
  } else {
    formatted = priceValue.toFixed(8)
  }

  // Remove trailing zeros
  return formatted.replace(/\.?0+$/, '')
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
      // Round quantity to 3 decimal places
      const quantityRounded = roundDownTo3Decimals(baseBalanceHuman)
      const quantityScaled = quantityRounded.mul(10 ** market.base.decimals).toFixed(0)

      // Use current market price (no profit requirement for stop loss)
      const sellPriceTruncated = scaleUpAndTruncateToInt(
        currentPrice,
        market.quote.decimals,
        market.quote.max_precision
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
      orders.push({
        orderId: order.order_id,
        side: 'Sell',
        success: true,
        price: sellPriceScaled,
        quantity: quantityScaled,
        priceHuman: formatPrice(currentPrice),
        quantityHuman: quantityRounded.toFixed(3).replace(/\.?0+$/, ''),
        marketPair,
      })

      // 5. Clear the average buy price since we've exited the position
      // This prevents the stop loss from triggering again
      const updatedConfig = { ...config }
      updatedConfig.averageBuyPrice = '0'
      updatedConfig.lastFillPrices = { buy: [], sell: [] }
      await db.strategyConfigs.update(market.market_id, { config: updatedConfig })
      console.log('[UnifiedStrategyExecutor] Stop loss: Cleared average buy price')

    } catch (error: any) {
      console.error('[UnifiedStrategyExecutor] Stop loss: Failed to place market sell order:', error)
      const marketPair = `${market.base.symbol}/${market.quote.symbol}`
      orders.push({
        orderId: '',
        side: 'Sell',
        success: false,
        error: `Stop loss sell failed: ${error.message}`,
        marketPair,
      })
    }

    return { triggered: true, orders }
  }

  /**
   * Execute strategy based on configuration
   */
  async execute(
    market: Market,
    config: StrategyConfig,
    ownerAddress: string,
    tradingAccountId: string
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

      // Get current market data
      const ticker = await marketService.getTicker(market.market_id)
      if (!ticker) {
        console.warn('[UnifiedStrategyExecutor] No ticker data available')
        return {
          executed: false,
          orders: [],
        }
      }

      // Get orderbook for spread calculation
      const orderBook = await marketService.getOrderBook(market.market_id)
      
      // Check spread if orderbook is available
      if (orderBook && config.orderConfig.maxSpreadPercent > 0) {
        const spread = this.calculateSpread(orderBook, market)
        if (spread && spread > config.orderConfig.maxSpreadPercent) {
          console.log(`[UnifiedStrategyExecutor] Spread ${spread.toFixed(2)}% exceeds max ${config.orderConfig.maxSpreadPercent}%, skipping`)
          return {
            executed: false,
            orders: [],
            nextRunAt,
          }
        }
      }

      // Clear balance cache to ensure fresh data
      balanceService.clearCache()

      // Get current balances
      const balances = await balanceService.getMarketBalances(
        market,
        tradingAccountId,
        ownerAddress
      )

      // Log available balances for debugging
      const baseBalanceHuman = new Decimal(balances.base.unlocked).div(10 ** market.base.decimals)
      const quoteBalanceHuman = new Decimal(balances.quote.unlocked).div(10 ** market.quote.decimals)
      console.log('[UnifiedStrategyExecutor] Available balances:', {
        base: `${baseBalanceHuman.toFixed(6)} ${market.base.symbol}`,
        quote: `${quoteBalanceHuman.toFixed(2)} ${market.quote.symbol}`,
        orderType: config.orderConfig.orderType
      })

      // Check max open orders if configured
      let shouldPlaceBuy = true
      let shouldPlaceSell = true
      
      if (config.orderManagement.maxOpenOrders > 0) {
        const openOrders = await orderService.getOpenOrders(market.market_id, ownerAddress)
        const buyOrders = openOrders.filter((o) => o.side === OrderSide.Buy)
        const sellOrders = openOrders.filter((o) => o.side === OrderSide.Sell)
        
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
    const offsetMultiplier = 1 + (orderConfig.priceOffsetPercent / 100)
    const buyPrice = referencePrice.mul(offsetMultiplier)
    const sellPrice = referencePrice.mul(1 - (orderConfig.priceOffsetPercent / 100))

    return { buyPrice, sellPrice }
  }

  /**
   * Calculate spread percentage from orderbook
   */
  private calculateSpread(orderBook: any, market: Market): number | null {
    if (!orderBook.bids || orderBook.bids.length === 0 || !orderBook.asks || orderBook.asks.length === 0) {
      return null
    }

    const bestBidEntry = orderBook.bids[0]
    const bestAskEntry = orderBook.asks[0]
    
    if (!bestBidEntry || !bestAskEntry || bestBidEntry[0] === undefined || bestAskEntry[0] === undefined) {
      return null
    }

    const bestBid = new Decimal(bestBidEntry[0]).div(10 ** market.quote.decimals)
    const bestAsk = new Decimal(bestAskEntry[0]).div(10 ** market.quote.decimals)
    const midPrice = bestBid.plus(bestAsk).div(2)
    const spread = bestAsk.minus(bestBid).div(midPrice).mul(100)

    return spread.toNumber()
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

    // Truncate price according to max_precision
    const buyPriceTruncated = scaleUpAndTruncateToInt(
      buyPriceHuman,
      market.quote.decimals,
      market.quote.max_precision
    )
    const buyPriceScaled = buyPriceTruncated.toFixed(0)

    // Round quantity to 3 decimal places
    const quantityRounded = roundDownTo3Decimals(orderSize.quantity)
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
      
      return {
        orderId: order.order_id,
        side: 'Buy',
        success: true,
        price: buyPriceScaled,
        quantity: quantityScaled,
        priceHuman: formatPrice(displayPrice),
        quantityHuman: quantityRounded.toFixed(3).replace(/\.?0+$/, ''),
        marketPair,
      }
    } catch (error: any) {
      console.error('[UnifiedStrategyExecutor] Buy order failed:', error)
      const marketPair = `${market.base.symbol}/${market.quote.symbol}`
      return {
        orderId: '',
        side: 'Buy',
        success: false,
        error: error.message,
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

    // Truncate price according to max_precision (use adjusted price)
    const sellPriceTruncated = scaleUpAndTruncateToInt(
      adjustedSellPrice,
      market.quote.decimals,
      market.quote.max_precision
    )
    const sellPriceScaled = sellPriceTruncated.toFixed(0)

    // Round quantity to 3 decimal places
    const quantityRounded = roundDownTo3Decimals(orderSize.quantity)
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
      
      return {
        orderId: order.order_id,
        side: 'Sell',
        success: true,
        price: sellPriceScaled,
        quantity: quantityScaled,
        priceHuman: formatPrice(displayPrice),
        quantityHuman: quantityRounded.toFixed(3).replace(/\.?0+$/, ''),
        marketPair,
      }
    } catch (error: any) {
      console.error('[UnifiedStrategyExecutor] Sell order failed:', error)
      const marketPair = `${market.base.symbol}/${market.quote.symbol}`
      return {
        orderId: '',
        side: 'Sell',
        success: false,
        error: error.message,
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

