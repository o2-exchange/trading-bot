import Decimal from 'decimal.js'
import { db } from './dbService'
import { TradingSession, TradingSessionTrade, FEE_RATE } from '../types/tradingSession'

class TradingSessionService {
  private currentSessionId: string | null = null
  private listeners: Set<(session: TradingSession | null) => void> = new Set()

  /**
   * Create a new trading session
   */
  async createSession(ownerAddress: string, marketId: string, marketPair: string): Promise<TradingSession> {
    // End any existing active OR paused sessions for this market (clean slate for new session)
    await this.endAllResumableSessions(ownerAddress, marketId)

    const session: TradingSession = {
      id: `${ownerAddress}-${marketId}-${Date.now()}`,
      ownerAddress,
      marketId,
      marketPair,
      status: 'active',
      totalVolume: 0,
      totalFees: 0,
      realizedPnL: 0,
      tradeCount: 0,
      buyCount: 0,
      sellCount: 0,
      averageBuyPrice: '0',
      totalBoughtQuantity: '0',
      totalSoldQuantity: '0',
      totalBuyValue: 0,
      totalSellValue: 0,
      trades: [],
      consoleMessages: [],
      lastContext: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    await db.tradingSessions.put(session)
    this.currentSessionId = session.id
    this.notifyListeners(session)

    console.log('[TradingSessionService] Created new session:', session.id)
    return session
  }

  /**
   * Get active session for a market
   */
  async getActiveSession(ownerAddress: string, marketId: string): Promise<TradingSession | null> {
    const sessions = await db.tradingSessions
      .where('ownerAddress')
      .equals(ownerAddress)
      .and(s => s.marketId === marketId && s.status === 'active')
      .toArray()

    return sessions[0] || null
  }

  /**
   * Get or create session (only creates new if no active session exists)
   * Does NOT resume paused sessions - use resumeSession for that
   */
  async getOrCreateSession(ownerAddress: string, marketId: string, marketPair: string, forceNew: boolean = false): Promise<TradingSession> {
    if (!forceNew) {
      // Check for active session first
      const activeSession = await this.getActiveSession(ownerAddress, marketId)
      if (activeSession) {
        this.currentSessionId = activeSession.id
        return activeSession
      }
    }

    // Create new session (this will end any existing active session)
    const session = await this.createSession(ownerAddress, marketId, marketPair)
    return session
  }

  /**
   * Get active or paused session for a market (for resuming)
   */
  async getResumableSessionForMarket(ownerAddress: string, marketId: string): Promise<TradingSession | null> {
    const sessions = await db.tradingSessions
      .where('ownerAddress')
      .equals(ownerAddress)
      .and(s => s.marketId === marketId && (s.status === 'active' || s.status === 'paused'))
      .toArray()

    return sessions[0] || null
  }

  /**
   * Resume an existing session
   */
  async resumeSession(sessionId: string): Promise<TradingSession | null> {
    const session = await db.tradingSessions.get(sessionId)

    if (!session) {
      console.warn('[TradingSessionService] Session not found:', sessionId)
      return null
    }

    if (session.status === 'ended') {
      console.warn('[TradingSessionService] Cannot resume ended session:', sessionId)
      return null
    }

    session.status = 'active'
    session.updatedAt = Date.now()
    await db.tradingSessions.put(session)

    this.currentSessionId = sessionId
    this.notifyListeners(session)

    console.log('[TradingSessionService] Resumed session:', sessionId)
    return session
  }

  /**
   * Pause the current session (keeps data, can resume)
   */
  async pauseSession(sessionId: string): Promise<void> {
    const session = await db.tradingSessions.get(sessionId)
    if (!session) return

    session.status = 'paused'
    session.updatedAt = Date.now()
    await db.tradingSessions.put(session)

    this.notifyListeners(session)
    console.log('[TradingSessionService] Paused session:', sessionId)
  }

  /**
   * End a session permanently
   */
  async endSession(sessionId: string): Promise<void> {
    const session = await db.tradingSessions.get(sessionId)
    if (!session) return

    session.status = 'ended'
    session.endedAt = Date.now()
    session.updatedAt = Date.now()
    await db.tradingSessions.put(session)

    if (this.currentSessionId === sessionId) {
      this.currentSessionId = null
    }

    this.notifyListeners(null)
    console.log('[TradingSessionService] Ended session:', sessionId)
  }

  /**
   * End any active session for a market
   */
  async endActiveSession(ownerAddress: string, marketId: string): Promise<void> {
    const session = await this.getActiveSession(ownerAddress, marketId)
    if (session) {
      await this.endSession(session.id)
    }
  }

  /**
   * End all resumable (active or paused) sessions for a market
   * Used when creating a truly new session to ensure clean slate
   */
  async endAllResumableSessions(ownerAddress: string, marketId: string): Promise<void> {
    const sessions = await db.tradingSessions
      .where('ownerAddress')
      .equals(ownerAddress)
      .and(s => s.marketId === marketId && (s.status === 'active' || s.status === 'paused'))
      .toArray()

    for (const session of sessions) {
      await this.endSession(session.id)
    }

    console.log(`[TradingSessionService] Ended ${sessions.length} resumable session(s) for market ${marketId}`)
  }

  /**
   * Record a trade in the session
   */
  async recordTrade(
    sessionId: string,
    trade: {
      orderId: string
      side: 'Buy' | 'Sell'
      price: string
      quantity: string
      marketPair: string
    }
  ): Promise<TradingSession | null> {
    const session = await db.tradingSessions.get(sessionId)
    if (!session) return null

    const priceDecimal = new Decimal(trade.price)
    const quantityDecimal = new Decimal(trade.quantity)
    const value = priceDecimal.mul(quantityDecimal).toNumber()
    const fee = value * FEE_RATE

    const sessionTrade: TradingSessionTrade = {
      orderId: trade.orderId,
      side: trade.side,
      price: trade.price,
      quantity: trade.quantity,
      value,
      fee,
      timestamp: Date.now(),
      marketPair: trade.marketPair,
    }

    // Update session metrics
    session.trades.push(sessionTrade)
    session.tradeCount++
    session.totalVolume += value
    session.totalFees += fee

    if (trade.side === 'Buy') {
      session.buyCount++
      session.totalBuyValue += value

      // Update average buy price (weighted average)
      const prevTotal = new Decimal(session.averageBuyPrice).mul(session.totalBoughtQuantity)
      const newTotal = prevTotal.add(priceDecimal.mul(quantityDecimal))
      const newQuantity = new Decimal(session.totalBoughtQuantity).add(quantityDecimal)
      session.totalBoughtQuantity = newQuantity.toString()
      session.averageBuyPrice = newQuantity.gt(0) ? newTotal.div(newQuantity).toString() : '0'
    } else {
      session.sellCount++
      session.totalSellValue += value
      session.totalSoldQuantity = new Decimal(session.totalSoldQuantity).add(quantityDecimal).toString()

      // NOTE: P&L calculation moved to updateSessionPnL() which is called only when fills are confirmed
      // This prevents counting P&L for orders that get cancelled due to timeout
    }

    session.updatedAt = Date.now()
    await db.tradingSessions.put(session)

    this.notifyListeners(session)
    return session
  }

  /**
   * Update session P&L when a sell order is confirmed filled
   * This should only be called when we know the order has actually filled
   */
  async updateSessionPnL(
    sessionId: string,
    sellPrice: string,
    quantity: string
  ): Promise<void> {
    const session = await db.tradingSessions.get(sessionId)
    if (!session) return

    if (session.averageBuyPrice !== '0') {
      const priceDecimal = new Decimal(sellPrice)
      const quantityDecimal = new Decimal(quantity)
      const avgBuy = new Decimal(session.averageBuyPrice)
      const pnl = priceDecimal.minus(avgBuy).mul(quantityDecimal).toNumber()
      session.realizedPnL += pnl
      session.updatedAt = Date.now()
      await db.tradingSessions.put(session)
      this.notifyListeners(session)
      console.log(`[TradingSessionService] Updated session P&L: ${pnl.toFixed(4)} (total: ${session.realizedPnL.toFixed(4)})`)
    }
  }

  /**
   * Add a console message to the session
   */
  async addConsoleMessage(sessionId: string, message: string, type: string): Promise<void> {
    const session = await db.tradingSessions.get(sessionId)
    if (!session) return

    session.consoleMessages.push({
      message,
      type,
      timestamp: Date.now(),
    })

    // Keep only last 100 messages
    if (session.consoleMessages.length > 100) {
      session.consoleMessages = session.consoleMessages.slice(-100)
    }

    session.updatedAt = Date.now()
    await db.tradingSessions.put(session)
  }

  /**
   * Update context snapshot
   */
  async updateContext(sessionId: string, context: TradingSession['lastContext']): Promise<void> {
    const session = await db.tradingSessions.get(sessionId)
    if (!session) return

    session.lastContext = context
    session.updatedAt = Date.now()
    await db.tradingSessions.put(session)

    this.notifyListeners(session)
  }

  /**
   * Get current session
   */
  async getCurrentSession(): Promise<TradingSession | null> {
    if (!this.currentSessionId) return null
    return await db.tradingSessions.get(this.currentSessionId) || null
  }

  /**
   * Get current session ID
   */
  getCurrentSessionId(): string | null {
    return this.currentSessionId
  }

  /**
   * Set current session ID (for resuming)
   */
  setCurrentSessionId(sessionId: string | null): void {
    this.currentSessionId = sessionId
  }

  /**
   * Get all sessions for a user
   */
  async getAllSessions(ownerAddress: string): Promise<TradingSession[]> {
    return await db.tradingSessions
      .where('ownerAddress')
      .equals(ownerAddress)
      .reverse()
      .sortBy('createdAt')
  }

  /**
   * Get recent sessions (last 10)
   */
  async getRecentSessions(ownerAddress: string, limit: number = 10): Promise<TradingSession[]> {
    const sessions = await this.getAllSessions(ownerAddress)
    return sessions.slice(0, limit)
  }

  /**
   * Get the most recent resumable session (active or paused) for a user
   */
  async getResumableSession(ownerAddress: string): Promise<TradingSession | null> {
    const sessions = await db.tradingSessions
      .where('ownerAddress')
      .equals(ownerAddress)
      .and(s => s.status === 'active' || s.status === 'paused')
      .reverse()
      .sortBy('updatedAt')

    return sessions[0] || null
  }

  /**
   * Subscribe to session updates
   */
  onSessionUpdate(callback: (session: TradingSession | null) => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  private notifyListeners(session: TradingSession | null): void {
    this.listeners.forEach(cb => cb(session))
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    await db.tradingSessions.delete(sessionId)
    if (this.currentSessionId === sessionId) {
      this.currentSessionId = null
      this.notifyListeners(null)
    }
  }
}

export const tradingSessionService = new TradingSessionService()
