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

class OrderService {
  async placeOrder(
    market: Market,
    side: OrderSide,
    orderType: OrderType,
    price: string,
    quantity: string,
    ownerAddress: string
  ): Promise<Order> {
    // Normalize address
    const normalizedAddress = ownerAddress.toLowerCase()
    
    // Get active session
    const session = await sessionService.getActiveSession(normalizedAddress)
    if (!session) {
      throw new Error('No active session found. Please create a session first.')
    }

    // Verify market is in session's allowed contracts
    if (!session.contractIds.includes(market.contract_id)) {
      throw new Error(`Market ${market.market_id} is not in session's allowed contracts`)
    }

    // Get TradeAccountManager - fetch latest nonce from API before placing order (matching O2 frontend)
    const tradeAccountManager = await sessionManagerService.getTradeAccountManager(normalizedAddress, true)

    // Create order action
    const orderAction: CreateOrderAction = {
      CreateOrder: {
        side,
        order_type: orderType,
        price,
        quantity,
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
    const persistNonce = async (retries = 2) => {
      const session = await sessionService.getActiveSession(normalizedAddress)
      if (!session) return

      for (let i = 1; i <= retries; i++) {
        try {
          await tradingAccountService.updateNonce(
            session.tradeAccountId,
            parseInt(tradeAccountManager.nonce.toString())
          )
          return
        } catch (e) {
          console.warn(`[OrderService] Nonce persist attempt ${i}/${retries} failed`)
          if (i < retries) await new Promise(r => setTimeout(r, 100))
        }
      }
    }
    // Fire and forget - don't block order placement
    persistNonce().catch(() => {})

    // Store order in database
    if (response.orders && response.orders.length > 0) {
      const order = response.orders[0]
      await db.orders.put(order)
      return order
    }

    throw new Error('No order returned from API')
  }

  async cancelOrder(orderId: string, marketId: string, ownerAddress: string): Promise<void> {
    // Normalize address
    const normalizedAddress = ownerAddress.toLowerCase()
    
    const session = await sessionService.getActiveSession(normalizedAddress)
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

    // Update order status in database
    await db.orders.update(orderId, { status: OrderStatus.Cancelled })
  }

  async getOpenOrders(marketId: string, ownerAddress: string): Promise<Order[]> {
    const normalizedAddress = ownerAddress.toLowerCase()
    const session = await sessionService.getActiveSession(normalizedAddress)
    if (!session) {
      return []
    }

    // Use market_id with required contract, direction and count parameters
    const orders = await o2ApiService.getOrders(
      {
        market_id: marketId,
        contract: session.tradeAccountId,  // Required by API (trading account ID)
        is_open: true,
        direction: 'desc',  // Required by API
        count: 200,         // Required by API (reasonable default)
      },
      normalizedAddress
    )

    // Update database
    for (const order of orders) {
      await db.orders.put(order)
    }

    return orders
  }

  async getAllOpenOrders(ownerAddress: string): Promise<Order[]> {
    const normalizedAddress = ownerAddress.toLowerCase()
    const session = await sessionService.getActiveSession(normalizedAddress)
    if (!session) {
      return []
    }

    // Get all markets
    const markets = await marketService.fetchMarkets()
    
    // Fetch orders for each market separately (API requires market_id when is_open=true)
    const allOrders: Order[] = []
    for (const market of markets) {
      try {
        const orders = await o2ApiService.getOrders(
          {
            market_id: market.market_id,
            contract: session.tradeAccountId,  // Required by API (trading account ID)
            is_open: true,
            direction: 'desc',  // Required by API
            count: 200,         // Required by API
          },
          normalizedAddress
        )
        allOrders.push(...orders)
      } catch (error) {
        console.error(`Failed to fetch orders for market ${market.market_id}:`, error)
      }
    }

    // Update database
    for (const order of allOrders) {
      await db.orders.put(order)
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
}

export const orderService = new OrderService()

