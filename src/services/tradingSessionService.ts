import Decimal from 'decimal.js'
import { db } from './dbService'
import { TradingSession, TradingSessionTrade, FEE_RATE } from '../types/tradingSession'

class TradingSessionService {
  private currentSessionId: string | null = null
  private listeners: Set<(session: TradingSession | null) => void> = new Set()

  /**
   * Create a new trading session
   */
  async createSession(
    ownerAddress: string,
    marketId: string,
    marketPair: string,
    startingBaseBalance?: string,
    startingQuoteBalance?: string,
    strategyName?: string
  ): Promise<TradingSession> {
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
      realizedPnL: '0',
      tradeCount: 0,
      buyCount: 0,
      sellCount: 0,
      averageBuyPrice: '0',
      totalBoughtQuantity: '0',
      totalSoldQuantity: '0',
      totalBuyValue: 0,
      totalSellValue: 0,
      unsoldCostBasis: '0',
      unsoldQuantity: '0',
      trades: [],
      consoleMessages: [],
      lastContext: null,
      startingBaseBalance: startingBaseBalance || '0',
      startingQuoteBalance: startingQuoteBalance || '0',
      strategyName: strategyName || 'Custom',
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
  async getOrCreateSession(
    ownerAddress: string,
    marketId: string,
    marketPair: string,
    forceNew: boolean = false,
    startingBaseBalance?: string,
    startingQuoteBalance?: string,
    strategyName?: string
  ): Promise<TradingSession> {
    if (!forceNew) {
      // Check for active session first
      const activeSession = await this.getActiveSession(ownerAddress, marketId)
      if (activeSession) {
        this.currentSessionId = activeSession.id
        return activeSession
      }
    }

    // Create new session (this will end any existing active session)
    const session = await this.createSession(
      ownerAddress,
      marketId,
      marketPair,
      startingBaseBalance,
      startingQuoteBalance,
      strategyName
    )
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

      // NOTE: P&L calculation is done in recordConfirmedFill() which is called only when fills are confirmed
      // This prevents counting P&L for orders that get cancelled due to timeout
    }

    session.updatedAt = Date.now()
    await db.tradingSessions.put(session)

    this.notifyListeners(session)
    return session
  }

