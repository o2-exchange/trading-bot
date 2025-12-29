import { useState, useEffect, useCallback } from 'react'
import { useDepositStore, depositSelectors } from '../../stores/useDepositStore'
import { useWalletStore } from '../../stores/useWalletStore'
import { useTradingAccountStore } from '../../stores/useTradingAccountStore'
import { depositAssetService } from '../../services/deposit/depositAssetService'
import { evmDepositService } from '../../services/deposit/evmDepositService'
import { fuelDepositService } from '../../services/deposit/fuelDepositService'
import { getExplorerTxUrl, EVM_NETWORKS, FUEL_NETWORKS } from '../../constants/depositConstants'
import type { DepositAsset, AvailableNetwork, DepositSourceType } from '../../types/deposit'
import { getAccount } from 'wagmi/actions'
import { wagmiConfig, fuel } from '../../services/walletService'
import './DepositDialog.css'

// Fuel wallet connector info
interface FuelConnectorInfo {
  name: string
  icon: string
  installed: boolean
}

const FUEL_CONNECTORS: FuelConnectorInfo[] = [
  { name: 'Fuel Wallet', icon: '🔥', installed: false },
  { name: 'Fuelet Wallet', icon: '⚡', installed: false },
  { name: 'Bako Safe', icon: '🔒', installed: false },
]

interface DepositDialogProps {
  isOpen: boolean
  onClose: () => void
  tradingAccountId?: string
}

