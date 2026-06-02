/**
 * Shared WebSocket client for the o2 Exchange streaming API.
 *
 * One WS connection per browser session, multiplexed across subscriptions.
 * Reconnects automatically with exponential backoff; all active
 * subscriptions are re-issued on reconnect.
 *
 * Why a singleton: the backend treats subscriptions globally per
 * connection (e.g. `subscribe_balances` is "subscribed once for these
 * identities"). Multiple `subscribe_balances` calls on the same socket
 * return `AlreadySubscribed`. So we route all consumers through one
 * connection here and manage subscription lifecycle centrally.
 *
 * Lifecycle:
 *   - First `subscribe(...)` call opens the socket if not already open.
 *   - Each subscriber registers a `match` predicate; incoming messages
 *     are dispatched to all matching subscribers.
 *   - `unsubscribe(...)` removes the subscriber + sends the unsub frame
 *     if the socket is open.
 *   - If the socket closes (network / server), it reconnects with
 *     1s → 30s backoff. On reconnect every active subscription's
 *     subscribe payload is re-sent.
 */
import { O2_WEBSOCKET_URL } from '../constants/o2Constants'

type WsServerMessage = {
  action?: string
  market_id?: string
  [k: string]: unknown
}

type MatchFn = (msg: WsServerMessage) => boolean
type MessageHandler = (msg: WsServerMessage) => void

interface ActiveSubscription {
  key: string
  subscribePayload: Record<string, unknown>
  unsubscribePayload?: Record<string, unknown>
  matches: MatchFn
  handlers: Set<MessageHandler>
}

class O2WebSocket {
  private socket: WebSocket | null = null
  private subscriptions = new Map<string, ActiveSubscription>()
  private connectPromise: Promise<void> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private lastMessageAt = 0
  private currentReconnectMs = 1000
  private readonly maxReconnectMs = 30_000
  private readonly pingIntervalMs = 1000
  private readonly pongTimeoutMs = 5000
  private shouldRun = true
  private listeners = new Set<(state: 'open' | 'close' | 'error') => void>()

  /** Eager connect — safe to call multiple times. */
  async connect(): Promise<void> {
    this.shouldRun = true
    if (this.socket?.readyState === WebSocket.OPEN) return
    if (this.connectPromise) return this.connectPromise
    return this.openSocket()
  }

  /** Subscribe to a topic. Returns an `unsubscribe` callback. */
  subscribe(
    key: string,
    subscribePayload: Record<string, unknown>,
    unsubscribePayload: Record<string, unknown> | undefined,
    matches: MatchFn,
    handler: MessageHandler,
  ): () => void {
    let entry = this.subscriptions.get(key)
    if (entry) {
      entry.handlers.add(handler)
    } else {
      entry = {
        key,
        subscribePayload,
        unsubscribePayload,
        matches,
        handlers: new Set([handler]),
      }
      this.subscriptions.set(key, entry)
      // Open socket if needed, then send the subscribe frame.
      void this.connect().then(() => {
        this.sendJson(subscribePayload)
      }).catch(() => {
        /* connect rejection handled in openSocket retry path */
      })
    }
    const sub = entry
    return () => {
      sub.handlers.delete(handler)
      if (sub.handlers.size === 0) {
        this.subscriptions.delete(sub.key)
        if (sub.unsubscribePayload && this.socket?.readyState === WebSocket.OPEN) {
          try { this.sendJson(sub.unsubscribePayload) } catch { /* ignore */ }
        }
      }
    }
  }

  /** Listen to connection state changes for status UI. */
  onState(cb: (state: 'open' | 'close' | 'error') => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  get isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  /** Hard teardown. Subscriptions remembered for next connect(). */
  close(): void {
    this.shouldRun = false
    this.clearTimers()
    if (this.socket) {
      try {
        this.socket.onclose = null
        this.socket.close()
      } catch { /* ignore */ }
      this.socket = null
    }
  }

  // ─── internals ──────────────────────────────────────────────

  private openSocket(): Promise<void> {
    const promise = new Promise<void>((resolve, reject) => {
      let sock: WebSocket
      try {
        sock = new WebSocket(O2_WEBSOCKET_URL)
      } catch (err) {
        reject(err)
        return
      }
      this.socket = sock
      this.lastMessageAt = Date.now()

      const onOpen = () => {
        this.currentReconnectMs = 1000
        this.startPing()
        // Re-send every active subscription.
        for (const sub of this.subscriptions.values()) {
          try { sock.send(JSON.stringify(sub.subscribePayload)) } catch { /* ignore */ }
        }
        this.fireState('open')
        resolve()
      }

      const onMessage = (event: MessageEvent) => {
        this.lastMessageAt = Date.now()
        const text = typeof event.data === 'string' ? event.data : ''
        if (text === 'PING' || text === 'PONG' || text === '') return
        let msg: WsServerMessage
        try {
          msg = JSON.parse(text) as WsServerMessage
        } catch {
          return
        }
        this.dispatch(msg)
      }

      const onError = (err: Event) => {
        this.fireState('error')
        // Don't reject here — onClose will handle reconnect.
        // But the first connect needs to be told something failed:
        try { reject(err) } catch { /* ignore */ }
      }

      const onClose = () => {
        this.clearTimers()
        this.socket = null
        this.connectPromise = null
        this.fireState('close')
        if (this.shouldRun) this.scheduleReconnect()
      }

      sock.addEventListener('open', onOpen)
      sock.addEventListener('message', onMessage)
      sock.addEventListener('error', onError)
      sock.addEventListener('close', onClose)
    })
    this.connectPromise = promise
    promise.finally(() => { this.connectPromise = null })
    return promise
  }

  private dispatch(msg: WsServerMessage): void {
    for (const sub of this.subscriptions.values()) {
      if (!sub.matches(msg)) continue
      for (const h of sub.handlers) {
        try { h(msg) } catch (err) {
          console.error('[O2WebSocket] handler threw', err)
        }
      }
    }
  }

  private sendJson(payload: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload))
    }
  }

  private startPing(): void {
    this.stopPing()
    this.pingTimer = setInterval(() => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
      const elapsed = Date.now() - this.lastMessageAt
      if (elapsed > this.pongTimeoutMs) {
        // No message in the timeout window → treat as dead, force reconnect.
        try { this.socket.close() } catch { /* ignore */ }
        return
      }
      try { this.socket.send('PING') } catch { /* ignore */ }
    }, this.pingIntervalMs)
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  private clearTimers(): void {
    this.stopPing()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    const delay = this.currentReconnectMs
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.openSocket().catch(() => { /* will re-fire onClose */ })
    }, delay)
    this.currentReconnectMs = Math.min(this.currentReconnectMs * 2, this.maxReconnectMs)
  }

  private fireState(state: 'open' | 'close' | 'error'): void {
    for (const cb of this.listeners) {
      try { cb(state) } catch { /* ignore */ }
    }
  }
}

export const o2WebSocket = new O2WebSocket()