  /**
   * Record a confirmed fill in the session (only when order is actually filled)
   * This should be called from tradingEngine when fills are detected, not on order placement
   * Use this for accurate trade count, volume tracking, and PnL calculation
   *
   * PnL Calculation Rules (Quantity-Matched Weighted Average):
   * - Buy orders: PnL = -fee (always a loss from fees)
   * - Sell orders: PnL = (sellPrice - weightedAvgBuyPrice) × matchedQty - sellFee
   *   where matchedQty = min(sellQty, unsoldBoughtQty)
   * - If selling more than bought: excess has no P&L (just fee)
   */
  async recordConfirmedFill(
    sessionId: string,
    trade: {
      orderId: string
      side: 'Buy' | 'Sell'
      fillPrice: string    // Actual fill price (human-readable)
      fillQuantity: string // Actual filled quantity (human-readable)
      marketPair: string
    }
  ): Promise<TradingSession | null> {
    const session = await db.tradingSessions.get(sessionId)
    if (!session) return null

    const priceDecimal = new Decimal(trade.fillPrice)
    const quantityDecimal = new Decimal(trade.fillQuantity)
    const value = priceDecimal.mul(quantityDecimal).toNumber()
    const fee = priceDecimal.mul(quantityDecimal).mul(FEE_RATE).toNumber()

    // Calculate PnL contribution for this trade using Decimal for precision
    // IMPORTANT: Buy fee is counted on buy, sell fee is counted on sell
    // This avoids double-counting fees on round-trip trades
    let pnlContributionDecimal = new Decimal(0)
    let weightedAvgBuyPrice: string | undefined
    let matchedQuantity: string | undefined

    if (trade.side === 'Buy') {
      // Buy order: PnL = -buyFee (count fee immediately)
      const buyFeeDecimal = new Decimal(fee)
      pnlContributionDecimal = buyFeeDecimal.neg()
      console.log(`[TradingSessionService] Buy fill PnL: -$${buyFeeDecimal.toFixed(8)} (fee)`)
    } else {
      // Sell order: calculate P&L using unsold inventory cost basis
      const sellFeeDecimal = new Decimal(fee)
      const sellQty = quantityDecimal

      // Use unsoldQuantity (only inventory that hasn't been sold yet)
      const unsoldQty = new Decimal(session.unsoldQuantity || '0')
      const unsoldCostBasisDecimal = new Decimal(session.unsoldCostBasis || '0')

      if (unsoldQty.gt(0) && unsoldCostBasisDecimal.gt(0)) {
        // How much of this sell has a matching buy?
        const matchedQty = Decimal.min(sellQty, unsoldQty)

        // Calculate avg cost basis of unsold inventory
        const avgCostBasis = unsoldCostBasisDecimal.div(unsoldQty)

        // Calculate P&L only on matched quantity
        const grossPnL = priceDecimal.minus(avgCostBasis).mul(matchedQty)

        // Fee is on entire sell quantity
        pnlContributionDecimal = grossPnL.minus(sellFeeDecimal)

        // Store for debugging
        weightedAvgBuyPrice = avgCostBasis.toString()
        matchedQuantity = matchedQty.toString()

        console.log(`[TradingSessionService] Sell fill PnL: matched=${matchedQty.toString()}, avgCostBasis=$${avgCostBasis.toFixed(8)}, gross=$${grossPnL.toFixed(8)}, sellFee=$${sellFeeDecimal.toFixed(8)}, net=$${pnlContributionDecimal.toFixed(8)}`)
      } else {
        // No unsold buys in session: only count sellFee
        pnlContributionDecimal = sellFeeDecimal.neg()
        console.log(`[TradingSessionService] Sell fill PnL: -$${sellFeeDecimal.toFixed(8)} (no matching buys)`)
      }
    }

    // Update session's realized P&L using Decimal for precision
    const currentPnL = new Decimal(session.realizedPnL || '0')
    session.realizedPnL = currentPnL.plus(pnlContributionDecimal).toString()

    const sessionTrade: TradingSessionTrade = {
      orderId: trade.orderId,
      side: trade.side,
      price: trade.fillPrice,
      quantity: trade.fillQuantity,
      value,
      fee,
      timestamp: Date.now(),
      marketPair: trade.marketPair,
      weightedAvgBuyPrice,
      matchedQuantity,
      pnlContribution: pnlContributionDecimal.toNumber(),
    }

    // Update session metrics - only increment tradeCount on confirmed fill
    session.trades.push(sessionTrade)
    session.tradeCount++
    session.totalVolume += value
    session.totalFees += fee

    if (trade.side === 'Buy') {
      session.buyCount++
      session.totalBuyValue += value

      // Update average buy price (weighted average for session tracking - informational only)
      const prevTotal = new Decimal(session.averageBuyPrice).mul(session.totalBoughtQuantity)
      const newTotal = prevTotal.add(priceDecimal.mul(quantityDecimal))
      const newQuantity = new Decimal(session.totalBoughtQuantity).add(quantityDecimal)
      session.totalBoughtQuantity = newQuantity.toString()
      session.averageBuyPrice = newQuantity.gt(0) ? newTotal.div(newQuantity).toString() : '0'

      // Add to unsold inventory (this is what's used for P&L calculation)
      // Use Decimal for precision
      const currentCostBasis = new Decimal(session.unsoldCostBasis || '0')
      session.unsoldCostBasis = currentCostBasis.plus(value).toString()
      session.unsoldQuantity = new Decimal(session.unsoldQuantity || '0').add(quantityDecimal).toString()
    } else {
      session.sellCount++
      session.totalSellValue += value
      session.totalSoldQuantity = new Decimal(session.totalSoldQuantity).add(quantityDecimal).toString()

      // Reduce unsold inventory proportionally using Decimal for precision
      const unsoldQty = new Decimal(session.unsoldQuantity || '0')
      if (unsoldQty.gt(0)) {
        const matchedQty = Decimal.min(quantityDecimal, unsoldQty)
        const soldRatio = matchedQty.div(unsoldQty)

        // Reduce cost basis proportionally to quantity sold
        const currentCostBasis = new Decimal(session.unsoldCostBasis || '0')
        const remainingRatio = new Decimal(1).minus(soldRatio)
        session.unsoldCostBasis = currentCostBasis.mul(remainingRatio).toString()
        session.unsoldQuantity = unsoldQty.minus(matchedQty).toString()

        console.log(`[TradingSessionService] Updated unsold inventory: qty=${session.unsoldQuantity}, costBasis=$${new Decimal(session.unsoldCostBasis).toFixed(8)}`)
      }
    }

    session.updatedAt = Date.now()
    await db.tradingSessions.put(session)

    this.notifyListeners(session)
    console.log(`[TradingSessionService] Recorded confirmed fill: ${trade.side} ${trade.fillQuantity} @ $${trade.fillPrice} (trade #${session.tradeCount}, session PnL: $${new Decimal(session.realizedPnL).toFixed(8)})`)
    return session
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
   * Get session by ID
   */
  async getSessionById(sessionId: string): Promise<TradingSession | null> {
    return await db.tradingSessions.get(sessionId) || null
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
   * Get ALL resumable sessions (active or paused) for a user - supports multi-market
   */
  async getAllResumableSessions(ownerAddress: string): Promise<TradingSession[]> {
    return db.tradingSessions
      .where('ownerAddress')
      .equals(ownerAddress)
      .and(s => s.status === 'active' || s.status === 'paused')
      .toArray()
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

  /**
   * Calculate unrealized PnL for a session based on current market price.
   * Unrealized PnL = (currentPrice - avgCostBasis) * unsoldQuantity
   */
  calculateUnrealizedPnL(session: TradingSession, currentMarketPrice: Decimal): {
    unrealizedPnL: Decimal
    totalPnL: Decimal
    percentageGain: number
  } {
    const unsoldQty = new Decimal(session.unsoldQuantity || '0')
    const costBasis = new Decimal(session.unsoldCostBasis || '0')
    const realizedPnL = new Decimal(session.realizedPnL || '0')

    if (unsoldQty.isZero() || costBasis.isZero()) {
      return {
        unrealizedPnL: new Decimal(0),
        totalPnL: realizedPnL,
        percentageGain: 0
      }
    }

    // Calculate average cost per unit
    const avgCostPerUnit = costBasis.div(unsoldQty)

    // Unrealized P&L = (current price - avg cost) * quantity
    const unrealizedPnL = currentMarketPrice
      .minus(avgCostPerUnit)
      .mul(unsoldQty)

    // Total P&L = realized + unrealized
    const totalPnL = realizedPnL.plus(unrealizedPnL)

    // Percentage gain on cost basis
    const percentageGain = costBasis.isZero()
      ? 0
      : unrealizedPnL.div(costBasis).mul(100).toNumber()

    return {
      unrealizedPnL,
      totalPnL,
      percentageGain
    }
  }

  /**
   * Update session with current market price for unrealized PnL tracking.
   */
  async updateMarketPrice(sessionId: string, marketPrice: Decimal): Promise<void> {
    const session = await db.tradingSessions.get(sessionId)
    if (!session) return

    const { unrealizedPnL } = this.calculateUnrealizedPnL(session, marketPrice)

    session.unrealizedPnL = unrealizedPnL.toString()
    session.lastMarketPrice = marketPrice.toString()
    session.lastPriceUpdateTime = Date.now()
    session.updatedAt = Date.now()

    await db.tradingSessions.put(session)
    this.notifyListeners(session)
  }
}

export const tradingSessionService = new TradingSessionService()
