import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { walletService } from '../services/walletService'
import { sessionService } from '../services/sessionService'
import { tradingEngine } from '../services/tradingEngine'
import { tradingAccountService } from '../services/tradingAccountService'
import { marketService } from '../services/marketService'
import { authFlowService } from '../services/authFlowService'
import { tradingSessionService } from '../services/tradingSessionService'
import { orderService } from '../services/orderService'
import { useToast } from './ToastProvider'
import AuthFlowOverlay from './AuthFlowOverlay'
import TradingAccount from './TradingAccount'
import MarketSelector from './MarketSelector'
import StrategyConfig from './StrategyConfig'
import TradeHistory from './TradeHistory'
import Balances from './Balances'
import TradeConsole from './TradeConsole'
import CompetitionPanel from './CompetitionPanel'
import OpenOrdersPanel from './OpenOrdersPanel'
import WelcomeModal from './WelcomeModal'
import DepositDialog from './DepositDialog'
import ConnectWalletDialog from './ConnectWalletDialog'
import TutorialsPanel from './TutorialsPanel'
import LanguageSelector from './LanguageSelector'
import ReleaseNotesDialog from './ReleaseNotesDialog'
import { useVersionCheck } from '../hooks/useVersionCheck'
import { CURRENT_VERSION } from '../constants/releaseNotes'
import { balanceService } from '../services/balanceService'
import { TradingAccountBalances } from '../types/tradingAccount'
import { filterMarkets } from '../utils/marketFilters'
import { db } from '../services/dbService'
import { resetStrategyConfigs } from '../utils/clearUserStorage'
import './Dashboard.css'

interface DashboardProps {
  isWalletConnected: boolean
  onDisconnect: () => void
}

