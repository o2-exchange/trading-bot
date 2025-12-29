import { useState, useEffect } from 'react'
import { walletService, wagmiConfig } from '../services/walletService'
import { useWalletStore } from '../stores/useWalletStore'
import { useToast } from './ToastProvider'
import './WalletConnect.css'

// Import wallet logos
import fuelLogo from '../styles/walletlogos/fuelw-logo.svg'
import fueletLogo from '../styles/walletlogos/fueletw-logo.svg'
import bakoLogo from '../styles/walletlogos/bakow-logo.svg'
import okxLogo from '../styles/walletlogos/okxw-logo.png'
import metamaskLogo from '../styles/walletlogos/metamaskw-logo.svg'
import phantomLogo from '../styles/walletlogos/phantomw-logo.png'
import backpackLogo from '../styles/walletlogos/backpackw-logo.svg'

// Wallet icons mapping
const WALLET_ICONS: Record<string, string> = {
  'fuel': fuelLogo,
  'fuelet': fueletLogo,
  'bako-safe': bakoLogo,
  'okx': okxLogo,
  'metamask': metamaskLogo,
  'phantom': phantomLogo,
  'backpack': backpackLogo,
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

interface WalletConnectProps {
  onConnect: () => void
}

export default function WalletConnect({ onConnect }: WalletConnectProps) {
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
    try {
      await walletService.connectFuelWallet(walletType)
      addToast('Wallet connected successfully', 'success')
      // Store will be updated automatically by WalletConnectionWatcher
      onConnect()
    } catch (error: any) {
      addToast(`Failed to connect wallet: ${error.message}`, 'error')
    } finally {
      setConnecting(null)
    }
  }

  const handleConnectEthereum = async (connectorName?: string) => {
    setConnecting(connectorName || 'ethereum')
    try {
      await walletService.connectEthereumWallet(connectorName)
      addToast('Wallet connected successfully', 'success')
      // Store will be updated automatically by WalletConnectionWatcher
      onConnect()
    } catch (error: any) {
      addToast(`Failed to connect wallet: ${error.message}`, 'error')
    } finally {
      setConnecting(null)
    }
  }

  return (
    <div className="wallet-connect">
      <div className="wallet-connect-container">
        <h1>o2 Trading Bot <span className="alpha-badge">Alpha</span></h1>
        <p className="subtitle">Connect your wallet to start trading</p>
        <div className="warning-banner">
          Experimental software. Trade at your own risk and only with funds you can afford to lose.
        </div>

        <div className="wallet-options">
          <h2>Fuel Wallets</h2>
          <div className="wallet-grid">
            <button
              className="wallet-button"
              onClick={() => handleConnectFuel('fuel')}
              disabled={!!connecting}
            >
              <img src={getWalletIcon('fuel')} alt="Fuel Wallet" className="wallet-icon" />
              <span>{connecting === 'fuel' ? 'Connecting...' : 'Fuel Wallet'}</span>
            </button>
            <button
              className="wallet-button"
              onClick={() => handleConnectFuel('fuelet')}
              disabled={!!connecting}
            >
              <img src={getWalletIcon('fuelet')} alt="Fuelet" className="wallet-icon" />
              <span>{connecting === 'fuelet' ? 'Connecting...' : 'Fuelet'}</span>
            </button>
            <button
              className="wallet-button"
              onClick={() => handleConnectFuel('bako-safe')}
              disabled={!!connecting}
            >
              <img src={getWalletIcon('bako-safe')} alt="Bako Safe" className="wallet-icon" />
              <span>{connecting === 'bako-safe' ? 'Connecting...' : 'Bako Safe'}</span>
            </button>
          </div>

          {ethereumConnectors.length > 0 && (
            <>
              <h2 style={{ marginTop: '32px' }}>Ethereum Wallets</h2>
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
                      <span>{connecting === connector.name ? 'Connecting...' : connector.name}</span>
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

