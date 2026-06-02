/**
 * WS-backed orderbook depth per (marketId, precision). Replaces
 * per-cycle REST polling of `/depth`.
 *
 * The backend's `subscribe_depth` topic sends:
 *   - an initial snapshot (`action: 'subscribe_depth'`)
 *   - incremental signed deltas (`action: 'subscribe_depth_update'`):
 *     a negative quantity means "decrement existing depth at this price"
 *     rather than "remove the level"; running total ≤ 0 deletes the level.
 *
 * Consumers read synchronously via `getDepth(marketId)`.
 */
import { o2WebSocket } from './o2WebSocket'
import { OrderBookDepth } from '../types/market'

const DEFAULT_PRECISION = 100

interface WsDepthMsg {
  action?: string
  market_id?: string
  buys?: Array<{ price: string; quantity: string }>
  sells?: Array<{ price: string; quantity: string }>
}

interface Subscription {
  marketId: string
  precision: number
  unsub: () => void
  unsubState: () => void
  bids: Map<bigint, bigint>
  asks: Map<bigint, bigint>
  timestamp: number
  waiters: Set<() => void>
}

class WsDepthTracker {
  /** Key: marketIdLower:precision */
  private subs = new Map<string, Subscription>()

  /**
   * Open (or re-use) a depth subscription for this market. Returns a
   * disposer for the caller.
   */
  subscribe(marketId: string, precision: number = DEFAULT_PRECISION): () => void {
    const key = this.makeKey(marketId, precision)
    const existing = this.subs.get(key)
    if (existing) return () => this.release(key)

    const bids = new Map<bigint, bigint>()
    const asks = new Map<bigint, bigint>()
    const waiters = new Set<() => void>()

    const subscribePayload = {
      action: 'subscribe_depth',
      topic: 'depth',
      market_id: marketId,
      precision: String(precision),
    }
    const unsubscribePayload = {
      action: 'unsubscribe_depth',
      topic: 'depth',
      market_id: marketId,
    }
    const matches = (msg: { action?: string; market_id?: string }) => {
      if (msg.market_id !== marketId) return false
      return msg.action === 'subscribe_depth' || msg.action === 'subscribe_depth_update'
    }

    const handler = (raw: { [k: string]: unknown }) => {
      const msg = raw as WsDepthMsg
      const isSnapshot = msg.action === 'subscribe_depth'
      if (isSnapshot) {
        bids.clear()
        asks.clear()
        for (const l of msg.buys ?? []) this.setLevel(bids, l.price, l.quantity)
        for (const l of msg.sells ?? []) this.setLevel(asks, l.price, l.quantity)
      } else {
        for (const l of msg.buys ?? []) this.applyDelta(bids, l.price, l.quantity)
        for (const l of msg.sells ?? []) this.applyDelta(asks, l.price, l.quantity)
      }
      const sub = this.subs.get(key)
      if (sub) {
        sub.timestamp = Date.now()
        for (const w of sub.waiters) { try { w() } catch { /* ignore */ } }
        sub.waiters.clear()
      }
    }

    const unsub = o2WebSocket.subscribe(
      `depth:${marketId.toLowerCase()}:${precision}`,
      subscribePayload,
      unsubscribePayload,
      matches,
      handler,
    )

    // On disconnect, invalidate the timestamp so `getDepth` falls back to
    // REST until the server's resubscribe-snapshot lands.
    const unsubState = o2WebSocket.onState((state) => {
      if (state !== 'close') return
      const cur = this.subs.get(key)
      if (cur) cur.timestamp = 0
    })

    this.subs.set(key, {
      marketId,
      precision,
      unsub,
      unsubState,
      bids,
      asks,
      timestamp: 0,
      waiters,
    })
    return () => this.release(key)
  }

  /** Snapshot of the current orderbook in the shape consumers expect. */
  getDepth(marketId: string, precision: number = DEFAULT_PRECISION): OrderBookDepth | null {
    const sub = this.subs.get(this.makeKey(marketId, precision))
    if (!sub || sub.timestamp === 0) return null
    return {
      bids: this.sortedSide(sub.bids, /* desc */ true),
      asks: this.sortedSide(sub.asks, /* asc */ false),
      timestamp: sub.timestamp,
    }
  }

  /** Resolves on the next push for this market, or after `timeoutMs`. */
  awaitNextUpdate(marketId: string, precision: number, timeoutMs: number): Promise<boolean> {
    const sub = this.subs.get(this.makeKey(marketId, precision))
    if (!sub) return Promise.resolve(false)
    return new Promise((resolve) => {
      let done = false
      const onPush = () => {
        if (done) return
        done = true
        resolve(true)
      }
      sub.waiters.add(onPush)
      setTimeout(() => {
        if (done) return
        done = true
        sub.waiters.delete(onPush)
        resolve(false)
      }, timeoutMs)
    })
  }

  // ─── internals ──────────────────────────────────────────────

  private makeKey(marketId: string, precision: number): string {
    return `${marketId.toLowerCase()}:${precision}`
  }

  private parseBig(s: string): bigint {
    try { return BigInt(s) } catch { return 0n }
  }

  private parseSigned(s: string): bigint {
    if (!s) return 0n
    try { return BigInt(s) } catch { return 0n }
  }

  private setLevel(target: Map<bigint, bigint>, price: string, qty: string): void {
    const p = this.parseBig(price)
    const q = this.parseBig(qty)
    if (q === 0n) target.delete(p)
    else target.set(p, q)
  }

  private applyDelta(target: Map<bigint, bigint>, price: string, qty: string): void {
    const p = this.parseBig(price)
    const delta = this.parseSigned(qty)
    const cur = target.get(p) ?? 0n
    const next = cur + delta
    if (next <= 0n) target.delete(p)
    else target.set(p, next)
  }

  private sortedSide(m: Map<bigint, bigint>, desc: boolean): Array<[string, string]> {
    const arr = Array.from(m.entries())
    arr.sort(([a], [b]) => (desc ? (b > a ? 1 : b < a ? -1 : 0) : (a > b ? 1 : a < b ? -1 : 0)))
    return arr.map(([p, q]) => [p.toString(), q.toString()])
  }

  private release(key: string): void {
    const sub = this.subs.get(key)
    if (!sub) return
    sub.unsub()
    sub.unsubState()
    this.subs.delete(key)
  }
}

export const wsDepthTracker = new WsDepthTracker()