export default function Dashboard({ isWalletConnected, onDisconnect }: DashboardProps) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<'dashboard' | 'trades' | 'tutorials'>('dashboard')
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [tradingAccount, setTradingAccount] = useState<any>(null)
  const [isTrading, setIsTrading] = useState(false)
  const [hasResumableSession, setHasResumableSession] = useState(false)
  const [markets, setMarkets] = useState<any[]>([])
  const [balances, setBalances] = useState<TradingAccountBalances | null>(null)
  const [balancesLoading, setBalancesLoading] = useState(false)
  const [showStrategyRecommendation, setShowStrategyRecommendation] = useState(false)
  const [showWelcomeModal, setShowWelcomeModal] = useState(false)
  const [showDepositDialog, setShowDepositDialog] = useState(false)
  const [showConnectWalletDialog, setShowConnectWalletDialog] = useState(false)
  const [showNewSessionConfirm, setShowNewSessionConfirm] = useState(false)
  const [isCancellingOrders, setIsCancellingOrders] = useState(false)
  const [showReleaseNotes, setShowReleaseNotes] = useState(false)
  const [authReady, setAuthReady] = useState(false)
  const [authState, setAuthState] = useState<string>('idle')
  const { addToast } = useToast()
  const strategyCreateNewRef = useRef<(() => void) | null>(null)
  const strategyImportRef = useRef<(() => void) | null>(null)
  const { shouldShowReleaseNotes, markVersionAsSeen } = useVersionCheck(authReady)

  // Reset local UI state when wallet disconnects
  useEffect(() => {
    if (!isWalletConnected) {
      setAuthReady(false)
      setAuthState('idle')
      setWalletAddress(null)
      setTradingAccount(null)
      setBalances(null)
      setHasResumableSession(false)
      // DON'T reset auth flow service here - wagmi can briefly report disconnected
      // during signing which causes the welcome modal to disappear.
      // Let AuthFlowOverlay manage auth flow state. When wallet reconnects,
      // startFlow() will be called again if needed.
    }
  }, [isWalletConnected])

  // Subscribe to trading engine state changes (e.g., when all strategies are deactivated)
  useEffect(() => {
    const unsubscribe = tradingEngine.onTradingStateChange((isActive) => {
      setIsTrading(isActive)
      if (!isActive) {
        setHasResumableSession(true)
      }
    })
    return unsubscribe
  }, [])

  // Set wallet address immediately when wallet connects (don't wait for auth flow)
  // This ensures users can always see their address and disconnect, even if auth flow is stuck
  useEffect(() => {
    if (isWalletConnected) {
      const wallet = walletService.getConnectedWallet()
      if (wallet) {
        const address = typeof wallet.address === 'string'
          ? wallet.address
          : (wallet.address as any)?.toString?.() || String(wallet.address)
        setWalletAddress(address)
      }
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
      }
    })

    // Load immediately if already ready
    const currentState = authFlowService.getState()
    if (currentState.state === 'ready') {
      loadData()
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
    const unsubscribe = tradingEngine.onStatus((message, type, verbosity = 'simple') => {
      console.log(`[TradingEngine] ${type}:`, message)

      // Only show toast for successful order placements and fills
      // Skip debug messages, errors, warnings, and other info messages
      const isOrderMessage = message.includes('order placed') || message.includes('filled')
      const isSuccessOrInfo = type === 'success' || type === 'info'

      if (verbosity === 'simple' && isOrderMessage && isSuccessOrInfo) {
        addToast(message, type)
      }
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

  // Auto-show release notes when user visits after an update
  useEffect(() => {
    if (shouldShowReleaseNotes) {
      setShowReleaseNotes(true)
    }
  }, [shouldShowReleaseNotes])

  const handleStartTrading = async (resumeSession: boolean = false) => {
    if (!walletAddress || !tradingAccount) {
      addToast(t('errors.wallet_not_available'), 'error')
      return
    }

    // Auth flow should have already created the session
    // Just verify it exists
    const normalizedAddress = walletAddress.toLowerCase()
    const session = await sessionService.getActiveSession(normalizedAddress)
    if (!session) {
      addToast(t('trading.session_not_ready'), 'error')
      return
    }

    // Check for active strategies
    const allConfigs = await db.strategyConfigs.toArray()
    const activeConfigs = allConfigs.filter((config) => config.isActive === true)

    if (activeConfigs.length === 0) {
      addToast(t('trading.create_strategy_first'), 'error')
      return
    }

    try {
      await tradingEngine.start({ resumeSession })
      setIsTrading(true)
      setHasResumableSession(false) // Clear resumable state since we're now trading
      addToast(resumeSession ? t('trading.session_resumed') : t('trading.session_started'), 'success')
    } catch (error: any) {
      addToast(t('trading.start_failed', { message: error.message }), 'error')
    }
  }

  const handleStopTrading = () => {
    tradingEngine.stop()
    setIsTrading(false)
    setHasResumableSession(true) // Session is now paused and can be resumed
    addToast(t('trading.trading_stopped'), 'info')
  }

  const handleNewSessionClick = () => {
    setShowNewSessionConfirm(true)
  }

  const handleConfirmNewSession = async () => {
    if (walletAddress) {
      // Show progress indicator
      setIsCancellingOrders(true)

      // Cancel all open orders first
      try {
        const result = await orderService.cancelAllOpenOrders(walletAddress)
        if (result.cancelled > 0) {
          addToast(t('strategy.cancel_orders_dialog.cancelled_orders', { count: result.cancelled }), 'info')
        }
        if (result.failed > 0) {
          addToast(t('strategy.cancel_orders_dialog.failed_to_cancel', { count: result.failed }), 'warning')
        }
        // Trigger immediate refresh of OpenOrdersPanel
        window.dispatchEvent(new Event('refresh-orders'))
      } catch (error) {
        console.error('Failed to cancel open orders:', error)
        addToast(t('strategy.cancel_orders_dialog.failed_to_cancel', { count: 0 }), 'warning')
        // Still trigger refresh to show current state
        window.dispatchEvent(new Event('refresh-orders'))
      } finally {
        setIsCancellingOrders(false)
      }

      // Then clear old session data (proceed even if some orders failed)
      const session = await tradingSessionService.getResumableSession(walletAddress.toLowerCase())
      if (session) {
        await tradingSessionService.endSession(session.id)
      }

      // Reset strategy configs to clear averageBuyPrice and lastFillPrices
      await resetStrategyConfigs()
    }

    // Close dialog and clear the resumable session flag
    setShowNewSessionConfirm(false)
    setHasResumableSession(false)

    addToast(t('new_session.session_cleared'), 'info')
  }

  const handleCancelNewSession = () => {
    setShowNewSessionConfirm(false)
  }

  const handleDisconnect = async () => {
    await walletService.disconnect()
    onDisconnect()
  }

  const [copied, setCopied] = useState(false)
  const [copiedAccountField, setCopiedAccountField] = useState<string | null>(null)

  // Tab switch handler
  const handleTabSwitch = (newTab: 'dashboard' | 'trades' | 'tutorials') => {
    if (activeTab !== newTab) {
      setActiveTab(newTab)
    }
  }

  // Help button handler
  const handleHelpClick = () => {
    setShowWelcomeModal(true)
  }

  // Release notes dialog handlers
  const handleVersionClick = () => {
    setShowReleaseNotes(true)
  }

  const handleCloseReleaseNotes = () => {
    setShowReleaseNotes(false)
    markVersionAsSeen()
  }

  // Deposit dialog handler
  const handleDepositDialogOpen = () => {
    setShowDepositDialog(true)
  }

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
      addToast(t('common.copied_to_clipboard'), 'success')
      setTimeout(() => setCopiedAccountField(null), 2000)
    } catch (error) {
      addToast(t('common.failed_to_copy'), 'error')
    }
  }

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  // Get descriptive message based on auth flow state
  const getAuthStateMessage = (state: string): string => {
    switch (state) {
      case 'idle':
        return t('auth.initializing')
      case 'checkingSituation':
        return t('auth.checking_eligibility')
      case 'checkingTerms':
        return t('auth.checking_terms')
      case 'awaitingTerms':
        return t('auth.accept_terms_to_continue')
      case 'verifyingAccessQueue':
        return t('auth.verifying_access')
      case 'displayingAccessQueue':
        return t('auth.in_access_queue')
      case 'awaitingInvitation':
        return t('auth.enter_invitation_code')
      case 'awaitingSignature':
        return t('auth.sign_message_to_continue')
      case 'signatureDeclined':
        return t('auth.signature_required')
      case 'creatingSession':
        return t('auth.awaiting_signature')
      case 'awaitingWelcome':
        return t('auth.almost_ready')
      case 'error':
        return t('auth.error_retry')
      default:
        return t('auth.setting_up')
    }
  }

  // Callbacks for auth flow overlay - wrapped in useCallback to prevent infinite re-renders
  const handleAuthReady = useCallback(() => {
    setAuthReady(true)
  }, [])

  const handleAuthStateChange = useCallback((state: string, _isWhitelisted: boolean | null) => {
    setAuthState(state)
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
          <div className="header-left">
            <h1>{t('header.title')} <span className="alpha-badge">{t('header.alpha_badge')}</span></h1>
            <div className="header-tabs">
              <button
                className={activeTab === 'dashboard' ? 'active' : ''}
                onClick={() => handleTabSwitch('dashboard')}
              >
                {t('header.dashboard_tab')}
              </button>
              <button
                className={activeTab === 'trades' ? 'active' : ''}
                onClick={() => handleTabSwitch('trades')}
              >
                {t('header.trades_tab')}
              </button>
              <button
                className={activeTab === 'tutorials' ? 'active' : ''}
                onClick={() => handleTabSwitch('tutorials')}
              >
                {t('header.tutorials_tab')}
              </button>
            </div>
          </div>
          <div className="header-actions">
            <LanguageSelector />
            <button
              className="help-button"
              onClick={handleHelpClick}
              title={t('header.help_button')}
            >
              ?
            </button>
            <button
              className="version-button"
              onClick={handleVersionClick}
              title={t('release_notes.title')}
            >
              v{CURRENT_VERSION}
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
                    {t('header.disconnect')}
                  </button>
                </>
              ) : (
                <button className="wallet-chip connecting" disabled>
                  <span className="wallet-dot connecting"></span>
                  <span className="wallet-address-text">{t('common.connecting')}</span>
                </button>
              )
            ) : (
              <button
                className="connect-wallet-header-button"
                onClick={() => setShowConnectWalletDialog(true)}
              >
                {t('header.connect_wallet')}
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
                  {isWalletConnected && showStrategyRecommendation && authReady && (
                    <div className="strategy-recommendation-banner">
                      <span className="recommendation-text">
                        {t('trading.no_active_strategy')}
                      </span>
                    </div>
                  )}
                  {!isWalletConnected ? (
                    <button
                      className="start-button connect-wallet-variant"
                      onClick={() => setShowConnectWalletDialog(true)}
                    >
                      {t('trading.connect_wallet_to_trade')}
                    </button>
                  ) : authState === 'error' ? (
                    <button
                      className="start-button error-retry"
                      onClick={() => authFlowService.startFlow()}
                    >
                      {t('trading.error_click_retry')}
                    </button>
                  ) : authState === 'signatureDeclined' ? (
                    <button
                      className="start-button error-retry"
                      onClick={() => authFlowService.retrySignature()}
                    >
                      {t('trading.sign_message_to_continue')}
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
                        >
                          {t('trading.resume_session')}
                        </button>
                        <button
                          onClick={handleNewSessionClick}
                          className="start-button new-session-button"
                        >
                          {t('trading.new_session')}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleStartTrading(false)}
                        className="start-button"
                      >
                        {t('trading.start_trading')}
                      </button>
                    )
                  ) : (
                    <button onClick={handleStopTrading} className="stop-button">
                      {t('trading.stop_trading')}
                    </button>
                  )}
                </div>

                <TradeConsole isTrading={isTrading} />
              </div>

              <div className="markets-section">
                <div className="section-header">
                  <h2>{t('dashboard.available_markets')}</h2>
                </div>
                <div className="section-content">
                  <MarketSelector markets={markets} />
                </div>
              </div>
            </div>

            <div className="dashboard-right-column">
              <div className="balances-section">
                <div className="section-header">
                  <h2>{t('dashboard.balances')}</h2>
                  <div className="balances-header-right">
                    {tradingAccount && (
                      <div className="account-ids">
                        <div className="account-id-item">
                          <span className="account-id-label">{t('dashboard.o2_account')}</span>
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
                          <span className="account-id-label">{t('dashboard.wallet_label')}</span>
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
                      {t('dashboard.deposit_funds')}
                      <svg className="external-link-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="section-content">
                  <Balances balances={balances} loading={balancesLoading} />
                </div>
              </div>

              <div className="open-orders-section">
                <OpenOrdersPanel />
              </div>

              <div className="strategy-settings-section">
                <div className="section-header">
                  <h2>{t('dashboard.strategy_configuration')}</h2>
                  <div className="section-header-actions">
                    <button
                      className="import-strategy-button"
                      onClick={() => strategyImportRef.current?.()}
                    >
                      {t('dashboard.import_strategy')}
                    </button>
                    <button
                      className="create-strategy-button"
                      onClick={() => strategyCreateNewRef.current?.()}
                    >
                      {t('dashboard.create_new_strategy')}
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

        {activeTab === 'trades' && (
          <TradeHistory />
        )}

        {activeTab === 'tutorials' && (
          <TutorialsPanel />
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

      {/* New Session Confirmation Dialog */}
      {showNewSessionConfirm && (
        <div className="confirm-dialog-overlay">
          <div className="confirm-dialog">
            <div className="confirm-dialog-header">
              <h3>{t('new_session.title')}</h3>
            </div>
            <div className="confirm-dialog-body">
              {isCancellingOrders ? (
                <p>{t('new_session.cancelling_orders')}</p>
              ) : (
                <>
                  <p>{t('new_session.description')}</p>
                  <ul>
                    <li>{t('new_session.cancel_orders')}</li>
                    <li>{t('new_session.clear_session')}</li>
                  </ul>
                  <p>{t('new_session.confirm_proceed')}</p>
                </>
              )}
            </div>
            <div className="confirm-dialog-actions">
              <button onClick={handleCancelNewSession} className="cancel-btn" disabled={isCancellingOrders}>
                {t('common.cancel')}
              </button>
              <button onClick={handleConfirmNewSession} className="confirm-btn" disabled={isCancellingOrders}>
                {isCancellingOrders ? t('common.processing') : t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Release Notes Dialog */}
      <ReleaseNotesDialog
        isOpen={showReleaseNotes}
        onClose={handleCloseReleaseNotes}
      />
    </div>
  )
}

