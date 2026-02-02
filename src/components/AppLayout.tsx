import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet } from 'react-router-dom'
import { walletService } from '../services/walletService'
import { authFlowService } from '../services/authFlowService'
import AuthFlowOverlay from './AuthFlowOverlay'
import WelcomeModal from './WelcomeModal'
import DepositDialog from './DepositDialog'
import ConnectWalletDialog from './ConnectWalletDialog'
import ReleaseNotesDialog from './ReleaseNotesDialog'
import LanguageSelector from './LanguageSelector'
import { useVersionCheck } from '../hooks/useVersionCheck'
import { CURRENT_VERSION } from '../constants/releaseNotes'
import { useTradingStore } from '../stores/useTradingStore'
import { useWalletStore } from '../stores/useWalletStore'
import { balanceService } from '../services/balanceService'
import './Dashboard.css'

export default function AppLayout() {
  const { t } = useTranslation()
  const connectedWallet = useWalletStore((state) => state.connectedWallet)
  const isWalletConnected = !!connectedWallet

  const {
    walletAddress,
    tradingAccount,
    markets,
    authReady,
    authState,
    setAuthReady,
    setAuthState,
    setBalances,
  } = useTradingStore()

  const [showWelcomeModal, setShowWelcomeModal] = useState(false)
  const [showDepositDialog, setShowDepositDialog] = useState(false)
  const [showConnectWalletDialog, setShowConnectWalletDialog] = useState(false)
  const [showReleaseNotes, setShowReleaseNotes] = useState(false)
  const [copied, setCopied] = useState(false)

  const { shouldShowReleaseNotes, markVersionAsSeen } = useVersionCheck(authReady)

  // Auto-show release notes when user visits after an update
  useEffect(() => {
    if (shouldShowReleaseNotes) {
      setShowReleaseNotes(true)
    }
  }, [shouldShowReleaseNotes])

  const handleDisconnect = async () => {
    await walletService.disconnect()
  }

  const handleCopyAddress = async () => {
    if (walletAddress) {
      await navigator.clipboard.writeText(walletAddress)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  const handleHelpClick = () => {
    setShowWelcomeModal(true)
  }

  const handleVersionClick = () => {
    setShowReleaseNotes(true)
  }

  const handleCloseReleaseNotes = () => {
    setShowReleaseNotes(false)
    markVersionAsSeen()
  }

  const handleAuthReady = useCallback(() => {
    setAuthReady(true)
  }, [setAuthReady])

  const handleAuthStateChange = useCallback((state: string, _isWhitelisted: boolean | null) => {
    setAuthState(state)
  }, [setAuthState])

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
            <NavLink
              to="/"
              end
              className={({ isActive }) => isActive ? 'active' : ''}
            >
              {t('header.dashboard_tab')}
            </NavLink>
            <NavLink
              to="/trades"
              className={({ isActive }) => isActive ? 'active' : ''}
            >
              {t('header.trades_tab')}
            </NavLink>
            <NavLink
              to="/tutorials"
              className={({ isActive }) => isActive ? 'active' : ''}
            >
              {t('header.tutorials_tab')}
            </NavLink>
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
        <Outlet />
      </div>

      {/* Welcome Modal */}
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
          if (tradingAccount && markets.length > 0 && walletAddress) {
            balanceService.clearCache()
            balanceService.getAllBalances(markets, tradingAccount.id, walletAddress)
              .then(setBalances)
              .catch(console.error)
          }
        }}
        tradingAccountId={tradingAccount?.id}
      />

      {/* Release Notes Dialog */}
      <ReleaseNotesDialog
        isOpen={showReleaseNotes}
        onClose={handleCloseReleaseNotes}
      />
    </div>
  )
}
