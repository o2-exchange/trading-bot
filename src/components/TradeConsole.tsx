import { useState, useEffect, useRef } from 'react'
import { tradingEngine, TradingContext } from '../services/tradingEngine'
import { tradingSessionService } from '../services/tradingSessionService'
import { walletService } from '../services/walletService'
import './TradeConsole.css'

interface TradeConsoleProps {
  isTrading: boolean
  onViewOrders?: () => void
}

interface ConsoleMessage {
  message: string
  type: string
  timestamp: number
  verbosity?: 'simple' | 'debug'
}

export default function TradeConsole({ isTrading, onViewOrders }: TradeConsoleProps) {
  const [consoleCollapsed, setConsoleCollapsed] = useState(false)
  const [consoleMessages, setConsoleMessages] = useState<ConsoleMessage[]>([])
  const [contexts, setContexts] = useState<Map<string, TradingContext>>(new Map())
  const [countdown, setCountdown] = useState<number>(0)
  const [sessionRestored, setSessionRestored] = useState(false)
  const [consoleMode, setConsoleMode] = useState<'simple' | 'debug'>('simple')
  const consoleRef = useRef<HTMLDivElement>(null)


  // Helper to get first context (for countdown and pending order display)
  const firstContext = contexts.size > 0 ? Array.from(contexts.values())[0] : null

  // Restore ALL session data on mount (before trading starts) - supports multi-market
  useEffect(() => {
    if (sessionRestored) return

    const restoreSessions = async () => {
      try {
        const wallet = walletService.getConnectedWallet()
        if (!wallet) return

        const walletAddress = typeof wallet.address === 'string'
          ? wallet.address.toLowerCase()
          : (wallet.address as any)?.toString?.().toLowerCase() || String(wallet.address).toLowerCase()

        // Get ALL resumable sessions (not just one) to support multi-market
        const sessions = await tradingSessionService.getAllResumableSessions(walletAddress)

        if (sessions.length > 0) {
          // Restore console messages from most recent session
          const mostRecentSession = sessions.sort((a, b) => b.updatedAt - a.updatedAt)[0]
          if (mostRecentSession.consoleMessages && mostRecentSession.consoleMessages.length > 0) {
            setConsoleMessages(mostRecentSession.consoleMessages)
          }

          // Build contexts Map from ALL sessions
          const restoredContexts = new Map<string, TradingContext>()

          for (const session of sessions) {
            const baseSymbol = session.marketPair.split('/')[0]
            const restoredContext: TradingContext = session.lastContext ? {
              pair: session.marketPair,
              baseBalance: session.lastContext.baseBalance ? `${session.lastContext.baseBalance} ${baseSymbol}` : '-- --',
              quoteBalance: session.lastContext.quoteBalance ? `$${session.lastContext.quoteBalance}` : '$--',
              lastBuyPrice: session.lastContext.lastBuyPrice ? `$${session.lastContext.lastBuyPrice}` : null,
              currentPrice: session.lastContext.currentPrice ? `$${session.lastContext.currentPrice}` : null,
              openBuyOrders: 0,
              openSellOrders: 0,
              pendingSellOrder: null,
              profitProtectionEnabled: true,
              nextRunIn: 0,
              sessionId: session.id,
              totalVolume: session.totalVolume,
              totalFees: session.totalFees,
              realizedPnL: session.realizedPnL,
              tradeCount: session.tradeCount,
              startingBaseBalance: session.startingBaseBalance ? `${session.startingBaseBalance} ${baseSymbol}` : null,
              startingQuoteBalance: session.startingQuoteBalance ? `$${session.startingQuoteBalance}` : null,
              strategyName: session.strategyName || null,
            } : {
              pair: session.marketPair,
              baseBalance: '-- --',
              quoteBalance: '$--',
              lastBuyPrice: null,
              currentPrice: null,
              openBuyOrders: 0,
              openSellOrders: 0,
              pendingSellOrder: null,
              profitProtectionEnabled: true,
              nextRunIn: 0,
              sessionId: session.id,
              totalVolume: session.totalVolume,
              totalFees: session.totalFees,
              realizedPnL: session.realizedPnL,
              tradeCount: session.tradeCount,
              startingBaseBalance: session.startingBaseBalance ? `${session.startingBaseBalance} ${baseSymbol}` : null,
              startingQuoteBalance: session.startingQuoteBalance ? `$${session.startingQuoteBalance}` : null,
              strategyName: session.strategyName || null,
            }
            restoredContexts.set(session.marketPair, restoredContext)
          }

          setContexts(restoredContexts)
          console.log('[TradeConsole] Restored', sessions.length, 'market session(s)')
        }
      } catch (error) {
        console.error('[TradeConsole] Failed to restore sessions:', error)
      } finally {
        setSessionRestored(true)
      }
    }

    restoreSessions()
  }, [sessionRestored])

  // NOTE: Session update listener removed - it was causing issues with multi-market support.
  // Each market now has its own session, and the trading engine handles session management.
  // Context updates come directly from tradingEngine.onMultiContext() which has all market data.

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight
    }
  }, [consoleMessages])

  // Countdown timer - use first context's nextRunIn
  useEffect(() => {
    if (!isTrading || !firstContext?.nextRunIn) {
      setCountdown(0)
      return
    }

    setCountdown(firstContext.nextRunIn)
    const interval = setInterval(() => {
      setCountdown(prev => Math.max(0, prev - 1))
    }, 1000)

    return () => clearInterval(interval)
  }, [isTrading, firstContext?.nextRunIn])

  useEffect(() => {
    if (!isTrading) {
      // Don't clear messages/context when trading stops - keep them visible
      return
    }

    // Subscribe to status updates
    const unsubscribeStatus = tradingEngine.onStatus((message, type, verbosity = 'simple') => {
      setConsoleMessages((prev) => {
        const newMessages = [...prev, { message, type, timestamp: Date.now(), verbosity }]
        // Keep only last 50 messages
        return newMessages.slice(-50)
      })
    })

    // Subscribe to multi-context updates (all markets)
    const unsubscribeContext = tradingEngine.onMultiContext((ctxMap) => {
      // Only update if there are actual changes to avoid unnecessary re-renders
      setContexts(prevContexts => {
        // If sizes differ, definitely update
        if (prevContexts.size !== ctxMap.size) {
          return new Map(ctxMap)
        }

        // Check if any values have changed
        let hasChanges = false
        for (const [key, newCtx] of ctxMap) {
          const prevCtx = prevContexts.get(key)
          if (!prevCtx) {
            hasChanges = true
            break
          }
          // Compare key fields that would affect display
          if (prevCtx.currentPrice !== newCtx.currentPrice ||
              prevCtx.baseBalance !== newCtx.baseBalance ||
              prevCtx.quoteBalance !== newCtx.quoteBalance ||
              prevCtx.totalVolume !== newCtx.totalVolume ||
              prevCtx.totalFees !== newCtx.totalFees ||
              prevCtx.realizedPnL !== newCtx.realizedPnL ||
              prevCtx.tradeCount !== newCtx.tradeCount ||
              prevCtx.nextRunIn !== newCtx.nextRunIn ||
              prevCtx.openBuyOrders !== newCtx.openBuyOrders ||
              prevCtx.openSellOrders !== newCtx.openSellOrders) {
            hasChanges = true
            break
          }
        }

        return hasChanges ? new Map(ctxMap) : prevContexts
      })
    })

    return () => {
      unsubscribeStatus()
      unsubscribeContext()
    }
  }, [isTrading])

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  // Get any pending sell orders from all contexts
  const pendingOrders = Array.from(contexts.values()).filter(ctx => ctx.pendingSellOrder)

  // Calculate balance change percentage based on total USD value
  const calculateBalanceChangePercent = (ctx: TradingContext): number | null => {
    if (!ctx.startingQuoteBalance || !ctx.quoteBalance) return null

    const startQuote = parseFloat(ctx.startingQuoteBalance.replace(/[$,]/g, ''))
    const currentQuote = parseFloat(ctx.quoteBalance.replace(/[$,]/g, ''))
    const startBase = parseFloat(ctx.startingBaseBalance?.split(' ')[0] || '0')
    const currentBase = parseFloat(ctx.baseBalance?.split(' ')[0] || '0')
    const price = parseFloat(ctx.currentPrice?.replace(/[$,]/g, '') || '0')

    if (startQuote === 0 && startBase === 0) return null

    // Calculate total USD value: quote + (base * price)
    const startTotal = startQuote + (startBase * price)
    const currentTotal = currentQuote + (currentBase * price)

    if (startTotal === 0) return null
    return ((currentTotal - startTotal) / startTotal) * 100
  }

  const formatBalanceChange = (ctx: TradingContext): string => {
    const percent = calculateBalanceChangePercent(ctx)
    if (percent === null) return '--'
    const sign = percent >= 0 ? '+' : ''
    return `${sign}${percent.toFixed(1)}%`
  }

  const getBalanceChangeClass = (ctx: TradingContext): string => {
    const percent = calculateBalanceChangePercent(ctx)
    if (percent === null) return ''
    return percent >= 0 ? 'positive' : 'negative'
  }

  // Download logs as JSON file
  const downloadLogs = () => {
    const logData = {
      exportedAt: new Date().toISOString(),
      mode: consoleMode,
      totalMessages: consoleMessages.length,
      contexts: Array.from(contexts.entries()).map(([pair, ctx]) => ({
        pair,
        sessionId: ctx.sessionId,
        totalVolume: ctx.totalVolume,
        totalFees: ctx.totalFees,
        realizedPnL: ctx.realizedPnL,
        tradeCount: ctx.tradeCount,
      })),
      messages: consoleMessages.map(msg => ({
        timestamp: new Date(msg.timestamp).toISOString(),
        type: msg.type,
        message: msg.message,
        verbosity: msg.verbosity || 'simple'
      }))
    }
    const blob = new Blob([JSON.stringify(logData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `trading-logs-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Get icon for message type
  const getMessageIcon = (type: string) => {
    switch (type) {
      case 'success': return '✓'
      case 'error': return '✕'
      case 'warning': return '⚠'
      default: return '→'
    }
  }

  return (
    <div className={`trade-console ${consoleCollapsed ? 'collapsed' : ''}`}>
      <div
        className="trade-console-header"
        onClick={() => setConsoleCollapsed(!consoleCollapsed)}
      >
        <span className="console-title">Trade Execution Console</span>
        <div className="console-header-right">
          <button
            className="console-download-btn"
            onClick={(e) => {
              e.stopPropagation()
              downloadLogs()
            }}
            title="Download logs as JSON"
          >
            ↓
          </button>
          <button
            className={`console-mode-toggle ${consoleMode}`}
            onClick={(e) => {
              e.stopPropagation()
              setConsoleMode(prev => prev === 'simple' ? 'debug' : 'simple')
            }}
            title={consoleMode === 'simple' ? 'Click for debug mode (more details)' : 'Click for simple mode (essential only)'}
          >
            {consoleMode === 'simple' ? 'Simple' : 'Debug'}
          </button>
          {isTrading && countdown > 0 && (
            <span className="console-countdown">
              Next: {countdown}s
            </span>
          )}
          <span className={`console-status ${isTrading ? 'active' : 'inactive'}`}>
            {isTrading ? 'LIVE' : 'OFF'}
          </span>
        </div>
      </div>

      {!consoleCollapsed && (
        <>
          {/* Multi-Market Status Dashboard */}
          {contexts.size > 0 && (
            <div className={`console-dashboard ${contexts.size > 1 ? 'multi-market' : ''}`}>
              {Array.from(contexts.values()).map((ctx) => {
                // Calculate total USD balance (base * price + quote)
                const currentBaseVal = parseFloat(ctx.baseBalance?.split(' ')[0] || '0')
                const currentQuoteVal = parseFloat(ctx.quoteBalance?.replace(/[$,]/g, '') || '0')
                const priceVal = parseFloat(ctx.currentPrice?.replace(/[$,]/g, '') || '0')
                const currentTotalUsd = (currentBaseVal * priceVal) + currentQuoteVal

                const startBaseVal = parseFloat(ctx.startingBaseBalance?.split(' ')[0] || '0')
                const startQuoteVal = parseFloat(ctx.startingQuoteBalance?.replace(/[$,]/g, '') || '0')
                const startTotalUsd = (startBaseVal * priceVal) + startQuoteVal

                return (
                <div key={ctx.pair} className="market-stats-card">
                  {/* Row 1: Market info */}
                  <div className="market-header">
                    <div className="market-info-item">
                      <span className="info-label">Market:</span>
                      <span className="info-value market-pair">{ctx.pair}</span>
                    </div>
                    <div className="market-info-item">
                      <span className="info-label">Price:</span>
                      <span className="info-value">{ctx.currentPrice || '--'}</span>
                    </div>
                    {ctx.strategyName && (
                      <div className="market-info-item">
                        <span className="info-label">Strategy:</span>
                        <span className="info-value strategy-value">{ctx.strategyName}</span>
                      </div>
                    )}
                  </div>

                  {/* Row 2: Balance comparison - hidden for now
                  <div className="balance-comparison">
                    <div className="balance-item starting">
                      <span className="balance-label">Starting</span>
                      <span className="balance-value">
                        {ctx.startingQuoteBalance ? `$${startTotalUsd.toFixed(2)}` : 'N/A'}
                      </span>
                    </div>
                    <div className="balance-arrow">→</div>
                    <div className="balance-item current">
                      <span className="balance-label">Current</span>
                      <span className="balance-value">${currentTotalUsd.toFixed(2)}</span>
                    </div>
                    <div className={`balance-change ${getBalanceChangeClass(ctx)}`}>
                      {formatBalanceChange(ctx)}
                    </div>
                  </div>
                  */}

                  {/* Row 3: Metrics */}
                  <div className="market-metrics">
                    <span className="metric">
                      <span className="metric-label">Vol</span>
                      <span className="metric-value">${ctx.totalVolume?.toFixed(2) || '0.00'}</span>
                    </span>
                    <span className="metric">
                      <span className="metric-label">P&L</span>
                      <span className={`metric-value ${(ctx.realizedPnL || 0) >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
                        {(ctx.realizedPnL || 0) >= 0 ? '+' : ''}${(ctx.realizedPnL || 0).toFixed(2)}
                      </span>
                    </span>
                    <span className="metric">
                      <span className="metric-label">Fees</span>
                      <span className="metric-value fee">${ctx.totalFees?.toFixed(4) || '0.0000'}</span>
                    </span>
                    <span className="metric">
                      <span className="metric-label">Trades</span>
                      <span className="metric-value">{ctx.tradeCount || 0}</span>
                    </span>
                  </div>
                </div>
              )})}
            </div>
          )}

          {/* Pending Sell Order Strips - show for all markets with pending orders */}
          {pendingOrders.map((ctx) => (
            <div key={`pending-${ctx.pair}`} className="pending-order-strip">
              <span className="pending-strip-text">
                {ctx.pair}: Sell order waiting: {ctx.pendingSellOrder!.quantity} {ctx.pair?.split('/')[0]} @ ${ctx.pendingSellOrder!.price}
              </span>
              {onViewOrders && (
                <button className="view-orders-btn" onClick={onViewOrders}>
                  View Orders
                </button>
              )}
            </div>
          ))}

          {/* Console Messages */}
          <div className="trade-console-content" ref={consoleRef}>
            {consoleMessages.length > 0 ? (
              consoleMessages
                .filter(log => consoleMode === 'debug' || log.verbosity !== 'debug')
                .map((log, index) => (
                <div key={index} className={`console-line console-${log.type} ${log.verbosity === 'debug' ? 'debug-msg' : ''}`}>
                  <span className="console-timestamp">
                    {formatTime(log.timestamp)}
                  </span>
                  <span className={`console-icon console-icon-${log.type}`}>
                    {getMessageIcon(log.type)}
                  </span>
                  <span className="console-message">{log.message}</span>
                </div>
              ))
            ) : (
              <div className="console-empty">
                {isTrading ? (
                  <>Starting trading engine...</>
                ) : (
                  <>Trading inactive. Click "Start Trading" to begin.</>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
