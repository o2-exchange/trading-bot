import Decimal from 'decimal.js'
import { Market } from '../types/market'
import { StrategyConfig, StrategyExecutionResult } from '../types/strategy'
import { unifiedStrategyExecutor } from './unifiedStrategyExecutor'
import { marketService } from './marketService'
import { orderService } from './orderService'
import { tradeHistoryService } from './tradeHistoryService'
import { orderFulfillmentService } from './orderFulfillmentService'
import { orderFulfillmentPolling } from './orderFulfillmentPolling'
import { balanceService } from './balanceService'
import { tradingSessionService } from './tradingSessionService'
import { db } from './dbService'
import { Trade } from '../types/trade'
import { Order, OrderSide, OrderStatus } from '../types/order'
import { TradingSession } from '../types/tradingSession'

type TradeCallback = () => void
type StatusCallback = (message: string, type: 'info' | 'success' | 'error' | 'warning') => void

// Trading context for rich console display
export interface TradingContext {
  pair: string
  baseBalance: string
  quoteBalance: string
  lastBuyPrice: string | null
  currentPrice: string | null
  openBuyOrders: number
  openSellOrders: number
  pendingSellOrder: { price: string; quantity: string } | null
  profitProtectionEnabled: boolean
  nextRunIn: number // seconds
  // Session metrics
  sessionId: string | null
  totalVolume: number
  totalFees: number
  realizedPnL: number
  tradeCount: number
  // Starting balances (from session)
  startingBaseBalance: string | null   // "0.5 ETH"
  startingQuoteBalance: string | null  // "$100.00"
  // Strategy info
  strategyName: string | null  // "Simple Mode"
}

type ContextCallback = (context: TradingContext) => void
type MultiContextCallback = (contexts: Map<string, TradingContext>) => void

interface MarketConfig {
  market: Market
  config: StrategyConfig
  nextRunAt: number
  intervalId?: number
  sessionId?: string
}

class TradingEngine {
  private isRunning: boolean = false
  private marketConfigs: Map<string, MarketConfig> = new Map()
  private sessionTradeCycles: number = 0
  private ownerAddress: string | null = null
  private tradingAccountId: string | null = null
  private onTradeCompleteCallbacks: TradeCallback[] = []
  private onStatusCallbacks: StatusCallback[] = []
  private onContextCallbacks: ContextCallback[] = []
  private onMultiContextCallbacks: MultiContextCallback[] = []
  private transactionLock: boolean = false
  private lastContext: TradingContext | null = null
  private marketContexts: Map<string, TradingContext> = new Map()

  private emitStatus(message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info'): void {
    this.onStatusCallbacks.forEach((callback) => {
      try {
        callback(message, type)
      } catch (error) {
        console.error('Error in status callback:', error)
      }
    })
  }

  private emitContext(context: TradingContext): void {
    this.lastContext = context
    this.marketContexts.set(context.pair, context)
    this.onContextCallbacks.forEach((callback) => {
      try {
        callback(context)
      } catch (error) {
        console.error('Error in context callback:', error)
      }
    })
    this.emitMultiContext()
  }

  private emitMultiContext(): void {
    this.onMultiContextCallbacks.forEach((callback) => {
      try {
        callback(this.marketContexts)
      } catch (error) {
        console.error('Error in multi-context callback:', error)
      }
    })
  }

  onContext(callback: ContextCallback): () => void {
    this.onContextCallbacks.push(callback)
    // Immediately emit last context if available
    if (this.lastContext) {
      callback(this.lastContext)
    }
    return () => {
      const index = this.onContextCallbacks.indexOf(callback)
      if (index > -1) {
        this.onContextCallbacks.splice(index, 1)
      }
    }
  }

  getLastContext(): TradingContext | null {
    return this.lastContext
  }

  onMultiContext(callback: MultiContextCallback): () => void {
    this.onMultiContextCallbacks.push(callback)
    // Immediately emit current contexts if available
    if (this.marketContexts.size > 0) {
      callback(this.marketContexts)
    }
    return () => {
      const index = this.onMultiContextCallbacks.indexOf(callback)
      if (index > -1) {
        this.onMultiContextCallbacks.splice(index, 1)
      }
    }
  }

  getMarketContexts(): Map<string, TradingContext> {
    return this.marketContexts
  }

  getNextRunTime(): number | null {
    let earliest: number | null = null
    for (const marketConfig of this.marketConfigs.values()) {
      if (marketConfig.nextRunAt && (!earliest || marketConfig.nextRunAt < earliest)) {
        earliest = marketConfig.nextRunAt
      }
    }
    return earliest
  }

  initialize(ownerAddress: string, tradingAccountId: string): void {
    // Normalize address
    this.ownerAddress = ownerAddress.toLowerCase()
    this.tradingAccountId = tradingAccountId
  }

