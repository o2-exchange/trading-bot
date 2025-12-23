import Decimal from 'decimal.js'
import { StrategyConfig } from '../types/strategy'
import { Order, OrderStatus } from '../types/order'
import { Market } from '../types/market'
import { orderService } from './orderService'
import { db } from './dbService'

interface FillPrice {
  price: string
  quantity: string
  timestamp: number
}

class OrderFulfillmentService {
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
      
      // Use actual fill price (price_fill) if available, otherwise fallback to order price
      // price_fill is the weighted average execution price across all fills
      // order.price is the limit price (may not match actual execution price)
      let fillPriceScaled: Decimal
      if (order.price_fill && order.price_fill !== '0' && order.price_fill !== '') {
        fillPriceScaled = new Decimal(order.price_fill)
      } else {
        // Fallback to order price if price_fill not available
        fillPriceScaled = new Decimal(order.price)
      }
      
      // Convert from scaled format to human-readable format
      // Price is in scaled format (e.g., "1000000000" for $1000 with 6 decimals)
      const fillPriceHuman = fillPriceScaled.div(10 ** market.quote.decimals).toString()
      
      // Also convert quantity from scaled to human-readable format
      const fillQuantityScaled = new Decimal(fillQuantity)
      const fillQuantityHuman = fillQuantityScaled.div(10 ** market.base.decimals).toString()
      
      const fillEntry: FillPrice = {
        price: fillPriceHuman, // Store in human-readable format (actual execution price)
        quantity: fillQuantityHuman, // Store in human-readable format
        timestamp: Date.now(),
      }

      if (order.side === 'Buy') {
        updatedConfig.lastFillPrices.buy.push(fillEntry)
      } else {
        updatedConfig.lastFillPrices.sell.push(fillEntry)
      }

      // Recalculate average prices
      updatedConfig.averageBuyPrice = this.calculateAveragePrice(
        updatedConfig.lastFillPrices.buy,
        'weighted'
      )
      updatedConfig.averageSellPrice = this.calculateAveragePrice(
        updatedConfig.lastFillPrices.sell,
        'weighted'
      )
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
   * Check if sell order should be placed based on average buy price
   */
  shouldPlaceSellOrder(config: StrategyConfig, sellPrice: string): boolean {
    if (!config.orderManagement.onlySellAboveBuyPrice) {
      return true // No restriction
    }

    if (!config.averageBuyPrice || config.averageBuyPrice === '0') {
      console.log('[OrderFulfillmentService] No average buy price tracked yet, allowing sell order')
      return true // No buy price tracked yet, allow sell
    }

    const sellPriceDecimal = new Decimal(sellPrice)
    const avgBuyPriceDecimal = new Decimal(config.averageBuyPrice)

    // Only sell if sell price > average buy price
    const shouldPlace = sellPriceDecimal.gt(avgBuyPriceDecimal)
    
    console.log('[OrderFulfillmentService] Profit protection check:', {
      averageBuyPrice: config.averageBuyPrice,
      sellPrice: sellPrice,
      shouldPlace,
      onlySellAboveBuyPrice: config.orderManagement.onlySellAboveBuyPrice
    })

    return shouldPlace
  }

  /**
   * Track order fills by comparing current order state with previous state
   */
  async trackOrderFills(
    marketId: string,
    ownerAddress: string
  ): Promise<Map<string, { order: Order; previousFilledQuantity: string }>> {
    const normalizedAddress = ownerAddress.toLowerCase()
    
    // Get current open orders
    const currentOrders = await orderService.getOpenOrders(marketId, normalizedAddress)
    
    // Get previous order states from database
    const previousOrders = await db.orders
      .where('market_id')
      .equals(marketId)
      .and((order) => order.status === OrderStatus.Open || order.status === OrderStatus.PartiallyFilled)
      .toArray()

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
        }
      } else {
        // New order, check if it has any fills
        const currentFilled = new Decimal(currentOrder.filled_quantity || '0')
        if (currentFilled.gt(0)) {
          fillsDetected.set(currentOrder.order_id, {
            order: currentOrder,
            previousFilledQuantity: '0',
          })
        }
      }
    }

    // Also check for orders that moved from open to filled/cancelled
    for (const previousOrder of previousOrders) {
      const currentOrder = currentOrders.find((o) => o.order_id === previousOrder.order_id)
      
      if (!currentOrder) {
        // Order is no longer open - check if it was filled
        const updatedOrder = await orderService.getOrder(previousOrder.order_id, normalizedAddress)
        if (updatedOrder && updatedOrder.status === OrderStatus.Filled) {
          const currentFilled = new Decimal(updatedOrder.filled_quantity || '0')
          const previousFilled = new Decimal(previousOrder.filled_quantity || '0')
          
          if (currentFilled.gt(previousFilled)) {
            fillsDetected.set(updatedOrder.order_id, {
              order: updatedOrder,
              previousFilledQuantity: previousOrder.filled_quantity || '0',
            })
          }
        }
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