// Format address for display (truncated)
function formatAddress(address: string): string {
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

// Format balance for display
function formatBalance(balance: bigint, decimals: number): string {
  if (balance === 0n) return '0'
  const divisor = 10n ** BigInt(decimals)
  const whole = balance / divisor
  const fraction = balance % divisor
  const fractionStr = fraction.toString().padStart(decimals, '0').slice(0, 4)
  return `${whole}.${fractionStr}`.replace(/\.?0+$/, '')
}

// Get action display text
function getActionText(action: string): string {
  switch (action) {
    case 'checkingPause':
      return 'Checking contract status...'
    case 'switchingNetwork':
      return 'Switching network...'
    case 'checkingAllowance':
      return 'Checking token allowance...'
    case 'approvingToken':
      return 'Approving token... (confirm in wallet)'
    case 'signingPermit':
      return 'Signing permit... (confirm in wallet)'
    case 'estimatingGas':
      return 'Estimating gas...'
    case 'submittingDeposit':
      return 'Submitting deposit... (confirm in wallet)'
    default:
      return 'Processing...'
  }
}

export default function DepositDialog({ isOpen, onClose, tradingAccountId: propTradingAccountId }: DepositDialogProps) {
  const {
    step,
    sourceType,
    form,
    balance,
    allowance,
    submitting,
    result,
    errors,
    open,
    close,
    selectWallet,
    changeWallet,
    setAmount,
    setAsset,
    setNetwork,
    submit,
    reset,
  } = useDepositStore()

  const connectedWallet = useWalletStore((s) => s.connectedWallet)
  const manager = useTradingAccountStore((s) => s.manager)

  const [assetDropdownOpen, setAssetDropdownOpen] = useState(false)

  // Fuel wallet connector selection state
  const [showFuelConnectors, setShowFuelConnectors] = useState(false)
  const [fuelConnectors, setFuelConnectors] = useState<FuelConnectorInfo[]>(FUEL_CONNECTORS)
  const [connectingFuel, setConnectingFuel] = useState<string | null>(null)
  const [fuelConnectionError, setFuelConnectionError] = useState<string | null>(null)

  // Get trading account ID - prefer prop, fallback to manager
  const tradingAccountId = (propTradingAccountId as `0x${string}`) || manager?.contractId?.toB256?.() as `0x${string}` | undefined

  // Check for installed Fuel connectors when showing connector selection
  useEffect(() => {
    if (showFuelConnectors) {
      checkFuelConnectors()
    }
  }, [showFuelConnectors])

  const checkFuelConnectors = async () => {
    try {
      // fuel.connectors() returns a Promise
      const connectors = await fuel.connectors()
      const updatedConnectors = await Promise.all(
        FUEL_CONNECTORS.map(async (connector) => {
          const fuelConnector = connectors.find(
            (c: any) => c.name.toLowerCase().includes(connector.name.toLowerCase().split(' ')[0])
          )
          let installed = false
          if (fuelConnector) {
            try {
              installed = await fuelConnector.ping()
            } catch {
              installed = false
            }
          }
          return { ...connector, installed }
        })
      )
      setFuelConnectors(updatedConnectors)
    } catch (error) {
      console.error('Error checking Fuel connectors:', error)
    }
  }

  const handleConnectFuelWallet = async (connectorName: string) => {
    setConnectingFuel(connectorName)
    setFuelConnectionError(null)

    try {
      // fuel.connectors() returns a Promise
      const connectors = await fuel.connectors()
      const connector = connectors.find(
        (c: any) => c.name.toLowerCase().includes(connectorName.toLowerCase().split(' ')[0])
      )

      if (!connector) {
        throw new Error(`${connectorName} is not available. Please install the wallet extension.`)
      }

      // Check if installed
      const isInstalled = await connector.ping()
      if (!isInstalled) {
        throw new Error(`${connectorName} is not installed. Please install the wallet extension.`)
      }

      // Select and connect
      await fuel.selectConnector(connector.name)
      await fuel.connect()

      // Get the account
      const account = await fuel.currentAccount()
      if (!account) {
        throw new Error('Failed to get account from wallet')
      }

      // Get address
      const addressString = (account as any).address?.toB256?.() || (account as any).address || String(account)

      // Successfully connected - proceed with deposit
      setShowFuelConnectors(false)
      setConnectingFuel(null)
      selectWallet('fuel', addressString as `0x${string}`)
    } catch (error: any) {
      console.error('Error connecting Fuel wallet:', error)
      setFuelConnectionError(error.message || 'Failed to connect wallet')
      setConnectingFuel(null)
    }
  }

  // Open dialog when isOpen changes
  useEffect(() => {
    if (isOpen && step === 'closed' && tradingAccountId) {
      open(tradingAccountId)
    } else if (!isOpen && step !== 'closed') {
      close()
    }
  }, [isOpen, step, tradingAccountId, open, close])

  // Handle close
  const handleClose = useCallback(() => {
    close()
    setShowFuelConnectors(false)
    setFuelConnectionError(null)
    setConnectingFuel(null)
    onClose()
  }, [close, onClose])

  // Handle wallet selection
  const handleSelectWallet = useCallback(async (type: DepositSourceType) => {
    if (type === 'fuel') {
      // Show Fuel connector selection instead of directly getting account
      setShowFuelConnectors(true)
      setFuelConnectionError(null)
      return
    }

    // EVM wallet - get currently connected account
    const account = await getAccount(wagmiConfig)
    const depositorAddress = account.address as `0x${string}` | null

    if (!depositorAddress) {
      console.error('No EVM wallet connected')
      return
    }

    selectWallet(type, depositorAddress)
  }, [selectWallet])

  // Handle going back from Fuel connector selection
  const handleBackFromFuelConnectors = useCallback(() => {
    setShowFuelConnectors(false)
    setFuelConnectionError(null)
    setConnectingFuel(null)
  }, [])

  // Handle max button
  const handleMax = useCallback(() => {
    if (!form.asset) return

    const decimals = sourceType === 'fuel'
      ? (form.asset.fuel?.decimals ?? form.asset.decimals)
      : (form.network ? depositAssetService.getTokenDecimals(form.asset, form.network.id, 'evm') : form.asset.decimals)

    const totalBalance = balance.canonical + balance.universal
    const formattedBalance = formatBalance(totalBalance, decimals)
    setAmount(formattedBalance)
  }, [form.asset, form.network, sourceType, balance, setAmount])

  // Handle asset selection
  const handleSelectAsset = useCallback((asset: DepositAsset, network: AvailableNetwork) => {
    setAsset(asset)
    setNetwork(network)
    setAssetDropdownOpen(false)
  }, [setAsset, setNetwork])

  // Handle retry
  const handleRetry = useCallback(() => {
    reset()
    if (tradingAccountId) {
      open(tradingAccountId)
    }
  }, [reset, open, tradingAccountId])

  // Get available asset/network combinations
  const assetNetworkCombinations = sourceType
    ? depositAssetService.getAssetNetworkCombinations(sourceType)
    : []

  // Get explorer URL for result
  const explorerUrl = result && form.network
    ? getExplorerTxUrl(form.network, result.txId)
    : null

  if (!isOpen) return null

  return (
    <div className="deposit-overlay" onClick={handleClose}>
      <div className="deposit-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="deposit-header">
          <h2>Deposit</h2>
          <button className="deposit-close-btn" onClick={handleClose}>
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="deposit-body">
          {/* Loading state when trading account not ready */}
          {step === 'closed' && !tradingAccountId && (
            <div className="deposit-loading">
              <div className="deposit-spinner" />
              <p className="deposit-loading-text">Loading trading account...</p>
            </div>
          )}

          {/* Wallet Selection Step */}
          {step === 'selectingWallet' && !showFuelConnectors && (
            <div className="wallet-select-section">
              <p className="wallet-select-label">Select deposit source</p>
              <div className="wallet-options">
                {/* EVM Option */}
                <div
                  className="wallet-option"
                  onClick={() => handleSelectWallet('evm')}
                >
                  <div className="wallet-option-icon evm">⟠</div>
                  <div className="wallet-option-info">
                    <div className="wallet-option-name">Ethereum / Base</div>
                    <div className="wallet-option-desc">
                      Deposit from EVM networks via Fast Bridge
                    </div>
                  </div>
                  <span className="wallet-option-arrow">→</span>
                </div>

                {/* Fuel Option */}
                <div
                  className="wallet-option"
                  onClick={() => handleSelectWallet('fuel')}
                >
                  <div className="wallet-option-icon fuel">⛽</div>
                  <div className="wallet-option-info">
                    <div className="wallet-option-name">Fuel Network</div>
                    <div className="wallet-option-desc">
                      Deposit directly from your Fuel wallet
                    </div>
                  </div>
                  <span className="wallet-option-arrow">→</span>
                </div>
              </div>
            </div>
          )}

          {/* Fuel Wallet Connector Selection */}
          {step === 'selectingWallet' && showFuelConnectors && (
            <div className="wallet-select-section">
              <div className="fuel-connectors-header">
                <button className="back-btn" onClick={handleBackFromFuelConnectors}>
                  ← Back
                </button>
                <p className="wallet-select-label">Connect Fuel Wallet</p>
              </div>

              {fuelConnectionError && (
                <div className="fuel-connection-error">
                  {fuelConnectionError}
                </div>
              )}

              <div className="wallet-options">
                {fuelConnectors.map((connector) => (
                  <div
                    key={connector.name}
                    className={`wallet-option ${!connector.installed ? 'not-installed' : ''} ${connectingFuel === connector.name ? 'connecting' : ''}`}
                    onClick={() => connector.installed && !connectingFuel && handleConnectFuelWallet(connector.name)}
                  >
                    <div className="wallet-option-icon fuel">{connector.icon}</div>
                    <div className="wallet-option-info">
                      <div className="wallet-option-name">{connector.name}</div>
                      <div className="wallet-option-desc">
                        {connectingFuel === connector.name
                          ? 'Connecting...'
                          : connector.installed
                          ? 'Click to connect'
                          : 'Not installed'}
                      </div>
                    </div>
                    {connector.installed && connectingFuel !== connector.name && (
                      <span className="wallet-option-arrow">→</span>
                    )}
                    {connectingFuel === connector.name && (
                      <div className="wallet-option-spinner" />
                    )}
                  </div>
                ))}
              </div>

              <p className="fuel-connectors-hint">
                Don't have a Fuel wallet?{' '}
                <a href="https://wallet.fuel.network/" target="_blank" rel="noopener noreferrer">
                  Get Fuel Wallet
                </a>
              </p>
            </div>
          )}

          {/* Deposit Form Step */}
          {step === 'depositing' && (
            <div className="deposit-form">
              {/* From Wallet */}
              <div className="deposit-from-section">
                <span className="deposit-from-label">From</span>
                <div className="deposit-from-wallet">
                  <span className="deposit-from-address">
                    {submitting.depositor ? formatAddress(submitting.depositor) : '...'}
                  </span>
                  <button className="deposit-change-btn" onClick={changeWallet}>
                    Change
                  </button>
                </div>
              </div>

              {/* Asset Selector */}
              <div className="asset-selector">
                <label className="asset-selector-label">Asset & Network</label>
                <div className="asset-selector-dropdown">
                  <button
                    className="asset-selector-button"
                    onClick={() => setAssetDropdownOpen(!assetDropdownOpen)}
                  >
                    <div className="asset-selected">
                      {form.asset ? (
                        <>
                          <div className="asset-icon">{form.asset.symbol.slice(0, 2)}</div>
                          <div className="asset-info">
                            <div className="asset-symbol">{form.asset.symbol}</div>
                            <div className="asset-network">{form.network?.name || 'Select network'}</div>
                          </div>
                        </>
                      ) : (
                        <span style={{ color: 'var(--muted-foreground)' }}>Select asset</span>
                      )}
                    </div>
                    <span>▼</span>
                  </button>

                  {assetDropdownOpen && (
                    <div className="asset-dropdown-menu">
                      {assetNetworkCombinations.map(({ asset, network }) => (
                        <div
                          key={`${asset.symbol}-${network.id}`}
                          className={`asset-dropdown-item ${
                            form.asset?.symbol === asset.symbol && form.network?.id === network.id
                              ? 'selected'
                              : ''
                          }`}
                          onClick={() => handleSelectAsset(asset, network)}
                        >
                          <div className="asset-selected">
                            <div className="asset-icon">{asset.symbol.slice(0, 2)}</div>
                            <div className="asset-info">
                              <div className="asset-symbol">{asset.symbol}</div>
                              <div className="asset-network">{network.name}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Amount Input */}
              <div className="amount-input-section">
                <div className="amount-input-header">
                  <label className="amount-input-label">Amount</label>
                  <span className="amount-balance">
                    Balance:{' '}
                    <span className="amount-balance-value">
                      {balance.status === 'loading'
                        ? '...'
                        : form.asset
                        ? formatBalance(
                            balance.canonical + balance.universal,
                            sourceType === 'fuel'
                              ? (form.asset.fuel?.decimals ?? form.asset.decimals)
                              : (form.network
                                  ? depositAssetService.getTokenDecimals(form.asset, form.network.id, 'evm')
                                  : form.asset.decimals)
                          )
                        : '0'}{' '}
                      {form.asset?.symbol || ''}
                    </span>
                  </span>
                </div>
                <div className="amount-input-wrapper">
                  <input
                    type="text"
                    className={`amount-input ${errors.amount ? 'error' : ''}`}
                    value={form.amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                  />
                  <button className="amount-max-btn" onClick={handleMax}>
                    MAX
                  </button>
                </div>
                {errors.amount && <p className="amount-error">{errors.amount}</p>}
              </div>

              {/* Approval info (if needed) */}
              {sourceType === 'evm' && allowance.needsApproval && form.amount && (
                <div className="approval-panel">
                  <div className="approval-panel-title">Token Approval Required</div>
                  <div className="approval-panel-desc">
                    You'll need to approve the deposit contract to spend your tokens.
                    This is a one-time approval for this token.
                  </div>
                </div>
              )}

              {/* Submit Button */}
              <div className="deposit-submit-section">
                <button
                  className="deposit-submit-btn"
                  onClick={submit}
                  disabled={!depositSelectors.canSubmit(useDepositStore.getState())}
                >
                  {allowance.needsApproval ? 'Approve & Deposit' : 'Deposit'}
                </button>
              </div>
            </div>
          )}

          {/* Submitting Step */}
          {step === 'submitting' && (
            <div className="deposit-submitting">
              <div className="deposit-spinner" />
              <h3 className="deposit-submitting-title">Processing Deposit</h3>
              <p className="deposit-submitting-step">
                {getActionText(submitting.currentAction)}
              </p>
            </div>
          )}

          {/* Success Step */}
          {step === 'success' && result && (
            <div className="deposit-success">
              <div className="deposit-success-icon">✓</div>
              <h3 className="deposit-success-title">Deposit Submitted!</h3>
              <p className="deposit-success-desc">
                Your deposit has been submitted. It may take a few minutes to complete.
              </p>
              <div className="deposit-success-tx">
                <span className="deposit-success-tx-label">Transaction:</span>
                <span className="deposit-success-tx-hash">
                  {formatAddress(result.txId)}
                </span>
              </div>
              <div className="deposit-success-actions">
                {explorerUrl && (
                  <a
                    href={explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="deposit-view-btn"
                  >
                    View on Explorer
                  </a>
                )}
                <button className="deposit-done-btn" onClick={handleClose}>
                  Done
                </button>
              </div>
            </div>
          )}

          {/* Error Step */}
          {step === 'error' && (
            <div className="deposit-error">
              <div className="deposit-error-icon">!</div>
              <h3 className="deposit-error-title">Deposit Failed</h3>
              <p className="deposit-error-desc">
                {errors.amount || 'An error occurred while processing your deposit.'}
              </p>
              <button className="deposit-retry-btn" onClick={handleRetry}>
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