  async start(options: { resumeSession?: boolean } = {}): Promise<void> {
    const { resumeSession = false } = options
    console.log(`[TradingEngine] start() called with resumeSession=${resumeSession}`)

    if (this.isRunning) {
      console.log('[TradingEngine] Already running, skipping')
      return
    }

    if (!this.ownerAddress || !this.tradingAccountId) {
      throw new Error('Trading engine not initialized. Please set owner address and trading account ID.')
    }

    this.isRunning = true
    this.sessionTradeCycles = 0

    // Get active strategy configs from database
    console.log('[TradingEngine] Querying active strategy configs...')
    const allConfigs = await db.strategyConfigs.toArray()
    const activeConfigs = allConfigs.filter((config) => config.isActive === true)

    console.log(`[TradingEngine] Found ${activeConfigs.length} active strategy config(s) out of ${allConfigs.length} total`)

    if (activeConfigs.length === 0) {
      console.warn('[TradingEngine] No active strategy configs found! Please configure a strategy in the Strategies tab.')
      this.emitStatus('No active strategies configured. Please set up a strategy first.', 'warning')
      // Still set isRunning to true so UI shows as active, but no trading will occur
      return
    }

    // Initialize market configs
    for (const storedConfig of activeConfigs) {
      console.log(`[TradingEngine] Initializing config for market: ${storedConfig.marketId}`)
      const market = await marketService.getMarket(storedConfig.marketId)
      if (!market) {
        console.warn(`[TradingEngine] Market ${storedConfig.marketId} not found, skipping`)
        continue
      }

      const marketConfig: MarketConfig = {
        market,
        config: storedConfig.config,
        nextRunAt: Date.now() + this.getJitteredDelay(storedConfig.config),
      }

      this.marketConfigs.set(storedConfig.marketId, marketConfig)
      console.log(`[TradingEngine] Market config initialized: ${storedConfig.marketId}`)
    }

    console.log(`[TradingEngine] Starting trading loops for ${this.marketConfigs.size} market(s)...`)

    // Start trading loops for each market
    for (const [marketId, marketConfig] of this.marketConfigs) {
      const marketPair = `${marketConfig.market.base.symbol}/${marketConfig.market.quote.symbol}`

      let session
      if (resumeSession) {
        // Try to resume existing paused/active session
        const existingSession = await tradingSessionService.getResumableSessionForMarket(
          this.ownerAddress!,
          marketId
        )
        if (existingSession) {
          session = await tradingSessionService.resumeSession(existingSession.id)
          marketConfig.sessionId = session?.id
          console.log(`[TradingEngine] Resumed session: ${session?.id} (${session?.tradeCount} trades, $${session?.totalVolume.toFixed(2)} volume)`)
        }
      }

      // If not resuming or no session to resume, create new
      if (!session) {
        // Fetch starting balances for new session
        let startingBaseBalance: string | undefined
        let startingQuoteBalance: string | undefined
        try {
          const balances = await balanceService.getMarketBalances(
            marketConfig.market,
            this.tradingAccountId!,
            this.ownerAddress!
          )
          const baseBalanceHuman = new Decimal(balances.base.unlocked).div(10 ** marketConfig.market.base.decimals)
          const quoteBalanceHuman = new Decimal(balances.quote.unlocked).div(10 ** marketConfig.market.quote.decimals)
          startingBaseBalance = baseBalanceHuman.toFixed(6).replace(/\.?0+$/, '')
          startingQuoteBalance = quoteBalanceHuman.toFixed(2)
        } catch (error) {
          console.error(`[TradingEngine] ❌ Failed to fetch starting balances for ${marketPair}:`, error)
          this.emitStatus(`${marketPair}: Could not capture starting balance`, 'warning')
        }

        const strategyName = marketConfig.config.name || 'Custom'

        session = await tradingSessionService.getOrCreateSession(
          this.ownerAddress!,
          marketId,
          marketPair,
          !resumeSession, // forceNew if not resuming
          startingBaseBalance,
          startingQuoteBalance,
          strategyName
        )
        marketConfig.sessionId = session.id
        console.log(`[TradingEngine] New session: ${session.id} (starting: ${startingBaseBalance} ${marketConfig.market.base.symbol} + $${startingQuoteBalance})`)
      }

      // Set nextRunAt to now for immediate execution (better UX)
      marketConfig.nextRunAt = Date.now()
      this.startMarketTrading(marketId, marketConfig)

      // NOTE: Fill tracking is handled directly in executeTrade() (lines 347-407)
      // We don't start separate polling to avoid race conditions and duplicate processing
    }

    console.log('[TradingEngine] Trading engine started successfully')
  }

  stop(): void {
    if (!this.isRunning) {
      return
    }

    this.isRunning = false
    this.transactionLock = false

    // Pause all market sessions (async, fire and forget)
    for (const marketConfig of this.marketConfigs.values()) {
      if (marketConfig.sessionId) {
        tradingSessionService.pauseSession(marketConfig.sessionId).catch(err =>
          console.error('[TradingEngine] Failed to pause session:', err)
        )
      }
    }

    // Stop all order fulfillment polling
    orderFulfillmentPolling.stopAll()

    // Clear processed fills tracking to avoid duplicates on next start
    orderFulfillmentService.clearProcessedFills()

    // Don't clear lastContext so it persists when trading stops
    // this.lastContext = null

    // Clear all intervals
    for (const marketConfig of this.marketConfigs.values()) {
      if (marketConfig.intervalId) {
        clearTimeout(marketConfig.intervalId)
      }
    }

    this.marketConfigs.clear()
  }

  isActive(): boolean {
    return this.isRunning
  }

