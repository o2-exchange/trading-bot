import { orderFulfillmentService } from './orderFulfillmentService'
import { db } from './dbService'
import { tradingEngine } from './tradingEngine'
import { marketService } from './marketService'
import { tradeHistoryService } from './tradeHistoryService'
import { OrderSide } from '../types/order'
import { sessionService } from './sessionService'

class OrderFulfillmentPolling {
  private pollingIntervals: Map<string, number> = new Map()
  private readonly POLL_INTERVAL_MS = 2500 // Poll every 2.5 seconds

  /**
   * Start polling for order fills for a specific market
   */
  startPolling(marketId: string, ownerAddress: string): void {
    // Stop existing polling if any
    this.stopPolling(marketId)

    const intervalId = window.setInterval(async () => {
      if (!tradingEngine.isActive()) {
        this.stopPolling(marketId)
        return
      }

      try {
        // Track fills and update configs
        // Note: Cancelled order detection is handled by tradingEngine.syncPendingTradeStatuses()
        const fills = await orderFulfillmentService.trackOrderFills(marketId, ownerAddress)

        if (fills.size > 0) {
          console.log(`[OrderFulfillmentPolling] Detected ${fills.size} fill(s) for market ${marketId}`)
          
          // Update strategy config with fill prices (always enabled)
          const storedConfig = await db.strategyConfigs.get(marketId)
          if (storedConfig) {
            const market = await marketService.getMarket(marketId)
            if (market) {
              let updatedConfig = storedConfig.config
              
              for (const [orderId, { order, previousFilledQuantity }] of fills) {
                updatedConfig = await orderFulfillmentService.updateFillPrices(
                  updatedConfig,
                  order,
                  market,
                  previousFilledQuantity
                )

                // Update trade record with fill info and status
                await tradeHistoryService.updateTradeByOrderId(orderId, {
                  status: 'filled',
                  priceFill: order.price_fill,
                  filledQuantity: order.filled_quantity,
                })
              }
              
              // Update config in database with incremented version
              await db.strategyConfigs.update(marketId, {
                config: updatedConfig,
                updatedAt: Date.now(),
                version: (storedConfig.version ?? 0) + 1,
              })
              
              console.log(`[OrderFulfillmentPolling] Updated fill prices for market ${marketId}`, {
                averageBuyPrice: updatedConfig.averageBuyPrice,
                averageSellPrice: updatedConfig.averageSellPrice
              })

              // Immediately place sell orders for buy fills (only when trading is active)
              const normalizedAddress = ownerAddress.toLowerCase()
              // Use skipValidation=true since this is in a hot polling path and session
              // is already validated when trading starts. If session is invalid, order
              // placement will fail gracefully.
              const session = await sessionService.getActiveSession(normalizedAddress, true)
              if (session && tradingEngine.isActive()) {
                for (const [orderId, { order }] of fills) {
                  // Check if this is a buy order
                  if (order.side === OrderSide.Buy) {
                    // Place immediate sell order after buy fill
                    try {
                      await orderFulfillmentService.placeSellOrderAfterBuyFill(
                        order,
                        market,
                        updatedConfig,
                        ownerAddress,
                        session.tradeAccountId
                      )
                    } catch (error) {
                      console.error(`[OrderFulfillmentPolling] Error placing immediate sell order for buy fill ${orderId}:`, error)
                      // Continue with other fills even if one fails
                    }
                  }
                }
              }
            }
          }
        }
      } catch (error) {
        console.error(`[OrderFulfillmentPolling] Error polling fills for market ${marketId}:`, error)
      }
    }, this.POLL_INTERVAL_MS)

    this.pollingIntervals.set(marketId, intervalId)
    console.log(`[OrderFulfillmentPolling] Started polling for market ${marketId}`)
  }

  /**
   * Stop polling for a specific market
   */
  stopPolling(marketId: string): void {
    const intervalId = this.pollingIntervals.get(marketId)
    if (intervalId) {
      clearInterval(intervalId)
      this.pollingIntervals.delete(marketId)
      console.log(`[OrderFulfillmentPolling] Stopped polling for market ${marketId}`)
    }
  }

  /**
   * Stop all polling
   */
  stopAll(): void {
    for (const [marketId, intervalId] of this.pollingIntervals) {
      clearInterval(intervalId)
    }
    this.pollingIntervals.clear()
    console.log('[OrderFulfillmentPolling] Stopped all polling')
  }

  /**
   * Check if polling is active for a market
   */
  isPolling(marketId: string): boolean {
    return this.pollingIntervals.has(marketId)
  }
}

export const orderFulfillmentPolling = new OrderFulfillmentPolling()

