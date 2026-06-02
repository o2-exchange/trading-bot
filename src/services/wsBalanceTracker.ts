/**
 * WS-backed balance state for one (ownerAddress, tradeAccountId, assetId)
 * tuple. Replaces per-cycle REST polling of `/balance`.
 *
 * Design:
 *  - At first subscribe, fetch a REST snapshot so we have data before the
 *    first WS push arrives.
 *  - Open a `subscribe_balances` subscription with the trade-account
 *    `{ContractId}` as the identity filter.
 *  - Each `subscribe_balances` frame contains a balance array — we
 *    replace per-asset state on every push.
 *  - Consumers read synchronously via `getBalance(assetId)`. Optional
 *    `awaitChange(...)` returns a Promise resolved on the next push (used
 *    by post-fill flows that previously polled REST every 400ms).
 */
import { o2WebSocket } from './o2WebSocket'
import { o2ApiService } from './o2ApiService'
import { BalanceApiResponse } from '../types/tradingAccount'

interface OrderBookEntry { locked: string; unlocked: string }
export interface BalanceSnapshot extends BalanceApiResponse {
  /** Local timestamp when the snapshot was applied. */
  updatedAt: number
}

interface WsBalanceMsg {
  action?: string
  balance?: Array<{
    identity?: { Address?: string; ContractId?: string }
    asset_id?: string
    total_locked?: string
    total_unlocked?: string
    trading_account_balance?: string
    order_books?: Record<string, OrderBookEntry>
  }>
  seen_timestamp?: number
}

interface Subscription {
  ownerAddress: string
  tradeAccountId: string
  unsub: () => void
  unsubState: () => void
  bootstrapAssetIds: string[]
  /** Per-asset state, keyed by lowercased asset_id. */
  state: Map<string, BalanceSnapshot>
  /** Waiters for the next push. */
  waiters: Set<() => void>
}

class WsBalanceTracker {
  /** Key: ownerAddressLower:tradeAccountId */
  private subs = new Map<string, Subscription>()

  /**
   * Open (or re-use) a WS subscription for this trade account. Returns a
   * disposer the caller should invoke on teardown.
   */
  async ensureSubscribed(
    ownerAddress: string,
    tradeAccountId: string,
    bootstrapAssetIds: string[] = [],
  ): Promise<() => void> {
    const key = this.makeKey(ownerAddress, tradeAccountId)
    const existing = this.subs.get(key)
    if (existing) return () => this.releaseSubscription(key)

    const normalizedOwner = ownerAddress.toLowerCase()
    const state = new Map<string, BalanceSnapshot>()
    const waiters = new Set<() => void>()

    // Seed via REST so reads work before the first WS push.
    await Promise.all(
      bootstrapAssetIds.map(async (assetId) => {
        try {
          const resp = await o2ApiService.getBalance(assetId, tradeAccountId, normalizedOwner)
          state.set(assetId.toLowerCase(), { ...resp, updatedAt: Date.now() })
        } catch (err) {
          console.warn('[wsBalanceTracker] bootstrap getBalance failed', assetId, err)
        }
      }),
    )

    const subscribePayload = {
      action: 'subscribe_balances',
      topic: 'balances',
      identities: [{ ContractId: tradeAccountId }],
    }
    const unsubscribePayload = {
      action: 'unsubscribe_balances',
      topic: 'balances',
      identities: [{ ContractId: tradeAccountId }],
    }
    const matches = (msg: { action?: string }) => msg.action === 'subscribe_balances'

    const handler = (raw: { [k: string]: unknown }) => {
      const msg = raw as WsBalanceMsg
      const balance = msg.balance ?? []
      let changed = false
      for (const b of balance) {
        if (!b.asset_id) continue
        // Filter by identity (server can fan in multiple subs on one socket).
        const idMatches =
          b.identity?.ContractId?.toLowerCase() === tradeAccountId.toLowerCase()
        if (!idMatches) continue
        const next: BalanceSnapshot = {
          order_books: b.order_books ?? {},
          total_locked: b.total_locked ?? '0',
          total_unlocked: b.total_unlocked ?? '0',
          trading_account_balance: b.trading_account_balance ?? '0',
          updatedAt: msg.seen_timestamp ? msg.seen_timestamp * 1000 : Date.now(),
          ...(msg.seen_timestamp ? { event_timestamp: msg.seen_timestamp } : {}),
        }
        state.set(b.asset_id.toLowerCase(), next)
        changed = true
      }
      if (changed) {
        // Notify any waiters, then clear them.
        for (const w of waiters) { try { w() } catch { /* ignore */ } }
        waiters.clear()
      }
    }

    const unsub = o2WebSocket.subscribe(
      `balances:${tradeAccountId.toLowerCase()}`,
      subscribePayload,
      unsubscribePayload,
      matches,
      handler,
    )

    // Invalidate cached snapshots on disconnect so callers fall back to
    // REST until the WS reconnects and re-seeds. On reopen, REST-seed
    // again to recover from any push we missed during the outage.
    const unsubState = o2WebSocket.onState((s) => {
      const sub = this.subs.get(key)
      if (!sub) return
      if (s === 'close') {
        sub.state.clear()
      } else if (s === 'open') {
        void this.reseed(key)
      }
    })

    this.subs.set(key, {
      ownerAddress: normalizedOwner,
      tradeAccountId,
      unsub,
      unsubState,
      bootstrapAssetIds: [...bootstrapAssetIds],
      state,
      waiters,
    })
    return () => this.releaseSubscription(key)
  }

