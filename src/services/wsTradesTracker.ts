/**
 * WS-backed last-trade / last-price feed per market. Replaces per-cycle
 * REST polling of `/markets/ticker` (the strategy executor only needs
 * `last_price` from the ticker for stop-loss + display).
 */
import { o2WebSocket } from './o2WebSocket'
import { o2ApiService } from './o2ApiService'

interface WsTradeRaw {
  trade_id?: string
  side?: string
  total?: string
  quantity?: string
  price?: string
  timestamp?: string
}

interface WsTradesMsg {
  action?: string
  market_id?: string
  trades?: WsTradeRaw[]
}

interface Subscription {
  marketId: string
  unsub: () => void
  unsubState: () => void
  /** Most recent fill price (raw quote units, decimal string). */
  lastPrice: string | null
  /** Timestamp of most recent push (ms). */
  updatedAt: number
}

class WsTradesTracker {
  /** Key: marketIdLower */
  private subs = new Map<string, Subscription>()

  subscribe(marketId: string): () => void {
    const key = marketId.toLowerCase()
    const existing = this.subs.get(key)
    if (existing) return () => this.release(key)

    const subscribePayload = {
      action: 'subscribe_trades',
      topic: 'trades',
      market_id: marketId,
    }
    const unsubscribePayload = {
      action: 'unsubscribe_trades',
      topic: 'trades',
      market_id: marketId,
    }
    const matches = (msg: { action?: string; market_id?: string }) =>
      msg.action === 'subscribe_trades' && msg.market_id === marketId

    const handler = (raw: { [k: string]: unknown }) => {
      const msg = raw as WsTradesMsg
      const trades = msg.trades ?? []
      if (trades.length === 0) return
      // Take the newest trade in the batch.
      const newest = trades[trades.length - 1]
      if (!newest?.price) return
      const sub = this.subs.get(key)
      if (sub) {
        sub.lastPrice = newest.price
        sub.updatedAt = Date.now()
      }
    }

    const unsub = o2WebSocket.subscribe(
      `trades:${key}`,
      subscribePayload,
      unsubscribePayload,
      matches,
      handler,
    )

    // Reset on disconnect so consumers fall back to REST until WS
    // reconnects + re-seeds; on reopen, re-seed via REST so callers
    // see the correct last-traded price within one tick.
    const unsubState = o2WebSocket.onState((state) => {
      const cur = this.subs.get(key)
      if (!cur) return
      if (state === 'close') {
        cur.lastPrice = null
      } else if (state === 'open') {
        void this.seedFromRest(key)
      }
    })

    this.subs.set(key, { marketId, unsub, unsubState, lastPrice: null, updatedAt: 0 })

    // Seed the last price via one REST ticker fetch so that markets
    // without recent trade activity still have a price before the first
    // organic trade pushes through. Without this, consumers would
    // repeatedly fall back to REST every cycle.
    void this.seedFromRest(key)

    return () => this.release(key)
  }

  /** Fetch one REST ticker to populate `lastPrice`. Safe to re-call. */
  private async seedFromRest(key: string): Promise<void> {
    const sub = this.subs.get(key)
    if (!sub) return
    try {
      const ticker = await o2ApiService.getTicker(sub.marketId)
      const after = this.subs.get(key)
      if (!after || after.lastPrice !== null) return // WS push beat us
      if (ticker?.last_price) {
        after.lastPrice = ticker.last_price
        after.updatedAt = Date.now()
      }
    } catch (err) {
      console.warn('[wsTradesTracker] bootstrap getTicker failed', sub.marketId, err)
    }
  }

  /** Most recent fill price (raw quote units). null if none seen yet. */
  getLastPrice(marketId: string): string | null {
    return this.subs.get(marketId.toLowerCase())?.lastPrice ?? null
  }

  private release(key: string): void {
    const sub = this.subs.get(key)
    if (!sub) return
    sub.unsub()
    sub.unsubState()
    this.subs.delete(key)
  }
}

export const wsTradesTracker = new WsTradesTracker()
