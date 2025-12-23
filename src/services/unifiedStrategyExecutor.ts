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

class UnifiedStrategyExecutor {
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

      // Cancel and replace if configured
      if (config.orderManagement.cancelAndReplace) {
        const openOrders = await orderService.getOpenOrders(market.market_id, ownerAddress)
        for (const order of openOrders) {
          try {
            await orderService.cancelOrder(order.order_id, market.market_id, ownerAddress)
            console.log(`[UnifiedStrategyExecutor] Cancelled order: ${order.order_id}`)
          } catch (error) {
            console.error(`[UnifiedStrategyExecutor] Failed to cancel order ${order.order_id}:`, error)
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
        if (orderBook && orderBook.bids && orderBook.bids.length > 0) {
          referencePrice = new Decimal(orderBook.bids[0][0]).div(10 ** market.quote.decimals)
        } else {
          referencePrice = new Decimal(ticker.last_price).div(10 ** market.quote.decimals)
        }
        break
      
      case 'offsetFromBestAsk':
        if (orderBook && orderBook.asks && orderBook.asks.length > 0) {
          referencePrice = new Decimal(orderBook.asks[0][0]).div(10 ** market.quote.decimals)
        } else {
          referencePrice = new Decimal(ticker.last_price).div(10 ** market.quote.decimals)
        }
        break
      
      case 'offsetFromMid':
      default:
        // Calculate mid price from orderbook or use ticker
        if (orderBook && orderBook.bids && orderBook.bids.length > 0 && orderBook.asks && orderBook.asks.length > 0) {
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

    const bestBid = new Decimal(orderBook.bids[0][0]).div(10 ** market.quote.decimals)
    const bestAsk = new Decimal(orderBook.asks[0][0]).div(10 ** market.quote.decimals)
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
    ownerAddress: string
  ): Promise<OrderExecution | null> {
    // Calculate order size
    const orderSize = this.calculateOrderSize(market, config.positionSizing, balances, 'buy', buyPriceHuman, ticker)
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
      return {
        orderId: order.order_id,
        side: 'Buy',
        success: true,
        price: buyPriceScaled,
        quantity: quantityScaled,
      }
    } catch (error: any) {
      console.error('[UnifiedStrategyExecutor] Buy order failed:', error)
      return {
        orderId: '',
        side: 'Buy',
        success: false,
        error: error.message,
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
    ownerAddress: string
  ): Promise<OrderExecution | null> {
    // Check profit protection
    // Convert sell price to human-readable format for comparison
    // (averageBuyPrice is stored in human-readable format)
    const sellPriceString = sellPriceHuman.toString()

    if (!orderFulfillmentService.shouldPlaceSellOrder(config, sellPriceString)) {
      console.log('[UnifiedStrategyExecutor] Sell order skipped: sell price below average buy price', {
        sellPrice: sellPriceString,
        averageBuyPrice: config.averageBuyPrice || 'not set'
      })
      return null
    }

    // Calculate order size
    const orderSize = this.calculateOrderSize(market, config.positionSizing, balances, 'sell', sellPriceHuman, ticker)
    if (!orderSize || orderSize.quantity.eq(0)) {
      console.log('[UnifiedStrategyExecutor] Sell order skipped: insufficient balance or below minimum')
      return null
    }

    // Truncate price according to max_precision
    const sellPriceTruncated = scaleUpAndTruncateToInt(
      sellPriceHuman,
      market.quote.decimals,
      market.quote.max_precision
    )
    const sellPriceScaled = sellPriceTruncated.toFixed(0)

    // Round quantity to 3 decimal places
    const quantityRounded = roundDownTo3Decimals(orderSize.quantity)
    const quantityScaled = quantityRounded.mul(10 ** market.base.decimals).toFixed(0)

    // Check minimum order size
    const orderValueUsd = quantityRounded.mul(sellPriceHuman).toNumber()
    if (orderValueUsd < config.positionSizing.minOrderSizeUsd) {
      console.log(`[UnifiedStrategyExecutor] Sell order skipped: value $${orderValueUsd.toFixed(2)} below minimum $${config.positionSizing.minOrderSizeUsd}`)
      return null
    }

    try {
      // Direct mapping: UI only shows Market and Spot
      const orderType: OrderType = config.orderConfig.orderType === 'Spot' 
        ? OrderType.Spot 
        : OrderType.Market
      const order = await orderService.placeOrder(
        market,
        OrderSide.Sell,
        orderType,
        sellPriceScaled,
        quantityScaled,
        ownerAddress
      )

      console.log('[UnifiedStrategyExecutor] Sell order placed:', order.order_id)
      return {
        orderId: order.order_id,
        side: 'Sell',
        success: true,
        price: sellPriceScaled,
        quantity: quantityScaled,
      }
    } catch (error: any) {
      console.error('[UnifiedStrategyExecutor] Sell order failed:', error)
      return {
        orderId: '',
        side: 'Sell',
        success: false,
        error: error.message,
      }
    }
  }

  /**
   * Calculate order size based on position sizing config
   */
  private calculateOrderSize(
    market: Market,
    positionSizing: StrategyConfig['positionSizing'],
    balances: { base: any; quote: any },
    side: 'buy' | 'sell',
    price: Decimal,
    ticker: any
  ): { quantity: Decimal; valueUsd: number } | null {
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
      
      // Check if we have enough balance
      if (side === 'buy') {
        const quoteBalanceHuman = new Decimal(balances.quote.unlocked).div(10 ** market.quote.decimals)
        const requiredQuote = quantity.mul(price)
        if (requiredQuote.gt(quoteBalanceHuman)) {
          // Use available balance instead
          const maxQuantity = quoteBalanceHuman.div(price)
          return {
            quantity: maxQuantity,
            valueUsd: maxQuantity.mul(price).toNumber(),
          }
        }
      } else {
        const baseBalanceHuman = new Decimal(balances.base.unlocked).div(10 ** market.base.decimals)
        if (quantity.gt(baseBalanceHuman)) {
          // Use available balance instead
          return {
            quantity: baseBalanceHuman,
            valueUsd: baseBalanceHuman.mul(price).toNumber(),
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
      let orderValue = quoteBalanceHuman.mul(balancePercentage)
      
      // Apply maxOrderSizeUsd cap if configured
      if (positionSizing.maxOrderSizeUsd && orderValue.gt(positionSizing.maxOrderSizeUsd)) {
        orderValue = new Decimal(positionSizing.maxOrderSizeUsd)
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
      let quantity = baseBalanceHuman.mul(balancePercentage)
      
      // Calculate order value in USD
      let orderValue = quantity.mul(price)
      
      // Apply maxOrderSizeUsd cap if configured
      if (positionSizing.maxOrderSizeUsd && orderValue.gt(positionSizing.maxOrderSizeUsd)) {
        orderValue = new Decimal(positionSizing.maxOrderSizeUsd)
        // Recalculate quantity based on capped value
        quantity = orderValue.div(price)
      }
      
      return {
        quantity,
        valueUsd: orderValue.toNumber(),
      }
    }
  }
}

export const unifiedStrategyExecutor = new UnifiedStrategyExecutor()