  /**
   * Stop trading for a specific market without stopping the entire engine.
   * Used when a strategy is deactivated while trading is active.
   */
  stopMarketTrading(marketId: string): void {
    const marketConfig = this.marketConfigs.get(marketId)
    if (!marketConfig) {
      console.log(`[TradingEngine] Market ${marketId} not found in active configs`)
      return
    }

    console.log(`[TradingEngine] Stopping trading for market ${marketId}`)

    // Clear the timeout for this market's trading loop
    if (marketConfig.intervalId) {
      clearTimeout(marketConfig.intervalId)
    }

    // Pause the session for this market
    if (marketConfig.sessionId) {
      tradingSessionService.pauseSession(marketConfig.sessionId).catch(err =>
        console.error(`[TradingEngine] Failed to pause session for ${marketId}:`, err)
      )
    }

    // Remove this market from active configs
    this.marketConfigs.delete(marketId)

    // Remove context for this market
    this.marketContexts.delete(`${marketConfig.market.base.symbol}/${marketConfig.market.quote.symbol}`)
    this.emitMultiContext()

    const pair = `${marketConfig.market.base.symbol}/${marketConfig.market.quote.symbol}`
    this.emitStatus(`${pair}: Strategy deactivated`, 'info')

    console.log(`[TradingEngine] Stopped trading for ${marketId}. Remaining markets: ${this.marketConfigs.size}`)
  }

  getSessionTradeCycles(): number {
    return this.sessionTradeCycles
  }

  onTradeComplete(callback: TradeCallback): () => void {
    this.onTradeCompleteCallbacks.push(callback)
    return () => {
      const index = this.onTradeCompleteCallbacks.indexOf(callback)
      if (index > -1) {
        this.onTradeCompleteCallbacks.splice(index, 1)
      }
    }
  }

  onStatus(callback: StatusCallback): () => void {
    this.onStatusCallbacks.push(callback)
    return () => {
      const index = this.onStatusCallbacks.indexOf(callback)
      if (index > -1) {
        this.onStatusCallbacks.splice(index, 1)
      }
    }
  }

  private notifyTradeComplete(): void {
    this.onTradeCompleteCallbacks.forEach((callback) => {
      try {
        callback()
      } catch (error) {
        console.error('Error in trade complete callback:', error)
      }
    })
  }

  private async initializeMarketConfig(marketId: string): Promise<void> {
    const storedConfig = await db.strategyConfigs.get(marketId)
    if (!storedConfig || !storedConfig.isActive) {
      return
    }

    const market = await marketService.getMarket(marketId)
    if (!market) {
      return
    }

    const marketConfig: MarketConfig = {
      market,
      config: storedConfig.config,
      nextRunAt: Date.now() + this.getJitteredDelay(storedConfig.config),
    }

    this.marketConfigs.set(marketId, marketConfig)
  }

