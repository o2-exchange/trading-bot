import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { walletService } from '../services/walletService'
import { useToast } from './ToastProvider'
import './ConnectWalletDialog.css'

// Import wallet logos
import fuelLogo from '../styles/walletlogos/fuelw-logo.svg'
import fueletLogo from '../styles/walletlogos/fueletw-logo.svg'
import bakoLogo from '../styles/walletlogos/bakow-logo.svg'
import okxLogo from '../styles/walletlogos/okxw-logo.png'
import metamaskLogo from '../styles/walletlogos/metamaskw-logo.svg'
import phantomLogo from '../styles/walletlogos/phantomw-logo.png'
import backpackLogo from '../styles/walletlogos/backpackw-logo.svg'
import walletConnectLogo from '../styles/walletlogos/walletConnect.svg'

// Wallet icons mapping
const WALLET_ICONS: Record<string, string> = {
  'fuel': fuelLogo,
  'fuelet': fueletLogo,
  'bako-safe': bakoLogo,
  'okx': okxLogo,
  'metamask': metamaskLogo,
  'phantom': phantomLogo,
  'backpack': backpackLogo,
  'walletconnect': walletConnectLogo,
}

const getWalletIcon = (walletName: string): string | undefined => {
  const name = walletName.toLowerCase()
  if (name.includes('fuel') && !name.includes('fuelet')) return WALLET_ICONS['fuel']
  if (name.includes('fuelet')) return WALLET_ICONS['fuelet']
  if (name.includes('bako')) return WALLET_ICONS['bako-safe']
  if (name.includes('okx')) return WALLET_ICONS['okx']
  if (name.includes('metamask')) return WALLET_ICONS['metamask']
  if (name.includes('phantom')) return WALLET_ICONS['phantom']
  if (name.includes('backpack')) return WALLET_ICONS['backpack']
  if (name.includes('walletconnect')) return WALLET_ICONS['walletconnect']
  return undefined
}

// Filter out "Injected" wallet if a named wallet is available
const filterConnectors = (connectors: Array<{ id: string; name: string; type: 'ethereum' }>) => {
  const hasNamedWallet = connectors.some(c =>
    c.name.toLowerCase() !== 'injected' &&
    !c.name.toLowerCase().includes('injected')
  )
  if (hasNamedWallet) {
    return connectors.filter(c =>
      c.name.toLowerCase() !== 'injected' &&
      !c.name.toLowerCase().includes('injected')
    )
  }
  return connectors
}

interface ConnectWalletDialogProps {
  onClose: () => void
}

export default function ConnectWalletDialog({ onClose }: ConnectWalletDialogProps) {
  const { t } = useTranslation()
  const [connecting, setConnecting] = useState<string | null>(null)
  const [ethereumConnectors, setEthereumConnectors] = useState<Array<{ id: string; name: string; type: 'ethereum' }>>([])
  const { addToast } = useToast()

  useEffect(() => {
    // Get available Ethereum connectors and filter out generic "Injected" when named wallets exist
    const connectors = walletService.getAvailableEthereumConnectors()
    setEthereumConnectors(filterConnectors(connectors))
  }, [])

  const handleConnectFuel = async (walletType: 'fuel' | 'fuelet' | 'bako-safe') => {
    setConnecting(walletType)

    // Timeout to prevent button getting stuck
    const timeout = setTimeout(() => {
      setConnecting(null)
      addToast(t('wallet.connection_timeout'), 'error')
    }, 30000) // 30 second timeout

    try {
      await walletService.connectFuelWallet(walletType)
      clearTimeout(timeout)
      addToast(t('wallet.connected_successfully'), 'success')
      onClose()
    } catch (error: any) {
      clearTimeout(timeout)
      addToast(t('wallet.connection_failed', { message: error.message }), 'error')
    } finally {
      setConnecting(null)
    }
  }

  const handleConnectEthereum = async (connectorName?: string) => {
    const walletType = connectorName || 'ethereum'
    setConnecting(walletType)

    // Timeout to prevent button getting stuck
    const timeout = setTimeout(() => {
      setConnecting(null)
      addToast(t('wallet.connection_timeout'), 'error')
    }, 50000) // 50 second timeout

    try {
      await walletService.connectEthereumWallet(connectorName)
      clearTimeout(timeout)
      addToast(t('wallet.connected_successfully'), 'success')
      onClose()
    } catch (error: any) {
      clearTimeout(timeout)
      addToast(t('wallet.connection_failed', { message: error.message }), 'error')
    } finally {
      setConnecting(null)
    }
  }

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  return (
    <div className="connect-wallet-dialog-overlay" onClick={handleOverlayClick}>
      <div className="connect-wallet-dialog">
        <div className="dialog-header">
          <h2>{t('wallet.connect_title')}</h2>
          <button className="close-button" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1 1L13 13M1 13L13 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="warning-banner">
          {t('wallet.warning_banner')}
        </div>

        <div className="wallet-options">
          <h3>{t('wallet.fuel_wallets')}</h3>
          <div className="wallet-grid">
            <button
              className="wallet-button"
              onClick={() => handleConnectFuel('fuel')}
              disabled={!!connecting}
            >
              <img src={getWalletIcon('fuel')} alt="Fuel Wallet" className="wallet-icon" />
              <span>{connecting === 'fuel' ? t('common.connecting') : t('wallet.fuel_wallet')}</span>
            </button>
            <button
              className="wallet-button"
              onClick={() => handleConnectFuel('fuelet')}
              disabled={!!connecting}
            >
              <img src={getWalletIcon('fuelet')} alt="Fuelet" className="wallet-icon" />
              <span>{connecting === 'fuelet' ? t('common.connecting') : t('wallet.fuelet')}</span>
            </button>
            <button
              className="wallet-button"
              onClick={() => handleConnectFuel('bako-safe')}
              disabled={!!connecting}
            >
              <img src={getWalletIcon('bako-safe')} alt="Bako Safe" className="wallet-icon" />
              <span>{connecting === 'bako-safe' ? t('common.connecting') : t('wallet.bako_safe')}</span>
            </button>
          </div>

          {ethereumConnectors.length > 0 && (
            <>
              <h3>{t('wallet.ethereum_wallets')}</h3>
              <div className="wallet-grid">
                {ethereumConnectors.map((connector) => {
                  const icon = getWalletIcon(connector.name)
                  return (
                    <button
                      key={connector.id}
                      className="wallet-button"
                      onClick={() => handleConnectEthereum(connector.name)}
                      disabled={!!connecting}
                    >
                      {icon && <img src={icon} alt={connector.name} className="wallet-icon" />}
                      <span>{connecting === connector.name ? t('common.connecting') : connector.name}</span>
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
