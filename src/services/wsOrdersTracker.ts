/**
 * WS-backed open-orders state for the user's trade account. Replaces:
 *   - per-cycle REST polling of `/orders?is_open=true&...` (open order count)
 *   - the 1-second polling loop in `orderFulfillmentPolling` (fill detection)
 *
 * The `subscribe_orders` topic accepts an `identities` filter. We pass our
 * trade account as `{ContractId: ...}` and receive a stream of order
 * lifecycle updates (created / partially_filled / close / cancel). Each
 * update is dispatched to:
 *   1. The cache (open-orders map by market) — for `getOpenOrders(marketId)`
 *   2. Registered fill-listeners — for the polling loop's drop-in replacement
 *
 * Bootstrap + recovery: on subscribe (and again after every reconnect) we
 * fetch the current open orders via REST, populating the cache before
 * marking the subscription `ready`. This way callers can rely on
 * `isReady(...)` being authoritative — `getOpenOrders` returning `[]`
 * for a ready subscription means "you genuinely have zero open orders"
 * and there's no need to fall back to REST.
 */
import { o2WebSocket } from './o2WebSocket'
import { o2ApiService } from './o2ApiService'
import { Order, OrderSide, OrderType, OrderStatus } from '../types/order'

interface WsOrderRaw {
  order_id?: string
  owner?: { Address?: string; ContractId?: string }
  side?: string
  order_type?: string
  market_id?: string
  quantity?: string
  quantity_fill?: string
  price?: string
  price_fill?: string
  close?: boolean
  partially_filled?: boolean
  cancel?: boolean
  timestamp?: string | number
}

interface WsOrdersMsg {
  action?: string
  orders?: WsOrderRaw[]
}

interface FillEvent {
  order: Order
  // The previous state before this update — useful for callers that need to
  // detect "newly closed" or "newly filled" transitions.
  previousStatus?: OrderStatus
}

type FillListener = (event: FillEvent) => void

interface Subscription {
  ownerAddress: string
  tradeAccountId: string
  unsub: () => void
  unsubState: () => void
  /** All known orders for the trade account, keyed by order_id. */
  orders: Map<string, Order>
  /** Listeners for any order update (created / filled / cancelled). */
  listeners: Set<FillListener>
  /** True once REST bootstrap has populated `orders` (or once we've
   *  received any WS frame, whichever first). Reset on disconnect. */
  ready: boolean
}

class WsOrdersTracker {
  /** Key: tradeAccountIdLower */
  private subs = new Map<string, Subscription>()

  /** Open or re-use a subscription. Returns a disposer. */
  subscribe(ownerAddress: string, tradeAccountId: string): () => void {
    const key = tradeAccountId.toLowerCase()
    const existing = this.subs.get(key)
    if (existing) return () => this.release(key)

    const orders = new Map<string, Order>()
    const listeners = new Set<FillListener>()

    const subscribePayload = {
      action: 'subscribe_orders',
      topic: 'orders',
      identities: [{ ContractId: tradeAccountId }],
    }
    const unsubscribePayload = {
      action: 'unsubscribe_orders',
      topic: 'orders',
      identities: [{ ContractId: tradeAccountId }],
    }
    const matches = (msg: { action?: string }) => msg.action === 'subscribe_orders'

    const handler = (raw: { [k: string]: unknown }) => {
      const msg = raw as WsOrdersMsg
      // Any received frame proves the subscription is alive — flip ready
      // here as a backstop in case REST bootstrap is slow or fails.
      const sub = this.subs.get(key)
      if (sub) sub.ready = true
      for (const o of msg.orders ?? []) {
        if (!o.order_id) continue
        const ownerCid = o.owner?.ContractId?.toLowerCase()
        if (ownerCid !== tradeAccountId.toLowerCase()) continue
        const previousStatus = orders.get(o.order_id)?.status
        const order = this.normalize(o)
        if (!order) continue
        orders.set(o.order_id, order)
        for (const cb of listeners) {
          try { cb({ order, ...(previousStatus !== undefined ? { previousStatus } : {}) }) }
          catch (err) { console.error('[wsOrdersTracker] listener threw', err) }
        }
      }
    }

    const unsub = o2WebSocket.subscribe(
      `orders:${key}`,
      subscribePayload,
      unsubscribePayload,
      matches,
      handler,
    )

    // Reset on disconnect and re-bootstrap on reopen so we never serve
    // stale order state to callers that trust `isReady`.
    const unsubState = o2WebSocket.onState((state) => {
      const sub = this.subs.get(key)
      if (!sub) return
      if (state === 'close') {
        sub.ready = false
      } else if (state === 'open') {
        void this.bootstrapFromRest(key)
      }
    })

    this.subs.set(key, {
      ownerAddress: ownerAddress.toLowerCase(),
      tradeAccountId,
      unsub,
      unsubState,
      orders,
      listeners,
      ready: false,
    })

    // Fire-and-forget initial REST bootstrap. Failures here keep ready=false
    // so callers correctly fall back to REST per-cycle until WS frames
    // start arriving.
    void this.bootstrapFromRest(key)

    return () => this.release(key)
  }