  private startMarketTrading(marketId: string, marketConfig: MarketConfig): void {
    const executeTrade = async () => {
      if (!this.isRunning || !this.ownerAddress || !this.tradingAccountId) {
        console.log('[TradingEngine] Not running or not initialized, stopping')
        return
      }

      if (this.transactionLock) {
        if (this.isRunning) {
          const delay = 2500
          marketConfig.nextRunAt = Date.now() + delay
          marketConfig.intervalId = window.setTimeout(executeTrade, delay)
        }
        return
      }

      this.transactionLock = true

      try {
        console.log(`[TradingEngine] Executing strategy for ${marketConfig.market.market_id}`)
        const pair = `${marketConfig.market.base.symbol}/${marketConfig.market.quote.symbol}`

        // Refresh config from database to get latest risk management settings
        const storedConfig = await db.strategyConfigs.get(marketConfig.market.market_id)
        if (storedConfig) {
          marketConfig.config = storedConfig.config
        }

        // CHECK 1: Is trading paused due to max daily loss?
        if (this.isTradingPaused(marketConfig.config)) {
          this.emitStatus(`${pair}: Trading paused (max daily loss exceeded)`, 'warning')
          // Reschedule with longer delay when paused
          marketConfig.nextRunAt = Date.now() + 60000 // Check again in 1 minute
          if (this.isRunning) {
            marketConfig.intervalId = window.setTimeout(executeTrade, 60000)
          }
          return
        }

        // CHECK 2: Order timeouts - cancel stale orders
        await this.checkOrderTimeouts(marketConfig.market.market_id, marketConfig.config, this.ownerAddress!)

        // Gather context for rich console display
        try {
          const [balances, openOrders, ticker] = await Promise.all([
            balanceService.getMarketBalances(marketConfig.market, this.tradingAccountId!, this.ownerAddress!),
            orderService.getOpenOrders(marketConfig.market.market_id, this.ownerAddress!),
            marketService.getTicker(marketConfig.market.market_id)
          ])

          const baseBalanceHuman = new Decimal(balances.base.unlocked).div(10 ** marketConfig.market.base.decimals)
          const quoteBalanceHuman = new Decimal(balances.quote.unlocked).div(10 ** marketConfig.market.quote.decimals)
          const buyOrders = openOrders.filter(o => o.side === OrderSide.Buy)
          const sellOrders = openOrders.filter(o => o.side === OrderSide.Sell)

          // Find pending sell order (waiting in orderbook)
          let pendingSellOrder: { price: string; quantity: string } | null = null
          if (sellOrders.length > 0 && marketConfig.config.orderManagement.onlySellAboveBuyPrice) {
            const sellOrder = sellOrders[0]
            const priceHuman = new Decimal(sellOrder.price).div(10 ** marketConfig.market.quote.decimals)
            const quantityHuman = new Decimal(sellOrder.quantity).div(10 ** marketConfig.market.base.decimals)
            pendingSellOrder = {
              price: priceHuman.toFixed(marketConfig.market.quote.decimals).replace(/\.?0+$/, ''),
              quantity: quantityHuman.toFixed(3).replace(/\.?0+$/, '')
            }
          }

          const currentPrice = ticker?.last_price
            ? new Decimal(ticker.last_price).div(10 ** marketConfig.market.quote.decimals).toFixed(marketConfig.market.quote.decimals).replace(/\.?0+$/, '')
            : null

          const nextRunIn = marketConfig.nextRunAt ? Math.max(0, Math.round((marketConfig.nextRunAt - Date.now()) / 1000)) : 0

          // Get session metrics for THIS specific market
          const currentSession = marketConfig.sessionId
            ? await tradingSessionService.getSessionById(marketConfig.sessionId)
            : null

          const baseSymbol = marketConfig.market.base.symbol

          const context: TradingContext = {
            pair,
            baseBalance: `${baseBalanceHuman.toFixed(6).replace(/\.?0+$/, '')} ${baseSymbol}`,
            quoteBalance: `$${quoteBalanceHuman.toFixed(2)}`,
            lastBuyPrice: marketConfig.config.averageBuyPrice ? `$${new Decimal(marketConfig.config.averageBuyPrice).toFixed(marketConfig.market.quote.decimals).replace(/\.?0+$/, '')}` : null,
            currentPrice: currentPrice ? `$${currentPrice}` : null,
            openBuyOrders: buyOrders.length,
            openSellOrders: sellOrders.length,
            pendingSellOrder,
            profitProtectionEnabled: marketConfig.config.orderManagement.onlySellAboveBuyPrice,
            nextRunIn,
            // Session metrics
            sessionId: currentSession?.id || null,
            totalVolume: currentSession?.totalVolume || 0,
            totalFees: currentSession?.totalFees || 0,
            realizedPnL: currentSession?.realizedPnL || 0,
            tradeCount: currentSession?.tradeCount || 0,
            // Starting balances (from session)
            startingBaseBalance: currentSession?.startingBaseBalance
              ? `${currentSession.startingBaseBalance} ${baseSymbol}`
              : null,
            startingQuoteBalance: currentSession?.startingQuoteBalance
              ? `$${currentSession.startingQuoteBalance}`
              : null,
            // Strategy info - prefer current config name over session (user may have renamed)
            strategyName: marketConfig.config.name || currentSession?.strategyName || null,
          }
          this.emitContext(context)

          // Update session context
          if (currentSession) {
            await tradingSessionService.updateContext(currentSession.id, {
              pair,
              currentPrice: currentPrice || '',
              baseBalance: baseBalanceHuman.toFixed(6),
              quoteBalance: quoteBalanceHuman.toFixed(2),
              lastBuyPrice: marketConfig.config.averageBuyPrice
            })
          }
        } catch (error) {
          console.warn('[TradingEngine] Failed to gather context:', error)
        }

        // Note: Fill tracking is done AFTER strategy execution (lines 565-666) to avoid
        // double-tracking race condition. The post-execution tracking also handles
        // immediate sell orders and P&L updates in a single pass.

        // Execute unified strategy executor
        const result = await unifiedStrategyExecutor.execute(
          marketConfig.market,
          marketConfig.config,
          this.ownerAddress!,
          this.tradingAccountId!
        )

        console.log(`[TradingEngine] Strategy result:`, result)

        if (!result) {
          console.warn(`[TradingEngine] Strategy returned no result for ${marketId}`)
          const pair = `${marketConfig.market.base.symbol}/${marketConfig.market.quote.symbol}`
          this.emitStatus(`${pair}: Strategy returned no result`, 'warning')
          // Reschedule
          marketConfig.nextRunAt = Date.now() + 10000
          if (this.isRunning) {
            marketConfig.intervalId = window.setTimeout(executeTrade, 10000)
          }
          return
        }

        if (result.executed && result.orders) {
          this.sessionTradeCycles++

          // Record trades
          for (const orderExec of result.orders) {
            if (orderExec.success && orderExec.orderId) {
              console.log(`[TradingEngine] Order placed: ${orderExec.side} ${orderExec.orderId}`)
              
              // Fetch order to get fill prices (price_fill and filled_quantity)
              // Try multiple times with delays to get fill prices if order was just placed
              let priceFill: string | undefined
              let filledQuantity: string | undefined
              let fetchedOrder: Order | null = null
              
              const fetchFillPrices = async (retries = 3, delay = 1000) => {
                for (let i = 0; i < retries; i++) {
                  try {
                    const order = await orderService.getOrder(orderExec.orderId, marketConfig.market.market_id, this.ownerAddress!)
                    if (order) {
                      // Store the fetched order for later use
                      fetchedOrder = order
                      
                      if (order.price_fill && order.price_fill !== '0' && order.price_fill !== '') {
                        priceFill = order.price_fill
                        console.log(`[TradingEngine] Fetched fill price for order ${orderExec.orderId}: ${priceFill}`)
                      }
                      if (order.filled_quantity && order.filled_quantity !== '0') {
                        filledQuantity = order.filled_quantity
                        console.log(`[TradingEngine] Fetched filled quantity for order ${orderExec.orderId}: ${filledQuantity}`)
                      }
                      // If we got fill prices, break early
                      if (priceFill || filledQuantity) {
                        break
                      }
                    }
                  } catch (error) {
                    console.warn(`[TradingEngine] Attempt ${i + 1} failed to fetch fill prices for order ${orderExec.orderId}:`, error)
                  }
                  // Wait before retry (except on last attempt)
                  if (i < retries - 1) {
                    await new Promise(resolve => setTimeout(resolve, delay))
                  }
                }
              }
              
              await fetchFillPrices()
              
              // Note: orderService.getOrder() already stores the order in the database,
              // so fetchedOrder (if not null) is already persisted with latest fill info.
              // This ensures trackOrderFills() will have accurate data to compare against.
              
              // Use the API order status if available (properly mapped from close/cancel fields)
              // Fall back to isLimitOrder check if order wasn't fetched
              let tradeStatus: 'pending' | 'filled' | 'cancelled' | 'failed' = 'pending'
              // Note: fetchedOrder is assigned in the closure above, TypeScript can't track this
              const orderForStatus = fetchedOrder as Order | null
              if (orderForStatus) {
                // Map OrderStatus enum to trade status string
                switch (orderForStatus.status) {
                  case OrderStatus.Filled:
                    tradeStatus = 'filled'
                    break
                  case OrderStatus.Cancelled:
                    tradeStatus = 'cancelled'
                    break
                  case OrderStatus.Open:
                  case OrderStatus.PartiallyFilled:
                    tradeStatus = 'pending'
                    break
                  default:
                    tradeStatus = orderExec.isLimitOrder ? 'pending' : 'filled'
                }
              } else {
                // Fallback if order fetch failed
                tradeStatus = orderExec.isLimitOrder ? 'pending' : 'filled'
              }

              const trade: Trade = {
                timestamp: Date.now(),
                marketId: marketConfig.market.market_id,
                orderId: orderExec.orderId,
                side: orderExec.side,
                orderType: orderExec.isLimitOrder ? 'Limit' : 'Market',
                price: orderExec.price || '0',
                priceFill: priceFill,
                quantity: orderExec.quantity || '0',
                filledQuantity: filledQuantity,
                success: true,
                status: tradeStatus,
              }

              await tradeHistoryService.addTrade(trade)
              
              // Format success message with human-readable values
              const pair = orderExec.marketPair || `${marketConfig.market.base.symbol}/${marketConfig.market.quote.symbol}`
              const orderType = orderExec.isLimitOrder ? 'LIMIT' : 'MARKET'
              const amount = orderExec.quantityHuman || 'N/A'
              const asset = marketConfig.market.base.symbol
              const orderPrice = orderExec.priceHuman ? `$${orderExec.priceHuman}` : 'N/A'

              // Format fill price if available
              let fillPriceHuman: string | null = null
              if (priceFill && priceFill !== '0') {
                // Use proper decimal precision for small prices (e.g., $0.001668 instead of $0.00)
                fillPriceHuman = new Decimal(priceFill).div(10 ** marketConfig.market.quote.decimals).toFixed(marketConfig.market.quote.decimals).replace(/\.?0+$/, '')
              }

              // Format filled quantity if available
              let filledQtyHuman: string | null = null
              if (filledQuantity && filledQuantity !== '0') {
                filledQtyHuman = new Decimal(filledQuantity).div(10 ** marketConfig.market.base.decimals).toFixed(3).replace(/\.?0+$/, '')
              }

              // Build detailed message
              let statusMsg: string
              if (fillPriceHuman && filledQtyHuman) {
                statusMsg = `${pair} ${orderType}: ${orderExec.side} order placed at ${orderPrice}, filled ${filledQtyHuman} ${asset} at $${fillPriceHuman}`
              } else if (fillPriceHuman) {
                statusMsg = `${pair} ${orderType}: ${orderExec.side} order placed at ${orderPrice}, filled at $${fillPriceHuman}`
              } else {
                statusMsg = `${pair} ${orderType}: ${orderExec.side} order placed for ${amount} ${asset} at ${orderPrice}`
              }

              this.emitStatus(statusMsg, 'success')

              // Record trade in THIS MARKET's session (not global current session)
              const marketSessionId = marketConfig.sessionId
              if (marketSessionId) {
                const tradePrice = fillPriceHuman || orderExec.priceHuman || '0'
                const tradeQty = filledQtyHuman || orderExec.quantityHuman || '0'
                await tradingSessionService.recordTrade(marketSessionId, {
                  orderId: orderExec.orderId,
                  side: orderExec.side as 'Buy' | 'Sell',
                  price: tradePrice,
                  quantity: tradeQty,
                  marketPair: pair
                })
                // Also record the status message to this market's session
                await tradingSessionService.addConsoleMessage(marketSessionId, statusMsg, 'success')
              }
            } else {
              console.error(`[TradingEngine] Order failed: ${orderExec.side} - ${orderExec.error}`)

              // Format error message with market pair
              const pair = orderExec.marketPair || `${marketConfig.market.base.symbol}/${marketConfig.market.quote.symbol}`
              const orderType = orderExec.isLimitOrder ? 'LIMIT' : 'MARKET'
              const errorMsg = orderExec.error || 'Unknown error'
              this.emitStatus(
                `${pair} ${orderType}: ${orderExec.side} order failed - ${errorMsg}`,
                'error'
              )
            }
          }

          this.notifyTradeComplete()
        }
        // Note: We no longer emit "No orders placed" since the dashboard shows balance/order context

        // Track order fills and update config with fill prices (always enabled)
        if (result.executed) {
          try {
            // Small delay to ensure database updates from getOrder() calls are persisted
            // This is especially important for immediately filled orders
            await new Promise(resolve => setTimeout(resolve, 100))
            
            // Track fills for all orders that were placed
            const fillsDetected = await orderFulfillmentService.trackOrderFills(
              marketConfig.market.market_id,
              this.ownerAddress!
            )
            
            console.log(`[TradingEngine] Tracked order fills: ${fillsDetected.size} fill(s) detected for market ${marketConfig.market.market_id}`)
            
            // Update config with fill prices for each detected fill
            let updatedConfig = marketConfig.config
            for (const [orderId, fillData] of fillsDetected.entries()) {
              const market = marketConfig.market
              updatedConfig = await orderFulfillmentService.updateFillPrices(
                updatedConfig,
                fillData.order,
                market,
                fillData.previousFilledQuantity
              )
            }
            
            // Update config in database with latest fill prices
            if (fillsDetected.size > 0) {
              await db.strategyConfigs.update(marketConfig.market.market_id, {
                config: updatedConfig,
                updatedAt: Date.now(),
              })
              // Update local config for next execution
              marketConfig.config = updatedConfig
              console.log(`[TradingEngine] Updated strategy config with fill prices. Last buy price: ${updatedConfig.averageBuyPrice || 'not set'}`)

              // Process fills for each order type
              for (const [orderId, fillData] of fillsDetected.entries()) {
                if (fillData.order.side === OrderSide.Buy) {
                  // Place immediate sell order after buy fill
                  try {
                    const sellOrder = await orderFulfillmentService.placeSellOrderAfterBuyFill(
                      fillData.order,
                      marketConfig.market,
                      updatedConfig,
                      this.ownerAddress!,
                      this.tradingAccountId!
                    )

                    // Record the sell order in trade history and emit notification
                    if (sellOrder && sellOrder.order && sellOrder.order.order_id) {
                      const market = marketConfig.market
                      const pair = `${market.base.symbol}/${market.quote.symbol}`

                      // Use the human-readable values returned from placeSellOrderAfterBuyFill
                      const quantityHuman = new Decimal(sellOrder.quantityHuman)
                      const priceHuman = new Decimal(sellOrder.priceHuman)

                      // Record trade (use scaled values from the order for storage)
                      // Immediate sell orders are always Spot/Limit, so status is 'pending'
                      const trade: Trade = {
                        timestamp: Date.now(),
                        marketId: market.market_id,
                        orderId: sellOrder.order.order_id,
                        side: 'Sell',
                        price: sellOrder.order.price || sellOrder.priceHuman,
                        quantity: sellOrder.order.quantity || sellOrder.quantityHuman,
                        success: true,
                        status: 'pending',
                      }
                      await tradeHistoryService.addTrade(trade)

                      // Emit status notification with order details
                      this.emitStatus(
                        `${pair}: Sell ${quantityHuman.toFixed(3).replace(/\.?0+$/, '')} ${market.base.symbol} @ $${priceHuman.toFixed(market.quote.decimals).replace(/\.?0+$/, '')} (limit)`,
                        'success'
                      )
                    }
                  } catch (error) {
                    console.error(`[TradingEngine] Error placing immediate sell order for buy fill ${orderId}:`, error)
                    // Continue with other fills even if one fails
                  }
                } else if (fillData.order.side === OrderSide.Sell) {
                  // Calculate and track P&L for sell fills
                  try {
                    const pnl = this.calculateRealizedPnL(
                      fillData.order,
                      marketConfig.market,
                      updatedConfig
                    )
                    if (pnl !== 0) {
                      updatedConfig = await this.updateDailyPnL(
                        marketConfig.market.market_id,
                        pnl,
                        updatedConfig
                      )
                      marketConfig.config = updatedConfig
                    }

                    // Also update session P&L for confirmed sell fills
                    const sessionId = tradingSessionService.getCurrentSessionId()
                    if (sessionId && fillData.order.price_fill && fillData.order.filled_quantity) {
                      const fillPriceHuman = new Decimal(fillData.order.price_fill)
                        .div(10 ** marketConfig.market.quote.decimals)
                        .toString()
                      const fillQtyHuman = new Decimal(fillData.order.filled_quantity)
                        .div(10 ** marketConfig.market.base.decimals)
                        .toString()
                      await tradingSessionService.updateSessionPnL(sessionId, fillPriceHuman, fillQtyHuman)
                    }
                  } catch (error) {
                    console.error(`[TradingEngine] Error updating P&L for sell fill ${orderId}:`, error)
                  }
                }
              }
            }
          } catch (error) {
            console.error('[TradingEngine] Error tracking order fills:', error)
          }
        }

        // Sync pending trade statuses with API (handles cancelled/filled orders)
        await this.syncPendingTradeStatuses(marketConfig.market.market_id, this.ownerAddress!)

        // Schedule next execution
        const nextRunAt = result.nextRunAt || Date.now() + this.getJitteredDelay(marketConfig.config)
        marketConfig.nextRunAt = nextRunAt

        if (this.isRunning) {
          const delay = Math.max(0, nextRunAt - Date.now())
          console.log(`[TradingEngine] Next execution in ${delay}ms`)
          marketConfig.intervalId = window.setTimeout(executeTrade, delay)
        }
      } catch (error: any) {
        console.error(`[TradingEngine] Error executing strategy for ${marketId}:`, error)
        this.emitStatus(`[${marketConfig.market.market_id}] Error: ${error.message}`, 'error')

        // Reschedule with delay on error
        marketConfig.nextRunAt = Date.now() + 10000
        if (this.isRunning) {
          marketConfig.intervalId = window.setTimeout(executeTrade, 10000)
        }
      } finally {
        this.transactionLock = false
      }
    }

    // Start first execution
    const delay = Math.max(0, marketConfig.nextRunAt - Date.now())
    console.log(`[TradingEngine] Starting trading for ${marketId}, first execution in ${delay}ms`)
    marketConfig.intervalId = window.setTimeout(executeTrade, delay)
  }

