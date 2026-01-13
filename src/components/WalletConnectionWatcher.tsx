import { useEffect, useCallback, useRef } from 'react'
import { useWalletStore } from '../stores/useWalletStore'
import { walletService, fuel, wagmiConfig } from '../services/walletService'
import { watchAccount } from 'wagmi/actions'
import { clearUserStorageForAccountChange } from '../utils/clearUserStorage'
import { authFlowService } from '../services/authFlowService'
import { sessionManagerService } from '../services/sessionManagerService'
import { analyticsService } from '../services/analyticsService'

/**
 * Watches wallet connections and automatically updates the store
 * Similar to O2's ConnectorsSync component
 *
 * CRITICAL: Handles account changes and disconnects properly:
 * - On disconnect: clears all user data (sessions, keys, etc.)
 * - On account change: resets auth flow
 */
export function WalletConnectionWatcher() {
  const setConnectedWallet = useWalletStore((state) => state.setConnectedWallet)
  const clearWallet = useWalletStore((state) => state.clearWallet)
  const previousAddressRef = useRef<string | null>(null)
  const initialCheckDoneRef = useRef(false)

  // Handle wallet disconnect
  const handleDisconnect = useCallback((source?: string) => {
    console.log('[WalletWatcher] Wallet disconnected, source:', source || 'unknown')

    // Clear wallet store
    clearWallet()

    // DON'T clear user storage here - let sessions persist across disconnects
    // Sessions will be cleared on:
    // 1. Account CHANGE (different address) - handled in handleConnect above
    // 2. User explicitly uses "Clear & Retry" button
    // This matches O2's behavior and prevents intermittent connection issues on refresh

    // DON'T reset auth flow here either - it causes issues when wagmi briefly
    // reports disconnected during signing or page load. The auth flow will
    // naturally restart when user reconnects (startFlow checks for wallet).
    // If user was viewing welcome modal, they can dismiss it and proceed.

    previousAddressRef.current = null
  }, [clearWallet])

  // Handle wallet connection/account change
  const handleConnect = useCallback((address: string, isFuel: boolean, connector: any, type: string) => {
    const normalizedAddress = address.toLowerCase()

    // Check if this is an account change (not initial connect)
    if (previousAddressRef.current && previousAddressRef.current !== normalizedAddress) {
      console.log('[WalletWatcher] Account changed from', previousAddressRef.current, 'to', normalizedAddress)

      // CRITICAL: Abort any in-progress auth flow first to prevent stale data
      authFlowService.abort()

      // CRITICAL: Clear all data including T&C for the OLD address
      // This is now async but we don't need to await - fire and forget is fine here
      clearUserStorageForAccountChange(previousAddressRef.current)

      // CRITICAL: Clear cached session managers to prevent stale managers being used
      sessionManagerService.clearAll()

      // Reset auth flow so user goes through T&C and session creation again
      authFlowService.reset()
    }

    // Update connected wallet
    setConnectedWallet({
      type: type as any,
      address: normalizedAddress,
      isFuel,
      connector,
    })

    // Track wallet connected and identify user
    analyticsService.trackWalletConnected(normalizedAddress, type, !isFuel)

    previousAddressRef.current = normalizedAddress
  }, [setConnectedWallet])

  // Watch Fuel wallet connection
  // CRITICAL: Like O2, we ONLY use Fuel SDK events - NO polling for disconnections!
  useEffect(() => {
    let mounted = true

    // Handle connection state changes (only fires when actually connecting/disconnecting)
    const handleConnectionEvent = async (isConnected: boolean) => {
      if (!mounted) return
      console.log('[WalletWatcher] Fuel connection event:', isConnected)

      // SMART GUARD: If user has EVM wallet as primary, don't let Fuel connections override it
      // This allows deposit flow to connect Fuel wallet without affecting main trading wallet
      const currentWallet = useWalletStore.getState().connectedWallet
      if (currentWallet && currentWallet.isFuel === false) {
        console.log('[WalletWatcher] Fuel connection detected but EVM wallet is primary - ignoring')
        return
      }

      if (isConnected) {
        // Connected - get account info
        try {
          console.log('[WalletWatcher] Getting Fuel account...')
          const account = await fuel.currentAccount()
          console.log('[WalletWatcher] Current account:', account ? 'Found' : 'Not found')
          console.log('[WalletWatcher] Account type:', typeof account)

          if (account) {
            // Handle both Address object and string cases (like walletService does)
            let address: string
            if (typeof account === 'string') {
              // Already a string address
              address = account.toLowerCase()
              console.log('[WalletWatcher] Account is string:', address.substring(0, 10) + '...')
            } else if ((account as any).address?.toB256) {
              // Address object with toB256 method
              address = (account as any).address.toB256().toLowerCase()
              console.log('[WalletWatcher] Account has address.toB256():', address.substring(0, 10) + '...')
            } else if ((account as any).address) {
              // Address object without toB256
              address = String((account as any).address).toLowerCase()
              console.log('[WalletWatcher] Account has address property:', address.substring(0, 10) + '...')
            } else {
              // Fallback - convert to string
              address = String(account).toLowerCase()
              console.log('[WalletWatcher] Account converted to string:', address.substring(0, 10) + '...')
            }

            const connector = await fuel.currentConnector()
            console.log('[WalletWatcher] Current connector:', connector?.name)

            if (connector) {
              const walletType = connector.name === 'Fuel Wallet' ? 'fuel'
                : connector.name === 'Fuelet' ? 'fuelet'
                : connector.name === 'Bako Safe' ? 'bako-safe'
                : 'fuel'

              console.log('[WalletWatcher] Calling handleConnect with type:', walletType)
              handleConnect(address, true, connector, walletType)
              console.log('[WalletWatcher] handleConnect completed')
            } else {
              console.warn('[WalletWatcher] No connector found')
            }
          } else {
            console.warn('[WalletWatcher] No account returned')
          }
        } catch (error) {
          console.error('[WalletWatcher] Error getting Fuel account:', error)
        }
      } else {
        // Disconnected - only handle if we have a Fuel wallet in store
        const currentWallet = useWalletStore.getState().connectedWallet
        if (currentWallet?.isFuel) {
          console.log('[WalletWatcher] Fuel wallet disconnected via connection event')
          handleDisconnect('fuel.events.connection (isConnected=false)')
        } else {
          console.log('[WalletWatcher] Disconnect event but no Fuel wallet in store - ignoring')
        }
      }
    }

    // Handle account changes (fires when user switches accounts)
    const handleAccountChangeEvent = async (account: string | null) => {
      if (!mounted) return
      console.log('[WalletWatcher] Fuel account change event')

      // SMART GUARD: If user has EVM wallet as primary, don't let Fuel changes affect it
      const currentWallet = useWalletStore.getState().connectedWallet
      if (currentWallet && currentWallet.isFuel === false) {
        console.log('[WalletWatcher] Fuel account change detected but EVM wallet is primary - ignoring')
        return
      }

      if (!account) {
        // Account became null - user disconnected
        if (currentWallet?.isFuel) {
          console.log('[WalletWatcher] Fuel account is null - disconnecting')
          handleDisconnect('fuel.events.currentAccount (account=null)')
        }
      } else {
        // Account changed - update if we have Fuel wallet
        if (currentWallet?.isFuel) {
          try {
            const accountObj = await fuel.currentAccount()
            if (accountObj) {
              // Handle both Address object and string cases
              let address: string
              if (typeof accountObj === 'string') {
                address = accountObj.toLowerCase()
              } else if ((accountObj as any).address?.toB256) {
                address = (accountObj as any).address.toB256().toLowerCase()
              } else if ((accountObj as any).address) {
                address = String((accountObj as any).address).toLowerCase()
              } else {
                address = String(accountObj).toLowerCase()
              }

              const connector = await fuel.currentConnector()

              if (connector && address !== currentWallet.address) {
                const walletType = connector.name === 'Fuel Wallet' ? 'fuel'
                  : connector.name === 'Fuelet' ? 'fuelet'
                  : connector.name === 'Bako Safe' ? 'bako-safe'
                  : 'fuel'

                console.log('[WalletWatcher] Fuel account changed to:', address.substring(0, 10) + '...')
                handleConnect(address, true, connector, walletType)
              }
            }
          } catch (error) {
            console.error('[WalletWatcher] Error handling account change:', error)
          }
        }
      }
    }

    // Handle accounts list change (fires when accounts are added/removed)
    const handleAccountsEvent = async () => {
      if (!mounted) return
      console.log('[WalletWatcher] Fuel accounts list changed')

      // SMART GUARD: If user has EVM wallet as primary, don't let Fuel changes affect it
      const currentWallet = useWalletStore.getState().connectedWallet
      if (currentWallet && currentWallet.isFuel === false) {
        console.log('[WalletWatcher] Fuel accounts change detected but EVM wallet is primary - ignoring')
        return
      }

      // Re-check current account
      try {
        const account = await fuel.currentAccount()
        if (!account) {
          const currentWallet = useWalletStore.getState().connectedWallet
          if (currentWallet?.isFuel) {
            console.log('[WalletWatcher] No Fuel account after accounts change - disconnecting')
            handleDisconnect('fuel.events.accounts (no account found)')
          }
        }
      } catch (error) {
        console.debug('[WalletWatcher] Error checking accounts:', error)
      }
    }

    // Register Fuel SDK event listeners (like O2 does)
    fuel.on(fuel.events.connection, handleConnectionEvent)
    fuel.on(fuel.events.currentAccount, handleAccountChangeEvent)
    fuel.on(fuel.events.accounts, handleAccountsEvent)

    // Check initial state on mount (no polling after this!)
    const checkInitialState = async () => {
      // Prevent duplicate checks (e.g., from React StrictMode double-mounting)
      if (initialCheckDoneRef.current) return
      initialCheckDoneRef.current = true

      try {
        const isConnected = await fuel.isConnected()
        if (isConnected) {
          const account = await fuel.currentAccount()
          if (account) {
            // Handle both Address object and string cases
            let address: string
            if (typeof account === 'string') {
              address = account.toLowerCase()
            } else if ((account as any).address?.toB256) {
              address = (account as any).address.toB256().toLowerCase()
            } else if ((account as any).address) {
              address = String((account as any).address).toLowerCase()
            } else {
              address = String(account).toLowerCase()
            }

            const connector = await fuel.currentConnector()

            if (connector) {
              const walletType = connector.name === 'Fuel Wallet' ? 'fuel'
                : connector.name === 'Fuelet' ? 'fuelet'
                : connector.name === 'Bako Safe' ? 'bako-safe'
                : 'fuel'

              console.log('[WalletWatcher] Initial Fuel wallet state:', address.substring(0, 10) + '...')
              handleConnect(address, true, connector, walletType)
            }
          }
        }
      } catch (error) {
        console.debug('[WalletWatcher] No Fuel wallet connected on mount')
      }
    }
    checkInitialState()

    return () => {
      mounted = false
      fuel.off(fuel.events.connection, handleConnectionEvent)
      fuel.off(fuel.events.currentAccount, handleAccountChangeEvent)
      fuel.off(fuel.events.accounts, handleAccountsEvent)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Run only on mount - callbacks are stable via useCallback with stable deps

  // Watch Ethereum wallet connection via wagmi watchAccount (subscription-based like O2)
  // This is more efficient than useAccountEffect as it only fires on actual state changes
  useEffect(() => {
    let previousAddress: string | null = null
    let previousConnectorName: string | null = null

    const unsubscribe = watchAccount(wagmiConfig, {
      onChange: (data, prevData) => {
        // Only handle actual changes
        if (data.status === 'connected' && data.address && data.connector) {
          const current = useWalletStore.getState().connectedWallet
          const normalizedAddress = data.address.toLowerCase()

          // CRITICAL: Ignore wagmi connections if we already have a Fuel wallet
          if (current?.isFuel) {
            return
          }

          // CRITICAL: If already connected to an EVM wallet, only accept updates from the SAME connector
          // This prevents Rabby/MetaMask/Phantom from fighting over the active account
          if (current && current.isFuel === false && current.type !== data.connector.name) {
            return
          }

          // Only process if address or connector actually changed
          if (normalizedAddress !== previousAddress || data.connector.name !== previousConnectorName) {
            previousAddress = normalizedAddress
            previousConnectorName = data.connector.name
            handleConnect(data.address, false, data.connector, data.connector.name)
          }
        } else if (data.status === 'disconnected' && prevData?.status === 'connected') {
          // Handle disconnect
          const current = useWalletStore.getState().connectedWallet
          if (current && current.isFuel === false) {
            previousAddress = null
            previousConnectorName = null
            handleDisconnect('wagmi.watchAccount (disconnected)')
          }
        }
      },
    })

    return () => {
      unsubscribe()
    }
  }, [handleConnect, handleDisconnect])

  return null
}
