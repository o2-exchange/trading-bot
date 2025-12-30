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
}

export default function TradeConsole({ isTrading, onViewOrders }: TradeConsoleProps) {
  const [consoleCollapsed, setConsoleCollapsed] = useState(false)
  const [consoleMessages, setConsoleMessages] = useState<ConsoleMessage[]>([])
  const [context, setContext] = useState<TradingContext | null>(null)
  const [countdown, setCountdown] = useState<number>(0)
  const [sessionRestored, setSessionRestored] = useState(false)
  const consoleRef = useRef<HTMLDivElement>(null)

  // Track current session ID to detect new sessions
  const currentSessionIdRef = useRef<string | null>(null)

  // Restore session data on mount (before trading starts)
  useEffect(() => {
    if (sessionRestored) return

    const restoreSession = async () => {
      try {
        const wallet = walletService.getConnectedWallet()
        if (!wallet) return

        const walletAddress = typeof wallet.address === 'string'
          ? wallet.address.toLowerCase()
          : (wallet.address as any)?.toString?.().toLowerCase() || String(wallet.address).toLowerCase()

        const session = await tradingSessionService.getResumableSession(walletAddress)
        if (session) {
          currentSessionIdRef.current = session.id

          // Restore console messages
          if (session.consoleMessages && session.consoleMessages.length > 0) {
            setConsoleMessages(session.consoleMessages)
          }

          // Restore context from session
          if (session.lastContext) {
            const restoredContext: TradingContext = {
              pair: session.marketPair,
              baseBalance: session.lastContext.baseBalance ? `${session.lastContext.baseBalance} ${session.marketPair.split('/')[0]}` : '-- --',
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
              tradeCount: session.tradeCount
            }
            setContext(restoredContext)
          } else {
            // Even without lastContext, restore session metrics
            setContext({
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
              tradeCount: session.tradeCount
            })
          }

          console.log('[TradeConsole] Restored session:', session.id, 'with', session.consoleMessages?.length || 0, 'messages')
        }
      } catch (error) {
        console.error('[TradeConsole] Failed to restore session:', error)
      } finally {
        setSessionRestored(true)
      }
    }

    restoreSession()
  }, [sessionRestored])

  // Subscribe to session updates to detect new session creation
  useEffect(() => {
    const unsubscribe = tradingSessionService.onSessionUpdate((session) => {
      if (session) {
        // Check if this is a NEW session (different ID than what we had)
        const isNewSession = currentSessionIdRef.current !== null &&
                             currentSessionIdRef.current !== session.id

        if (isNewSession) {
          // Clear console and add "new session" message
          setConsoleMessages([{
            message: 'New trading session started',
            type: 'info',
            timestamp: Date.now()
          }])

          // Reset context with fresh session stats (Volume, P&L, Fees, Trades = 0)
          setContext(prev => ({
            pair: session.marketPair || prev?.pair || '',
            baseBalance: prev?.baseBalance || '-- --',
            quoteBalance: prev?.quoteBalance || '$--',
            lastBuyPrice: prev?.lastBuyPrice || null,
            currentPrice: prev?.currentPrice || null,
            openBuyOrders: prev?.openBuyOrders || 0,
            openSellOrders: prev?.openSellOrders || 0,
            pendingSellOrder: prev?.pendingSellOrder || null,
            profitProtectionEnabled: prev?.profitProtectionEnabled ?? true,
            nextRunIn: prev?.nextRunIn || 0,
            sessionId: session.id,
            totalVolume: 0,
            totalFees: 0,
            realizedPnL: 0,
            tradeCount: 0
          }))

          console.log('[TradeConsole] New session detected, reset stats and cleared console')
        }

        // Always update the ref to current session
        currentSessionIdRef.current = session.id
      }
    })

    return unsubscribe
  }, [])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight
    }
  }, [consoleMessages])

  // Countdown timer
  useEffect(() => {
    if (!isTrading || !context?.nextRunIn) {
      setCountdown(0)
      return
    }

    setCountdown(context.nextRunIn)
    const interval = setInterval(() => {
      setCountdown(prev => Math.max(0, prev - 1))
    }, 1000)

    return () => clearInterval(interval)
  }, [isTrading, context?.nextRunIn])

  useEffect(() => {
    if (!isTrading) {
      // Don't clear messages/context when trading stops - keep them visible
      return
    }

    // Subscribe to status updates
    const unsubscribeStatus = tradingEngine.onStatus((message, type) => {
      setConsoleMessages((prev) => {
        const newMessages = [...prev, { message, type, timestamp: Date.now() }]
        // Keep only last 50 messages
        return newMessages.slice(-50)
      })
    })

    // Subscribe to context updates
    const unsubscribeContext = tradingEngine.onContext((ctx) => {
      setContext(ctx)
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

  return (
    <div className={`trade-console ${consoleCollapsed ? 'collapsed' : ''}`}>
      <div
        className="trade-console-header"
        onClick={() => setConsoleCollapsed(!consoleCollapsed)}
      >
        <span className="console-title">Trade Execution Console</span>
        <div className="console-header-right">
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
          {/* Status Dashboard - show when we have context data */}
          {context && (
            <div className="console-dashboard">
              <div className="dashboard-row">
                <div className="dashboard-item">
                  <span className="dashboard-label">Market</span>
                  <span className="dashboard-value highlight">{context.pair}</span>
                </div>
                <div className="dashboard-item">
                  <span className="dashboard-label">Price</span>
                  <span className="dashboard-value">{context.currentPrice || '--'}</span>
                </div>
              </div>

              <div className="dashboard-row session-metrics">
                <div className="dashboard-item">
                  <span className="dashboard-label">Volume</span>
                  <span className="dashboard-value">${context.totalVolume?.toFixed(2) || '0.00'}</span>
                </div>
                <div className="dashboard-item">
                  <span className="dashboard-label">P&L</span>
                  <span className={`dashboard-value ${(context.realizedPnL || 0) >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
                    {(context.realizedPnL || 0) >= 0 ? '+' : ''}${(context.realizedPnL || 0).toFixed(2)}
                  </span>
                </div>
                <div className="dashboard-item">
                  <span className="dashboard-label">Fees</span>
                  <span className="dashboard-value fee">${context.totalFees?.toFixed(4) || '0.0000'}</span>
                </div>
                <div className="dashboard-item">
                  <span className="dashboard-label">Trades</span>
                  <span className="dashboard-value">{context.tradeCount || 0}</span>
                </div>
              </div>

            </div>
          )}

          {/* Pending Sell Order Strip - Fixed at top */}
          {context?.pendingSellOrder && (
            <div className="pending-order-strip">
              <span className="pending-strip-text">
                Sell order waiting: {context.pendingSellOrder.quantity} {context.pair?.split('/')[0]} @ ${context.pendingSellOrder.price}
              </span>
              {onViewOrders && (
                <button className="view-orders-btn" onClick={onViewOrders}>
                  View Orders
                </button>
              )}
            </div>
          )}

          {/* Console Messages */}
          <div className="trade-console-content" ref={consoleRef}>
            {consoleMessages.length > 0 ? (
              consoleMessages.map((log, index) => (
                <div key={index} className={`console-line console-${log.type}`}>
                  <span className="console-timestamp">
                    {formatTime(log.timestamp)}
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