  private getJitteredDelay(config: StrategyConfig): number {
    const min = config.timing.cycleIntervalMinMs
    const max = config.timing.cycleIntervalMaxMs
    return min + Math.floor(Math.random() * (max - min + 1))
  }

  /**
   * Sync pending trade statuses with API to detect cancelled/filled orders
   */
  private async syncPendingTradeStatuses(marketId: string, ownerAddress: string): Promise<void> {
    try {
      // Get trades with pending status for this market
      const pendingTrades = await db.trades
        .where('marketId')
        .equals(marketId)
        .filter(t => t.status === 'pending')
        .toArray()

      if (pendingTrades.length === 0) {
        return
      }

      console.log(`[TradingEngine] Syncing ${pendingTrades.length} pending trade(s) for market ${marketId}`)

      // Check each pending trade's order status via API
      for (const trade of pendingTrades) {
        if (!trade.orderId) continue

        try {
          const order = await orderService.getOrder(trade.orderId, marketId, ownerAddress)
          if (order) {
            if (order.status === OrderStatus.Cancelled) {
              console.log(`[TradingEngine] Order ${trade.orderId} was cancelled, updating trade status`)
              await tradeHistoryService.updateTradeByOrderId(trade.orderId, {
                status: 'cancelled',
                success: false,
              })
            } else if (order.status === OrderStatus.Filled) {
              console.log(`[TradingEngine] Order ${trade.orderId} was filled, updating trade status`)
              await tradeHistoryService.updateTradeByOrderId(trade.orderId, {
                status: 'filled',
                priceFill: order.price_fill,
                filledQuantity: order.filled_quantity,
              })

              // Update session P&L for confirmed sell fills
              if (trade.side === 'Sell' && order.price_fill && order.filled_quantity) {
                const sessionId = tradingSessionService.getCurrentSessionId()
                if (sessionId) {
                  // Get market decimals to convert to human-readable format
                  const market = await marketService.getMarket(marketId)
                  if (market) {
                    const fillPriceHuman = new Decimal(order.price_fill)
                      .div(10 ** market.quote.decimals)
                      .toString()
                    const fillQtyHuman = new Decimal(order.filled_quantity)
                      .div(10 ** market.base.decimals)
                      .toString()
                    await tradingSessionService.updateSessionPnL(sessionId, fillPriceHuman, fillQtyHuman)
                  }
                }
              }
            }
          }
        } catch (error) {
          // Order might not exist anymore, skip silently
          console.warn(`[TradingEngine] Could not check order ${trade.orderId}:`, error)
        }
      }
    } catch (error) {
      console.error('[TradingEngine] Error syncing pending trade statuses:', error)
    }
  }

