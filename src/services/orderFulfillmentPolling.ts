import { orderFulfillmentService } from './orderFulfillmentService'
import { db } from './dbService'
import { tradingEngine } from './tradingEngine'
import { marketService } from './marketService'
import { tradeHistoryService } from './tradeHistoryService'
import { OrderSide } from '../types/order'
import { sessionService } from './sessionService'
import { wsOrdersTracker } from './wsOrdersTracker'
import Decimal from 'decimal.js'

class OrderFulfillmentPolling {
  private pollingTimeouts: Map<string, number> = new Map()
  private pollingActive: Map<string, boolean> = new Map()
  /**
   * REST poll cadence — used as a safety net only, since `subscribe_orders`
   * via WS now triggers an immediate `pokeFromWs()` whenever an order
   * changes state. The REST loop catches anything WS may have missed
   * (disconnect window, server-side dropped frame).
   */
  private readonly POLL_INTERVAL_MS = 5000 // 5s safety-net poll (down from 1s — WS handles the fast path)
  private readonly FAST_POLL_INTERVAL_MS = 250 // Fast poll right after order placement
  private fastPollUntil: Map<string, number> = new Map() // Per-market fast polling end time
  /** Per-trade-account WS listener disposers, so we can clean up on stop. */
  private wsListenerDisposers: Map<string, () => void> = new Map()

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
   * Start polling for order fills for a specific market. When the WS
   * `subscribe_orders` stream is connected, fills are detected in
   * real-time via {@link attachWsListener}; the REST poll below is a
   * safety net for the disconnect window.
   */
  startPolling(marketId: string, ownerAddress: string): void {
    // Stop existing polling if any
    this.stopPolling(marketId)
    this.pollingActive.set(marketId, true)

    // Hook up the WS-driven fast path — see `attachWsListener` below.
    void this.attachWsListener(marketId, ownerAddress)

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

                // Update trade record with fill info, status, and the
                // actual USD-value of the fill so trade-history volume
                // stats reflect what truly filled (not what was submitted).
                const priceFillHuman = new Decimal(order.price_fill || '0').div(10 ** market.quote.decimals)
                const filledQtyHuman = new Decimal(order.filled_quantity || '0').div(10 ** market.base.decimals)
                const valueUsd = priceFillHuman.mul(filledQtyHuman).toNumber()
                await tradeHistoryService.updateTradeByOrderId(orderId, {
                  status: 'filled',
                  priceFill: order.price_fill,
                  filledQuantity: order.filled_quantity,
                  valueUsd,
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
    // Detach WS listener for this market (key includes both market + owner).
    for (const [key, dispose] of this.wsListenerDisposers) {
      if (key.startsWith(`${marketId}:`)) {
        try { dispose() } catch { /* ignore */ }
        this.wsListenerDisposers.delete(key)
      }
    }
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
    for (const dispose of this.wsListenerDisposers.values()) {
      try { dispose() } catch { /* ignore */ }
    }
    this.wsListenerDisposers.clear()
    console.log('[OrderFulfillmentPolling] Stopped all polling')
  }

  /**
   * Subscribe to WS order updates for the user's trade account and run
   * `trackOrderFills` immediately on every push — so fills are detected
   * within ~50ms of confirmation instead of waiting for the next REST
   * poll cycle.
   */
  private async attachWsListener(marketId: string, ownerAddress: string): Promise<void> {
    try {
      const normalizedAddress = ownerAddress.toLowerCase()
      const session = await sessionService.getActiveSession(normalizedAddress, true)
      if (!session) return
      const key = `${marketId}:${session.tradeAccountId.toLowerCase()}`
      // Already listening — keep the existing disposer.
      if (this.wsListenerDisposers.has(key)) return
      const dispose = wsOrdersTracker.addListener(session.tradeAccountId, async (event) => {
        if (event.order.market_id !== marketId) return
        if (!this.pollingActive.get(marketId)) return
        if (!tradingEngine.isActive()) return
        // Real-time fill notification: kick off the same processing the
        // poll path runs.
        try {
          await orderFulfillmentService.trackOrderFills(marketId, ownerAddress)
        } catch (err) {
          console.warn('[OrderFulfillmentPolling] WS-poked trackOrderFills failed:', err)
        }
      })
      this.wsListenerDisposers.set(key, dispose)
    } catch (err) {
      console.warn('[OrderFulfillmentPolling] attachWsListener failed:', err)
    }
  }

  /**
   * Check if polling is active for a market
   */
  isPolling(marketId: string): boolean {
    return this.pollingActive.get(marketId) || false
  }
}

export const orderFulfillmentPolling = new OrderFulfillmentPolling()

