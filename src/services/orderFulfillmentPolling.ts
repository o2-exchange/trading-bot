import { orderFulfillmentService } from './orderFulfillmentService'
import { db } from './dbService'
import { tradingEngine } from './tradingEngine'
import { marketService } from './marketService'
import { tradeHistoryService } from './tradeHistoryService'
import { OrderSide } from '../types/order'
import { sessionService } from './sessionService'

class OrderFulfillmentPolling {
  private pollingTimeouts: Map<string, number> = new Map()
  private pollingActive: Map<string, boolean> = new Map()
  private readonly POLL_INTERVAL_MS = 1000 // Normal poll every 1 second (reduced from 2.5s)
  private readonly FAST_POLL_INTERVAL_MS = 250 // Fast poll every 250ms
  private fastPollUntil: Map<string, number> = new Map() // Per-market fast polling end time

  /**
   * Enable fast polling for a short period (e.g., after order placement).
   * This reduces latency for detecting immediate fills.
   */
  enableFastPolling(marketId: string, durationMs: number = 5000): void {
    this.fastPollUntil.set(marketId, Date.now() + durationMs)
    console.log(`[OrderFulfillmentPolling] Fast polling enabled for ${marketId} for ${durationMs}ms`)
  }

  /**
   * Get the current polling interval for a market
   */
  private getCurrentInterval(marketId: string): number {
    const fastUntil = this.fastPollUntil.get(marketId) || 0
    if (Date.now() < fastUntil) {
      return this.FAST_POLL_INTERVAL_MS
    }
    return this.POLL_INTERVAL_MS
  }

  /**
   * Start polling for order fills for a specific market
   */
  startPolling(marketId: string, ownerAddress: string): void {
    // Stop existing polling if any
    this.stopPolling(marketId)
    this.pollingActive.set(marketId, true)

    const poll = async () => {
      if (!this.pollingActive.get(marketId)) {
        return
      }
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

      // Schedule next poll with dynamic interval
      if (this.pollingActive.get(marketId)) {
        const nextInterval = this.getCurrentInterval(marketId)
        const timeoutId = window.setTimeout(poll, nextInterval)
        this.pollingTimeouts.set(marketId, timeoutId)
      }
    }

    // Start initial poll
    const timeoutId = window.setTimeout(poll, this.getCurrentInterval(marketId))
    this.pollingTimeouts.set(marketId, timeoutId)
    console.log(`[OrderFulfillmentPolling] Started polling for market ${marketId}`)
  }

  /**
   * Stop polling for a specific market
   */
  stopPolling(marketId: string): void {
    this.pollingActive.set(marketId, false)
    const timeoutId = this.pollingTimeouts.get(marketId)
    if (timeoutId) {
      clearTimeout(timeoutId)
      this.pollingTimeouts.delete(marketId)
      console.log(`[OrderFulfillmentPolling] Stopped polling for market ${marketId}`)
    }
    this.fastPollUntil.delete(marketId)
  }

  /**
   * Stop all polling
   */
  stopAll(): void {
    for (const [marketId, timeoutId] of this.pollingTimeouts) {
      clearTimeout(timeoutId)
      this.pollingActive.set(marketId, false)
    }
    this.pollingTimeouts.clear()
    this.fastPollUntil.clear()
    console.log('[OrderFulfillmentPolling] Stopped all polling')
  }

  /**
   * Check if polling is active for a market
   */
  isPolling(marketId: string): boolean {
    return this.pollingActive.get(marketId) || false
  }
}

export const orderFulfillmentPolling = new OrderFulfillmentPolling()

