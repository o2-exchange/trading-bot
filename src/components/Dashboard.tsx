import { useState, useEffect, useRef, useCallback } from 'react'
import { walletService } from '../services/walletService'
import { sessionService } from '../services/sessionService'
import { tradingEngine } from '../services/tradingEngine'
import { tradingAccountService } from '../services/tradingAccountService'
import { marketService } from '../services/marketService'
import { authFlowService } from '../services/authFlowService'
import { tradingSessionService } from '../services/tradingSessionService'
import { useToast } from './ToastProvider'
import AuthFlowOverlay from './AuthFlowOverlay'
import TradingAccount from './TradingAccount'
import EligibilityCheck from './EligibilityCheck'
import MarketSelector from './MarketSelector'
import StrategyConfig from './StrategyConfig'
import OrderHistory from './OrderHistory'
import TradeHistory from './TradeHistory'
import Balances from './Balances'
import TradeConsole from './TradeConsole'
import CompetitionPanel from './CompetitionPanel'
import WelcomeModal from './WelcomeModal'
import DepositDialog from './DepositDialog'
import ConnectWalletDialog from './ConnectWalletDialog'
import { balanceService } from '../services/balanceService'
import { TradingAccountBalances } from '../types/tradingAccount'
import { filterMarkets } from '../utils/marketFilters'
import { db } from '../services/dbService'
import './Dashboard.css'

interface DashboardProps {
  isWalletConnected: boolean
  onDisconnect: () => void
}