  /**
   * Get today's date as YYYY-MM-DD string
   */
  private getTodayDateString(): string {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  }

  /**
   * Get midnight timestamp for next day (for pause resume)
   */
  private getMidnightTimestamp(): number {
    const now = new Date()
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0)
    return midnight.getTime()
  }

  /**
   * Check if trading is paused due to max daily loss
   */
  private isTradingPaused(config: StrategyConfig): boolean {
    if (!config.riskManagement?.maxDailyLossEnabled) {
      return false
    }

    if (!config.dailyPnL) {
      return false
    }

    const today = this.getTodayDateString()

    // Reset daily P&L if it's a new day
    if (config.dailyPnL.date !== today) {
      return false // New day, not paused
    }

    // Check if explicitly paused
    if (config.dailyPnL.pausedUntil && Date.now() < config.dailyPnL.pausedUntil) {
      console.log('[TradingEngine] Trading paused until:', new Date(config.dailyPnL.pausedUntil).toLocaleTimeString())
      return true
    }

    return false
  }

  /**
   * Check and cancel orders that have exceeded the timeout
   */
  private async checkOrderTimeouts(
    marketId: string,
    config: StrategyConfig,
    ownerAddress: string
  ): Promise<number> {
    // Check if order timeout is enabled
    if (!config.riskManagement?.orderTimeoutEnabled || !config.riskManagement?.orderTimeoutMinutes) {
      return 0
    }

    const timeoutMs = config.riskManagement.orderTimeoutMinutes * 60 * 1000
    const cutoffTime = Date.now() - timeoutMs
    let cancelledCount = 0

    try {
      const openOrders = await orderService.getOpenOrders(marketId, ownerAddress)

      for (const order of openOrders) {
        // Check if order has exceeded timeout
        if (order.created_at && order.created_at < cutoffTime) {
          try {
            await orderService.cancelOrder(order.order_id, marketId, ownerAddress)
            cancelledCount++
            console.log(`[TradingEngine] Order timeout: Cancelled order ${order.order_id} (age: ${Math.floor((Date.now() - order.created_at) / 60000)} min)`)

            // Update trade record to show cancelled status
            await tradeHistoryService.updateTradeByOrderId(order.order_id, {
              status: 'cancelled',
              success: false,
            })
          } catch (error) {
            console.error(`[TradingEngine] Order timeout: Failed to cancel order ${order.order_id}:`, error)
          }
        }
      }

      if (cancelledCount > 0) {
        this.emitStatus(`Cancelled ${cancelledCount} order(s) due to timeout`, 'warning')
      }
    } catch (error) {
      console.error('[TradingEngine] Error checking order timeouts:', error)
    }

    return cancelledCount
  }

  /**
   * Calculate realized P&L from a filled sell order
   */
  private calculateRealizedPnL(
    order: Order,
    market: Market,
    config: StrategyConfig
  ): number {
    // Only calculate for sell orders
    if (order.side !== OrderSide.Sell) {
      return 0
    }

    // Need average buy price to calculate P&L
    if (!config.averageBuyPrice || config.averageBuyPrice === '0') {
      return 0
    }

    // Get the fill price (use price_fill if available, otherwise use order price)
    const fillPriceScaled = order.price_fill && order.price_fill !== '0'
      ? new Decimal(order.price_fill)
      : new Decimal(order.price)
    const fillPriceHuman = fillPriceScaled.div(10 ** market.quote.decimals)

    // Get the filled quantity
    const filledQuantityScaled = new Decimal(order.filled_quantity || '0')
    const filledQuantityHuman = filledQuantityScaled.div(10 ** market.base.decimals)

    if (filledQuantityHuman.lte(0)) {
      return 0
    }

    // Calculate P&L: (sellPrice - avgBuyPrice) * quantity
    const avgBuyPrice = new Decimal(config.averageBuyPrice)
    const pnl = fillPriceHuman.minus(avgBuyPrice).mul(filledQuantityHuman)

    console.log('[TradingEngine] Calculated P&L for sell order:', {
      orderId: order.order_id,
      fillPrice: fillPriceHuman.toString(),
      avgBuyPrice: avgBuyPrice.toString(),
      quantity: filledQuantityHuman.toString(),
      pnl: pnl.toString()
    })

    return pnl.toNumber()
  }

  /**
   * Update daily P&L tracking when a sell order fills
   */
  private async updateDailyPnL(
    marketId: string,
    pnlChange: number,
    config: StrategyConfig
  ): Promise<StrategyConfig> {
    if (!config.riskManagement?.maxDailyLossEnabled) {
      return config
    }

    const today = this.getTodayDateString()
    const updatedConfig = { ...config }

    // Initialize or reset daily P&L
    if (!updatedConfig.dailyPnL || updatedConfig.dailyPnL.date !== today) {
      updatedConfig.dailyPnL = {
        date: today,
        realizedPnL: 0,
      }
    }

    // Update P&L
    updatedConfig.dailyPnL.realizedPnL += pnlChange

    console.log('[TradingEngine] Updated daily P&L:', {
      date: today,
      pnlChange,
      totalPnL: updatedConfig.dailyPnL.realizedPnL,
      maxLoss: config.riskManagement.maxDailyLossUsd
    })

    // Check if max daily loss is exceeded
    if (updatedConfig.dailyPnL.realizedPnL < -config.riskManagement.maxDailyLossUsd) {
      updatedConfig.dailyPnL.pausedUntil = this.getMidnightTimestamp()
      console.log('[TradingEngine] MAX DAILY LOSS EXCEEDED! Trading paused until:', new Date(updatedConfig.dailyPnL.pausedUntil).toLocaleString())
      this.emitStatus(`Max daily loss ($${config.riskManagement.maxDailyLossUsd}) exceeded! Trading paused until midnight.`, 'error')
    }

    // Persist to database
    await db.strategyConfigs.update(marketId, {
      config: updatedConfig,
      updatedAt: Date.now(),
    })

    return updatedConfig
  }
}

export const tradingEngine = new TradingEngine()

