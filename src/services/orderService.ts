import { OrderBook } from '../types/contracts/OrderBook'
import { o2ApiService } from './o2ApiService'
import { sessionService } from './sessionService'
import { sessionManagerService } from './sessionManagerService'
import { tradingAccountService } from './tradingAccountService'
import { encodeActions } from '../utils/o2/o2Encoders'
import { Order, CreateOrderParams, CancelOrderParams, OrderStatus } from '../types/order'
import { Market } from '../types/market'
import { db } from './dbService'
import { OrderSide, OrderType } from '../types/order'
import { CreateOrderAction, CancelOrderAction } from '../types/o2ApiTypes'
import { marketService } from './marketService'
import { balanceService } from './balanceService'
import { wsOrdersTracker } from './wsOrdersTracker'

class OrderService {
  async placeOrder(
    market: Market,
    side: OrderSide,
    orderType: OrderType,
    price: string,
    quantity: string,
    ownerAddress: string,
    slippageTolerance?: number
  ): Promise<Order> {
    try {
      return await this._placeOrderInternal(market, side, orderType, price, quantity, ownerAddress, slippageTolerance)
    } catch (error: any) {
      // On 400 error (InvalidSignature / nonce desync / session conflict), retry once with fresh state
      if (error?.response?.status === 400) {
        const errorCode = error?.response?.data?.error_code || error?.response?.data?.code
        const reason = error?.response?.data?.reason || error?.message || ''

        // PostOnly rejection: order would match immediately — don't retry, this is expected
        if (reason.includes('PostOnly') || reason.includes('WouldMatch') || reason.includes('post_only') || errorCode === 'PostOnlyWouldMatch') {
          const postOnlyError = new Error('PostOnly order rejected: would match immediately')
          ;(postOnlyError as any).isPostOnlyRejection = true
          throw postOnlyError
        }

        console.warn(`[OrderService] 400 error (code: ${errorCode}), attempting recovery and retry...`)

        const normalizedAddress = ownerAddress.toLowerCase()

        // Clear session validation cache so next getActiveSession does a fresh on-chain check
        sessionService.clearValidationCache()

        // Clear cached manager to force nonce refresh
        const session = await sessionService.getActiveSession(normalizedAddress, true)
        if (session) {
          sessionManagerService.clearManager(normalizedAddress, session.id)
        }

        // Retry once with fresh state
        try {
          return await this._placeOrderInternal(market, side, orderType, price, quantity, ownerAddress, slippageTolerance)
        } catch (retryError: any) {
          console.error('[OrderService] Retry after 400 also failed:', retryError?.message)
          throw retryError
        }
      }
      throw error
    }
  }