export default function Dashboard({ isWalletConnected, onDisconnect }: DashboardProps) {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'orders' | 'trades'>('dashboard')
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [tradingAccount, setTradingAccount] = useState<any>(null)
  const [isEligible, setIsEligible] = useState<boolean | null>(null)
  const [isTrading, setIsTrading] = useState(false)
  const [hasResumableSession, setHasResumableSession] = useState(false)
  const [markets, setMarkets] = useState<any[]>([])
  const [balances, setBalances] = useState<TradingAccountBalances | null>(null)
  const [balancesLoading, setBalancesLoading] = useState(false)
  const [showStrategyRecommendation, setShowStrategyRecommendation] = useState(false)
  const [showWelcomeModal, setShowWelcomeModal] = useState(false)
  const [showDepositDialog, setShowDepositDialog] = useState(false)
  const [showConnectWalletDialog, setShowConnectWalletDialog] = useState(false)
  const [authReady, setAuthReady] = useState(false)
  const [authState, setAuthState] = useState<string>('idle')
  const { addToast } = useToast()
  const strategyCreateNewRef = useRef<(() => void) | null>(null)
  const strategyImportRef = useRef<(() => void) | null>(null)

  // Reset auth state when wallet disconnects
  useEffect(() => {
    if (!isWalletConnected) {
      setAuthReady(false)
      setAuthState('idle')
      setWalletAddress(null)
      setTradingAccount(null)
      setIsEligible(null)
      setBalances(null)
      setHasResumableSession(false)
      // Reset auth flow service
      authFlowService.reset()
    }
  }, [isWalletConnected])

  // Fetch data when auth flow is ready (no duplicate initialization)
  useEffect(() => {
    const loadData = async () => {
      try {
        const wallet = walletService.getConnectedWallet()
        if (!wallet) {
          return
        }

        // Get wallet address
        const walletAddressString = typeof wallet.address === 'string' 
          ? wallet.address 
          : (wallet.address as any)?.toString?.() || String(wallet.address)
        setWalletAddress(walletAddressString)

        const normalizedAddress = walletAddressString.toLowerCase()

        // Get trading account from store or fetch if needed
        const account = await tradingAccountService.getTradingAccount(normalizedAddress)
        if (account) {
          setTradingAccount(account)
          // Initialize trading engine with account
          tradingEngine.initialize(normalizedAddress, account.id)
        }

        // Fetch markets (uses cache - auth flow already fetched)
        const marketsList = await marketService.fetchMarkets()
        setMarkets(filterMarkets(marketsList))

        // Fetch balances if we have trading account and markets
        if (account && marketsList.length > 0) {
          setBalancesLoading(true)
          try {
            const accountBalances = await balanceService.getAllBalances(
              marketsList,
              account.id,
              walletAddressString
            )
            setBalances(accountBalances)
          } catch (error) {
            console.error('Failed to fetch balances', error)
          } finally {
            setBalancesLoading(false)
          }
        }

        // Check for resumable trading session
        const resumableSession = await tradingSessionService.getResumableSession(normalizedAddress)
        setHasResumableSession(!!resumableSession)
      } catch (error: any) {
        console.error('Failed to load dashboard data', error)
      }
    }

    // Only load data when auth flow is ready
    const unsubscribe = authFlowService.subscribe((state) => {
      if (state.state === 'ready') {
        loadData()
        // Update eligibility from auth flow state
        setIsEligible(state.isWhitelisted ?? false)
      }
    })

    // Load immediately if already ready
    const currentState = authFlowService.getState()
    if (currentState.state === 'ready') {
      loadData()
      setIsEligible(currentState.isWhitelisted ?? false)
    }

    return unsubscribe
  }, [])

  // Check for active strategies to show recommendation banner
  useEffect(() => {
    const checkStrategies = async () => {
      if (isTrading) {
        setShowStrategyRecommendation(false)
        return
      }

      const allConfigs = await db.strategyConfigs.toArray()
      const activeConfigs = allConfigs.filter((config) => config.isActive === true)
      setShowStrategyRecommendation(activeConfigs.length === 0)
    }

    checkStrategies()

    // Check periodically when not trading (every 2 seconds)
    const interval = setInterval(() => {
      if (!isTrading) {
        checkStrategies()
      }
    }, 2000)

    // Also check when window regains focus
    const handleFocus = () => {
      if (!isTrading) {
        checkStrategies()
      }
    }
    window.addEventListener('focus', handleFocus)

    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', handleFocus)
    }
  }, [isTrading])

  // Subscribe to trading engine status updates when trading is active
  useEffect(() => {
    if (!isTrading) return

    // Subscribe to trading engine status updates
    const unsubscribe = tradingEngine.onStatus((message, type) => {
      console.log(`[TradingEngine] ${type}:`, message)
      // Show status messages as toasts
      addToast(message, type)
    })

    return unsubscribe
  }, [isTrading, addToast])

  // Subscribe to trade completion for balance updates
  useEffect(() => {
    if (!isTrading || !tradingAccount || !markets.length || !walletAddress) return

    const refreshBalances = async () => {
      // Silently update balances without showing loading state
      try {
        const accountBalances = await balanceService.getAllBalances(
          markets,
          tradingAccount.id,
          walletAddress
        )
        setBalances(accountBalances)
      } catch (error) {
        console.error('Failed to refresh balances after trade', error)
      }
    }

    const unsubscribe = tradingEngine.onTradeComplete(() => {
      refreshBalances()
    })

    return unsubscribe
  }, [isTrading, tradingAccount, markets, walletAddress])

  const handleStartTrading = async (resumeSession: boolean = false) => {
    if (!walletAddress || !tradingAccount) {
      addToast('Wallet or trading account not available', 'error')
      return
    }

    // Auth flow should have already created the session
    // Just verify it exists
    const normalizedAddress = walletAddress.toLowerCase()
    const session = await sessionService.getActiveSession(normalizedAddress)
    if (!session) {
      addToast('Session not ready. Please complete authentication.', 'error')
      return
    }

    // Check for active strategies
    const allConfigs = await db.strategyConfigs.toArray()
    const activeConfigs = allConfigs.filter((config) => config.isActive === true)

    if (activeConfigs.length === 0) {
      addToast('Please create and activate a strategy in the Strategy Configuration section first.', 'error')
      return
    }

    try {
      await tradingEngine.start({ resumeSession })
      setIsTrading(true)
      setHasResumableSession(false) // Clear resumable state since we're now trading
      addToast(resumeSession ? 'Trading session resumed' : 'New trading session started', 'success')
    } catch (error: any) {
      addToast(`Failed to start trading: ${error.message}`, 'error')
    }
  }

  const handleStopTrading = () => {
    tradingEngine.stop()
    setIsTrading(false)
    setHasResumableSession(true) // Session is now paused and can be resumed
    addToast('Trading stopped', 'info')
  }

  const handleDisconnect = async () => {
    await walletService.disconnect()
    onDisconnect()
  }

  const [copied, setCopied] = useState(false)
  const [copiedAccountField, setCopiedAccountField] = useState<string | null>(null)

  const handleCopyAddress = async () => {
    if (walletAddress) {
      await navigator.clipboard.writeText(walletAddress)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleCopyAccountField = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedAccountField(field)
      addToast('Copied to clipboard', 'success')
      setTimeout(() => setCopiedAccountField(null), 2000)
    } catch (error) {
      addToast('Failed to copy', 'error')
    }
  }

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  // Get descriptive message based on auth flow state
  const getAuthStateMessage = (state: string): string => {
    switch (state) {
      case 'idle':
        return 'Initializing...'
      case 'checkingSituation':
        return 'Checking eligibility...'
      case 'checkingTerms':
        return 'Checking terms...'
      case 'awaitingTerms':
        return 'Accept terms to continue'
      case 'verifyingAccessQueue':
        return 'Verifying access...'
      case 'displayingAccessQueue':
        return 'In access queue'
      case 'awaitingInvitation':
        return 'Enter invitation code'
      case 'creatingSession':
        return 'Awaiting signature...'
      case 'awaitingWelcome':
        return 'Almost ready...'
      case 'error':
        return 'Error - retry'
      default:
        return 'Setting up...'
    }
  }

  // Callbacks for auth flow overlay - wrapped in useCallback to prevent infinite re-renders
  const handleAuthReady = useCallback(() => {
    setAuthReady(true)
  }, [])

  const handleAuthStateChange = useCallback((state: string, isWhitelisted: boolean | null) => {
    setAuthState(state)
    if (isWhitelisted !== null) {
      setIsEligible(isWhitelisted)
    }
    // If user dismissed the invitation/queue dialog, treat as "ready but not whitelisted"
    // This allows them to browse the dashboard without seeing "Setting up..." forever
    if (state === 'dismissed') {
      setAuthReady(true)
      setIsEligible(false)
    }
  }, [])

  return (
    <div className="dashboard">
      {/* Non-blocking auth flow overlay - only render when wallet is connected */}
      {isWalletConnected && (
        <AuthFlowOverlay
          onAuthReady={handleAuthReady}
          onAuthStateChange={handleAuthStateChange}
        />
      )}

      {/* Connect Wallet Dialog */}
      {showConnectWalletDialog && (
        <ConnectWalletDialog onClose={() => setShowConnectWalletDialog(false)} />
      )}

      <div className="dashboard-header">
          <h1>o2 Trading Bot <span className="alpha-badge">Alpha</span></h1>
          <div className="header-tabs">
            <button
              className={activeTab === 'dashboard' ? 'active' : ''}
              onClick={() => setActiveTab('dashboard')}
            >
              Dashboard
            </button>
            <button
              className={activeTab === 'orders' ? 'active' : ''}
              onClick={() => setActiveTab('orders')}
            >
              Orders
            </button>
            <button
              className={activeTab === 'trades' ? 'active' : ''}
              onClick={() => setActiveTab('trades')}
            >
              Trades
            </button>
          </div>
          <div className="header-actions">
            <button
              className="help-button"
              onClick={() => setShowWelcomeModal(true)}
              title="View tutorial"
            >
              ?
            </button>
            {isWalletConnected ? (
              walletAddress ? (
                <>
                  <button className="wallet-chip" onClick={handleCopyAddress} title={walletAddress}>
                    <span className="wallet-dot"></span>
                    <span className="wallet-address-text">{formatAddress(walletAddress)}</span>
                    <span className="copy-icon">{copied ? '✓' : '⧉'}</span>
                  </button>
                  <button onClick={handleDisconnect} className="disconnect-button">
                    Disconnect
                  </button>
                </>
              ) : (
                <button className="wallet-chip connecting" disabled>
                  <span className="wallet-dot connecting"></span>
                  <span className="wallet-address-text">Connecting...</span>
                </button>
              )
            ) : (
              <button
                className="connect-wallet-header-button"
                onClick={() => setShowConnectWalletDialog(true)}
              >
                Connect Wallet
              </button>
            )}
          </div>
        </div>

      <div className="dashboard-content">
        {/* Dashboard tab - always mounted to preserve TradeConsole state */}
        <div className="tab-panel" style={{ display: activeTab === 'dashboard' ? 'block' : 'none' }}>
          <CompetitionPanel walletAddress={walletAddress} />
          <div className="dashboard-main">
            <div className="dashboard-left-column">
              <div className="controls-section">
                <TradingAccount />

                <div className="trading-controls">
                  {isWalletConnected && isEligible === false && (
                    <div className="not-whitelisted-banner">
                      <span className="not-whitelisted-text">
                        Not whitelisted to trade
                      </span>
                    </div>
                  )}
                  {isWalletConnected && showStrategyRecommendation && isEligible !== false && authReady && (
                    <div className="strategy-recommendation-banner">
                      <span className="recommendation-text">
                        No active strategy configured. Please create and activate a strategy in the Strategy Configuration section below before starting trading.
                      </span>
                    </div>
                  )}
                  {!isWalletConnected ? (
                    <button
                      className="start-button connect-wallet-variant"
                      onClick={() => setShowConnectWalletDialog(true)}
                    >
                      Connect Wallet to Trade
                    </button>
                  ) : authState === 'error' ? (
                    <button
                      className="start-button error-retry"
                      onClick={() => authFlowService.startFlow()}
                    >
                      Error - Click to Retry
                    </button>
                  ) : !authReady ? (
                    <button className="start-button" disabled>
                      <span className="auth-loading-indicator"></span>
                      {getAuthStateMessage(authState)}
                    </button>
                  ) : !isTrading ? (
                    hasResumableSession ? (
                      <div className="trading-buttons-group">
                        <button
                          onClick={() => handleStartTrading(true)}
                          className="start-button resume-button"
                          disabled={isEligible === false}
                        >
                          Resume Session
                        </button>
                        <button
                          onClick={() => handleStartTrading(false)}
                          className="start-button new-session-button"
                          disabled={isEligible === false}
                        >
                          New Session
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleStartTrading(false)}
                        className="start-button"
                        disabled={isEligible === false}
                      >
                        Start Trading
                      </button>
                    )
                  ) : (
                    <button onClick={handleStopTrading} className="stop-button">
                      Stop Trading
                    </button>
                  )}
                </div>

                <TradeConsole isTrading={isTrading} onViewOrders={() => setActiveTab('orders')} />
              </div>

              <div className="markets-section">
                <div className="section-header">
                  <h2>Available Markets</h2>
                </div>
                <div className="section-content">
                  <MarketSelector markets={markets} />
                </div>
              </div>
            </div>

            <div className="dashboard-right-column">
              <div className="balances-section">
                <div className="section-header">
                  <h2>Balances</h2>
                  <div className="balances-header-right">
                    {tradingAccount && (
                      <div className="account-ids">
                        <div className="account-id-item">
                          <span className="account-id-label">o2 Account:</span>
                          <span
                            className="account-id-text clickable"
                            onClick={() => handleCopyAccountField(tradingAccount.id, 'account')}
                            title="Click to copy o2 Account ID"
                          >
                            {formatAddress(tradingAccount.id)}
                            <svg className="copy-icon-inline" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              {copiedAccountField === 'account' ? (
                                <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round"/>
                              ) : (
                                <>
                                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                </>
                              )}
                            </svg>
                          </span>
                        </div>
                        <div className="account-id-item">
                          <span className="account-id-label">Wallet:</span>
                          <span
                            className="account-id-text clickable"
                            onClick={() => handleCopyAccountField(tradingAccount.ownerAddress, 'owner')}
                            title="Click to copy Connected Wallet"
                          >
                            {formatAddress(tradingAccount.ownerAddress)}
                            <svg className="copy-icon-inline" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              {copiedAccountField === 'owner' ? (
                                <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round"/>
                              ) : (
                                <>
                                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                </>
                              )}
                            </svg>
                          </span>
                        </div>
                      </div>
                    )}
                    <button
                      className="deposit-link"
                      onClick={() => window.open('https://o2.app', '_blank')}
                    >
                      Deposit Funds on o2.app
                    </button>
                  </div>
                </div>
                <div className="section-content">
                  <Balances balances={balances} loading={balancesLoading} />
                </div>
              </div>

              <div className="strategy-settings-section">
                <div className="section-header">
                  <h2>Strategy Configuration</h2>
                  <div className="section-header-actions">
                    <button
                      className="import-strategy-button"
                      onClick={() => strategyImportRef.current?.()}
                    >
                      Import Strategy
                    </button>
                    <button
                      className="create-strategy-button"
                      onClick={() => strategyCreateNewRef.current?.()}
                    >
                      Create New Strategy
                    </button>
                  </div>
                </div>
                <div className="section-content">
                  <StrategyConfig markets={markets} createNewRef={strategyCreateNewRef} importRef={strategyImportRef} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {activeTab === 'orders' && (
          <OrderHistory />
        )}

        {activeTab === 'trades' && (
          <TradeHistory />
        )}
      </div>

      {/* Welcome Modal - can be reopened via Help button */}
      {showWelcomeModal && (
        <WelcomeModal
          isOpen={true}
          onClose={() => setShowWelcomeModal(false)}
        />
      )}

      {/* Deposit Dialog */}
      <DepositDialog
        isOpen={showDepositDialog}
        onClose={() => {
          setShowDepositDialog(false)
          // Refresh balances after deposit closes
          if (tradingAccount && markets.length > 0 && walletAddress) {
            balanceService.clearCache()
            balanceService.getAllBalances(markets, tradingAccount.id, walletAddress)
              .then(setBalances)
              .catch(console.error)
          }
        }}
        tradingAccountId={tradingAccount?.id}
      />
    </div>
  )
}