  /** Populate the orders map from the REST `/orders?is_open=true` list.
   *  Marks the subscription ready when done. Safe to call repeatedly. */
  private async bootstrapFromRest(key: string): Promise<void> {
    const sub = this.subs.get(key)
    if (!sub) return
    try {
      const allOrders: Order[] = []
      let startTimestamp: string | undefined
      let startOrderId: string | undefined
      const PAGE_SIZE = 200
      const MAX_PAGES = 20
      for (let page = 0; page < MAX_PAGES; page++) {
        const orders = await o2ApiService.getOrders(
          {
            contract: sub.tradeAccountId,
            is_open: true,
            direction: 'desc',
            count: PAGE_SIZE,
            start_timestamp: startTimestamp,
            start_order_id: startOrderId,
          },
          sub.ownerAddress,
        )
        allOrders.push(...orders)
        if (orders.length < PAGE_SIZE) break
        const last = orders[orders.length - 1]
        if (!last) break
        startTimestamp = String(last.created_at)
        startOrderId = last.order_id
      }
      // Re-fetch in case the subscription was disposed mid-bootstrap.
      const after = this.subs.get(key)
      if (!after) return
      // Replace open orders with REST snapshot; preserve any closed
      // orders we may have observed from WS frames (used by
      // `getOrder(orderId)` for post-fill lookups).
      for (const [id, o] of after.orders) {
        if (o.status === OrderStatus.Open || o.status === OrderStatus.PartiallyFilled) {
          after.orders.delete(id)
        }
      }
      for (const order of allOrders) {
        after.orders.set(order.order_id, order)
      }
      after.ready = true
    } catch (err) {
      console.warn('[wsOrdersTracker] REST bootstrap failed', err)
      // Leave ready=false so callers fall back to REST per-cycle.
    }
  }

  /** True once the WS subscription has received at least one frame. */
  isReady(tradeAccountId: string): boolean {
    return this.subs.get(tradeAccountId.toLowerCase())?.ready === true
  }

  /** Any tracked order (open, filled, or cancelled) by ID, or undefined. */
  getOrder(tradeAccountId: string, orderId: string): Order | undefined {
    return this.subs.get(tradeAccountId.toLowerCase())?.orders.get(orderId)
  }

  /** Open orders for a market. Returns [] if no subscription / no data yet. */
  getOpenOrders(tradeAccountId: string, marketId?: string): Order[] {
    const sub = this.subs.get(tradeAccountId.toLowerCase())
    if (!sub) return []
    const out: Order[] = []
    for (const o of sub.orders.values()) {
      if (o.status !== OrderStatus.Open && o.status !== OrderStatus.PartiallyFilled) continue
      if (marketId && o.market_id !== marketId) continue
      out.push(o)
    }
    return out
  }

  /** Subscribe to any order update for this trade account. */
  addListener(tradeAccountId: string, cb: FillListener): () => void {
    const sub = this.subs.get(tradeAccountId.toLowerCase())
    if (!sub) {
      console.warn('[wsOrdersTracker] addListener on unsubscribed account')
      return () => {}
    }
    sub.listeners.add(cb)
    return () => { sub.listeners.delete(cb) }
  }

  // ─── internals ──────────────────────────────────────────────

  private normalize(o: WsOrderRaw): Order | null {
    if (!o.order_id || !o.market_id) return null
    let status: OrderStatus = OrderStatus.Open
    if (o.cancel) status = OrderStatus.Cancelled
    else if (o.close) status = OrderStatus.Filled
    else if (o.partially_filled) status = OrderStatus.PartiallyFilled
    const ts = typeof o.timestamp === 'string' ? Number(o.timestamp) : (o.timestamp ?? Date.now())
    const filled = o.quantity_fill ?? '0'
    const total = o.quantity ?? '0'
    let remaining = '0'
    try { remaining = (BigInt(total) - BigInt(filled)).toString() } catch { /* keep 0 */ }
    return {
      order_id: o.order_id,
      market_id: o.market_id,
      side: (o.side === 'sell' || o.side === 'Sell') ? OrderSide.Sell : OrderSide.Buy,
      order_type: (o.order_type as OrderType) ?? OrderType.Market,
      price: o.price ?? '0',
      ...(o.price_fill !== undefined ? { price_fill: o.price_fill } : {}),
      quantity: total,
      filled_quantity: filled,
      remaining_quantity: remaining,
      status,
      created_at: ts,
      updated_at: Date.now(),
    }
  }

  private release(key: string): void {
    const sub = this.subs.get(key)
    if (!sub) return
    sub.unsub()
    sub.unsubState()
    this.subs.delete(key)
  }
}

export const wsOrdersTracker = new WsOrdersTracker()