  private async _placeOrderInternal(
    market: Market,
    side: OrderSide,
    orderType: OrderType,
    price: string,
    quantity: string,
    ownerAddress: string,
    slippageTolerance?: number
  ): Promise<Order> {
    // Normalize address
    const normalizedAddress = ownerAddress.toLowerCase()

    // Get active session — skip on-chain validation during trading (matching fuel-o2).
    // Session was validated at startup; during active trading, trust the local cache.
    // If the session is actually revoked, the O2 API will return a 400 error which
    // triggers the retry logic in placeOrder().
    const session = await sessionService.getActiveSession(normalizedAddress, true)
    if (!session) {
      throw new Error('No active session found. Please create a session first.')
    }

    // Verify market is in session's allowed contracts
    if (!session.contractIds.includes(market.contract_id)) {
      throw new Error(`Market ${market.market_id} is not in session's allowed contracts`)
    }

    // Get TradeAccountManager - fetch latest nonce from API before placing order (matching O2 frontend)
    const tradeAccountManager = await sessionManagerService.getTradeAccountManager(normalizedAddress, true)

    // Create order action. `slippage_tolerance` is only read by the encoder
    // when `orderType === OrderType.BoundedMarket` — see o2Encoders.ts.
    const orderAction: CreateOrderAction = {
      CreateOrder: {
        side,
        order_type: orderType,
        price,
        quantity,
        ...(slippageTolerance !== undefined ? { slippage_tolerance: slippageTolerance } : {}),
      },
    }

    // Create OrderBook contract instance
    const orderBook = new OrderBook(market.contract_id, tradeAccountManager.account)

    // Encode actions
    const encodedActions = await encodeActions(
      tradeAccountManager.identity,
      orderBook,
      {
        baseAssetId: market.base.asset as any,
        quoteAssetId: market.quote.asset as any,
        baseDecimals: market.base.decimals,
        quoteDecimals: market.quote.decimals,
      },
      [orderAction],
      tradeAccountManager.defaultGasLimit
    )

    // Get session call params with signature
    const payload = await tradeAccountManager.api_SessionCallContractsParams(encodedActions.invokeScopes)

    // Submit transaction
    // Set collect_orders to true since we need the order object back
    // O2 frontend uses false when they don't need the order immediately, but we need it
    const response = await o2ApiService.sessionSubmitTransaction(
      {
        actions: [
          {
            market_id: market.market_id,
            actions: encodedActions.actions,
          },
        ],
        signature: payload.signature as any,
        nonce: payload.nonce,
        trade_account_id: payload.trade_account_id,
        session_id: payload.session_id as any,
        variable_outputs: payload.variable_outputs,
        min_gas_limit: payload.min_gas_limit,
        collect_orders: true,
      },
      normalizedAddress
    )

    // Increment nonce in memory (for next transaction)
    tradeAccountManager.incrementNonce()

    // Persist nonce to database with retry logic so next order uses correct nonce
    // IMPORTANT: We await this to ensure nonce is persisted before returning
    // This prevents nonce desync on browser crash/restart
    // NOTE: We reuse the session object from above to avoid another getActiveSession call
    const newNonce = parseInt(tradeAccountManager.nonce.toString())
    let noncePersisted = false

    for (let i = 1; i <= 3; i++) {
      try {
        await tradingAccountService.updateNonce(session.tradeAccountId, newNonce)
        console.log(`[OrderService] Nonce persisted successfully: ${newNonce}`)
        noncePersisted = true
        break
      } catch (e) {
        console.warn(`[OrderService] Nonce persist attempt ${i}/3 failed:`, e)
        if (i < 3) await new Promise(r => setTimeout(r, 100 * i)) // Exponential backoff
      }
    }

    // If nonce persistence failed, attempt recovery from chain
    if (!noncePersisted) {
      console.error('[OrderService] [CRITICAL] Nonce persistence failed. Attempting recovery from chain...')
      try {
        // Fetch latest nonce from API by getting a fresh TradeAccountManager
        const freshManager = await sessionManagerService.getTradeAccountManager(normalizedAddress, true)
        const chainNonce = parseInt(freshManager.nonce.toString())

        // Update database with chain nonce
        await tradingAccountService.updateNonce(session.tradeAccountId, chainNonce)

        // Clear cached manager to force refresh on next order
        sessionManagerService.clearManager(normalizedAddress, session.id)

        console.log(`[OrderService] Nonce recovered from chain: ${chainNonce}`)
      } catch (recoveryError) {
        // Recovery failed - notify user but don't throw since order was placed
        console.error('[OrderService] [CRITICAL] Nonce recovery failed:', recoveryError)
        // Note: We don't throw here because the order was already placed successfully.
        // The user may need to refresh the page to resync, but the order is valid.
      }
    }

    // Clear balance cache after order placement to ensure fresh data on next cycle
    // This prevents stale balance calculations for subsequent orders
    balanceService.clearCache()

    // Store order in database
    if (response.orders && response.orders.length > 0) {
      const order = response.orders[0]
      await db.orders.put(order)
      return order
    }

    throw new Error('No order returned from API')
  }

  async cancelOrder(orderId: string, marketId: string, ownerAddress: string): Promise<void> {
    try {
      return await this._cancelOrderInternal(orderId, marketId, ownerAddress)
    } catch (error: any) {
      // On 400 error (nonce desync / session conflict), retry once with fresh state
      if (error?.response?.status === 400) {
        const errorCode = error?.response?.data?.error_code || error?.response?.data?.code
        console.warn(`[OrderService] Cancel 400 error (code: ${errorCode}), attempting recovery and retry...`)

        const normalizedAddress = ownerAddress.toLowerCase()
        sessionService.clearValidationCache()
        const session = await sessionService.getActiveSession(normalizedAddress, true)
        if (session) {
          sessionManagerService.clearManager(normalizedAddress, session.id)
        }

        try {
          return await this._cancelOrderInternal(orderId, marketId, ownerAddress)
        } catch (retryError: any) {
          console.error('[OrderService] Cancel retry after 400 also failed:', retryError?.message)
          throw retryError
        }
      }
      throw error
    }
  }