  /** Re-fetch the bootstrap REST snapshot for known assets after reconnect. */
  private async reseed(key: string): Promise<void> {
    const sub = this.subs.get(key)
    if (!sub) return
    await Promise.all(
      sub.bootstrapAssetIds.map(async (assetId) => {
        try {
          const resp = await o2ApiService.getBalance(assetId, sub.tradeAccountId, sub.ownerAddress)
          const after = this.subs.get(key)
          if (!after) return
          after.state.set(assetId.toLowerCase(), { ...resp, updatedAt: Date.now() })
        } catch (err) {
          console.warn('[wsBalanceTracker] reseed failed for', assetId, err)
        }
      }),
    )
  }

  /** Latest balance for an asset, or undefined if not yet seen. */
  getBalance(
    ownerAddress: string,
    tradeAccountId: string,
    assetId: string,
  ): BalanceSnapshot | undefined {
    const sub = this.subs.get(this.makeKey(ownerAddress, tradeAccountId))
    if (!sub) return undefined
    return sub.state.get(assetId.toLowerCase())
  }

  /**
   * Resolves on the next WS push for this trade account, or after
   * `timeoutMs` if no push arrives. Replaces the 400ms-poll-then-pray
   * pattern in `orderFulfillmentService.placeSellOrderAfterBuyFill`.
   */
  awaitNextUpdate(
    ownerAddress: string,
    tradeAccountId: string,
    timeoutMs: number,
  ): Promise<boolean> {
    const sub = this.subs.get(this.makeKey(ownerAddress, tradeAccountId))
    if (!sub) return Promise.resolve(false)
    return new Promise((resolve) => {
      let resolved = false
      const onPush = () => {
        if (resolved) return
        resolved = true
        resolve(true)
      }
      sub.waiters.add(onPush)
      setTimeout(() => {
        if (resolved) return
        resolved = true
        sub.waiters.delete(onPush)
        resolve(false)
      }, timeoutMs)
    })
  }

  /**
   * Wait until a specific asset's `total_unlocked` reaches at least
   * `minAmount` (raw units), polling the WS-backed cache as pushes
   * arrive. Returns true if the threshold was reached before `timeoutMs`.
   */
  async awaitBalanceAtLeast(
    ownerAddress: string,
    tradeAccountId: string,
    assetId: string,
    minAmount: bigint,
    timeoutMs: number,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    // Fast-path: already there.
    let cur = this.getBalance(ownerAddress, tradeAccountId, assetId)
    if (cur && this.parseBig(cur.total_unlocked) >= minAmount) return true
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now()
      const got = await this.awaitNextUpdate(ownerAddress, tradeAccountId, remaining)
      if (!got) return false
      cur = this.getBalance(ownerAddress, tradeAccountId, assetId)
      if (cur && this.parseBig(cur.total_unlocked) >= minAmount) return true
    }
    return false
  }

  // ─── internals ──────────────────────────────────────────────

  private parseBig(s: string | undefined | null): bigint {
    if (!s) return 0n
    try { return BigInt(s) } catch { return 0n }
  }

  private makeKey(owner: string, tradeAccount: string): string {
    return `${owner.toLowerCase()}:${tradeAccount.toLowerCase()}`
  }

  private releaseSubscription(key: string): void {
    const sub = this.subs.get(key)
    if (!sub) return
    sub.unsub()
    sub.unsubState()
    this.subs.delete(key)
  }
}

export const wsBalanceTracker = new WsBalanceTracker()