  private async _cancelOrderInternal(orderId: string, marketId: string, ownerAddress: string): Promise<void> {
    // Normalize address
    const normalizedAddress = ownerAddress.toLowerCase()

    // Skip on-chain validation during trading (matching fuel-o2)
    const session = await sessionService.getActiveSession(normalizedAddress, true)
    if (!session) {
      throw new Error('No active session found')
    }

    // Get market to verify contract ID
    const market = await db.markets.get(marketId)
    if (!market) {
      throw new Error('Market not found')
    }

    // Get TradeAccountManager - fetch latest nonce from API before canceling order (matching O2 frontend)
    const tradeAccountManager = await sessionManagerService.getTradeAccountManager(normalizedAddress, true)

    // Create cancel order action
    const cancelAction: CancelOrderAction = {
      CancelOrder: {
        order_id: orderId as `0x${string}`,
      },
    }

    // Create OrderBook contract instance
    const orderBook = new OrderBook(market.contract_id, tradeAccountManager.account)

    // Encode actions
    const encodedActions = await encodeActions(
      tradeAccountManager.identity,
      orderBook,
      {
        baseAssetId: market.base.asset as any,
        quoteAssetId: market.quote.asset as any,
        baseDecimals: market.base.decimals,
        quoteDecimals: market.quote.decimals,
      },
      [cancelAction],
      tradeAccountManager.defaultGasLimit
    )

    // Get session call params with signature
    const payload = await tradeAccountManager.api_SessionCallContractsParams(encodedActions.invokeScopes)

    // Submit transaction
    await o2ApiService.sessionSubmitTransaction(
      {
        actions: [
          {
            market_id: marketId,
            actions: encodedActions.actions,
          },
        ],
        signature: payload.signature as any,
        nonce: payload.nonce,
        trade_account_id: payload.trade_account_id,
        session_id: payload.session_id as any,
        variable_outputs: payload.variable_outputs,
        min_gas_limit: payload.min_gas_limit,
      },
      normalizedAddress
    )

    // Increment nonce
    tradeAccountManager.incrementNonce()

    // Persist nonce to database with retry logic (same as placeOrder)
    const newNonce = parseInt(tradeAccountManager.nonce.toString())
    let noncePersisted = false

    for (let i = 1; i <= 3; i++) {
      try {
        await tradingAccountService.updateNonce(session.tradeAccountId, newNonce)
        console.log(`[OrderService] Cancel nonce persisted successfully: ${newNonce}`)
        noncePersisted = true
        break
      } catch (e) {
        console.warn(`[OrderService] Cancel nonce persist attempt ${i}/3 failed:`, e)
        if (i < 3) await new Promise(r => setTimeout(r, 100 * i))
      }
    }

    // If nonce persistence failed, attempt recovery from chain
    if (!noncePersisted) {
      console.error('[OrderService] [CRITICAL] Cancel nonce persistence failed. Attempting recovery...')
      try {
        const freshManager = await sessionManagerService.getTradeAccountManager(normalizedAddress, true)
        const chainNonce = parseInt(freshManager.nonce.toString())
        await tradingAccountService.updateNonce(session.tradeAccountId, chainNonce)
        sessionManagerService.clearManager(normalizedAddress, session.id)
        console.log(`[OrderService] Cancel nonce recovered from chain: ${chainNonce}`)
      } catch (recoveryError) {
        console.error('[OrderService] [CRITICAL] Cancel nonce recovery failed:', recoveryError)
      }
    }

    // Update order status in database
    await db.orders.update(orderId, { status: OrderStatus.Cancelled })

    // Dispatch event for trading engine to refresh context (updates yellow pending order strip)
    window.dispatchEvent(new CustomEvent('order-cancelled', {
      detail: { orderId, marketId }
    }))
  }

  async getOpenOrders(marketId: string, ownerAddress: string): Promise<Order[]> {
    const normalizedAddress = ownerAddress.toLowerCase()
    const session = await sessionService.getActiveSession(normalizedAddress, true)
    if (!session) {
      return []
    }

    // Prefer WS-backed open-order state. The tracker is updated by every
    // `subscribe_orders` push, so this is real-time and free. Falls through
    // to the REST pagination below if WS hasn't been subscribed yet.
    const wsOpen = wsOrdersTracker.getOpenOrders(session.tradeAccountId, marketId)
    if (wsOpen.length > 0) return wsOpen

    // Paginate through all open orders (API returns max 200 per request)
    const allOrders: Order[] = []
    let startTimestamp: string | undefined
    let startOrderId: string | undefined
    const PAGE_SIZE = 200
    const MAX_PAGES = 20 // Safety: prevent infinite loops (20 * 200 = 4000 orders max)

    for (let page = 0; page < MAX_PAGES; page++) {
      const orders = await o2ApiService.getOrders(
        {
          market_id: marketId,
          contract: session.tradeAccountId,
          is_open: true,
          direction: 'desc',
          count: PAGE_SIZE,
          start_timestamp: startTimestamp,
          start_order_id: startOrderId,
        },
        normalizedAddress
      )

      allOrders.push(...orders)

      // If we got fewer than PAGE_SIZE, we've reached the end
      if (orders.length < PAGE_SIZE) break

      // Set cursor for next page using raw API timestamp to preserve precision
      const lastOrder = orders[orders.length - 1]
      const newCursorId = lastOrder.order_id

      // Guard against stuck cursor (same order_id means API returned same page)
      if (newCursorId === startOrderId) {
        console.warn('[OrderService] Pagination cursor not advancing, breaking to prevent infinite loop')
        break
      }

      startTimestamp = lastOrder._raw_timestamp || String(lastOrder.created_at)
      startOrderId = newCursorId
    }

    // Update database
    for (const order of allOrders) {
      await db.orders.put(order)
    }

    return allOrders
  }

  async getAllOpenOrders(ownerAddress: string): Promise<Order[]> {
    const normalizedAddress = ownerAddress.toLowerCase()
    const session = await sessionService.getActiveSession(normalizedAddress, true)
    if (!session) {
      return []
    }

    // Get all markets
    const markets = await marketService.fetchMarkets()

    // Fetch orders for each market using the paginated getOpenOrders method
    const allOrders: Order[] = []
    for (const market of markets) {
      try {
        const orders = await this.getOpenOrders(market.market_id, normalizedAddress)
        allOrders.push(...orders)
      } catch (error) {
        console.error(`Failed to fetch orders for market ${market.market_id}:`, error)
      }
    }

    return allOrders
  }

  async getOrder(orderId: string, marketId: string, ownerAddress: string): Promise<Order | null> {
    const normalizedAddress = ownerAddress.toLowerCase()
    try {
      const order = await o2ApiService.getOrder(orderId, marketId, normalizedAddress)
      await db.orders.put(order)
      return order
    } catch (error) {
      console.error(`[OrderService] Failed to fetch order ${orderId} for market ${marketId}:`, error)
      return (await db.orders.get(orderId)) || null
    }
  }

  async cancelAllOpenOrders(ownerAddress: string): Promise<{ cancelled: number; failed: number }> {
    const normalizedAddress = ownerAddress.toLowerCase()

    // Get all open orders across all markets
    const openOrders = await this.getAllOpenOrders(normalizedAddress)

    let cancelled = 0
    let failed = 0

    // Cancel each order sequentially (each requires blockchain transaction)
    for (const order of openOrders) {
      try {
        await this.cancelOrder(order.order_id, order.market_id, normalizedAddress)
        cancelled++
        console.log(`[OrderService] Cancelled order ${order.order_id}`)
      } catch (error) {
        console.error(`[OrderService] Failed to cancel order ${order.order_id}:`, error)
        failed++
      }
    }

    console.log(`[OrderService] Cancel all orders complete: ${cancelled} cancelled, ${failed} failed`)
    return { cancelled, failed }
  }

  async cancelOrdersForMarket(marketId: string, ownerAddress: string): Promise<{ cancelled: number; failed: number }> {
    const normalizedAddress = ownerAddress.toLowerCase()

    // Get open orders for this specific market
    const openOrders = await this.getOpenOrders(marketId, normalizedAddress)

    let cancelled = 0
    let failed = 0

    // Cancel each order sequentially (each requires blockchain transaction)
    for (const order of openOrders) {
      try {
        await this.cancelOrder(order.order_id, order.market_id, normalizedAddress)
        cancelled++
        console.log(`[OrderService] Cancelled order ${order.order_id} for market ${marketId}`)
      } catch (error) {
        console.error(`[OrderService] Failed to cancel order ${order.order_id}:`, error)
        failed++
      }
    }

    console.log(`[OrderService] Cancel orders for market ${marketId} complete: ${cancelled} cancelled, ${failed} failed`)
    return { cancelled, failed }
  }
}

export const orderService = new OrderService()

