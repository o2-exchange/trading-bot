import { useEffect, useCallback, useRef } from 'react'
import { useWalletStore } from '../stores/useWalletStore'
import { walletService, fuel } from '../services/walletService'
import { useAccount, useAccountEffect } from 'wagmi'
import { clearUserStorage, clearUserStorageForAccountChange } from '../utils/clearUserStorage'
import { authFlowService } from '../services/authFlowService'

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

  // Handle wallet disconnect
  const handleDisconnect = useCallback((source?: string) => {
    console.log('[WalletWatcher] ===== WALLET DISCONNECTED =====')
    console.log('[WalletWatcher] Disconnect source:', source || 'unknown')
    console.log('[WalletWatcher] Stack trace:', new Error().stack)

    // Clear wallet store
    clearWallet()

    // CRITICAL: Clear all user storage (sessions, keys, terms, etc.)
    clearUserStorage()

    // Reset auth flow
    authFlowService.reset()

    previousAddressRef.current = null
  }, [clearWallet])

  // Handle wallet connection/account change
  const handleConnect = useCallback((address: string, isFuel: boolean, connector: any, type: string) => {
    const normalizedAddress = address.toLowerCase()

    // Check if this is an account change (not initial connect)
    if (previousAddressRef.current && previousAddressRef.current !== normalizedAddress) {
      console.log('[WalletWatcher] Account changed from', previousAddressRef.current, 'to', normalizedAddress)

      // CRITICAL: Clear all data including T&C for the OLD address
      clearUserStorageForAccountChange(previousAddressRef.current)

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

      const currentWallet = useWalletStore.getState().connectedWallet

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
  }, [handleConnect, handleDisconnect])

  // Watch Ethereum wallet connection via wagmi
  useAccountEffect({
    onConnect({ address, connector }) {
      if (address && connector) {
        // CRITICAL: Ignore wagmi connections if we already have a Fuel wallet
        const current = useWalletStore.getState().connectedWallet
        if (current?.isFuel) {
          console.log('[WalletWatcher] wagmi onConnect but Fuel wallet already connected - ignoring')
          return
        }
        handleConnect(address, false, connector, connector.name)
      }
    },
    onDisconnect() {
      const current = useWalletStore.getState().connectedWallet
      // CRITICAL: Only disconnect if wallet is EXPLICITLY a non-Fuel wallet
      if (current && current.isFuel === false) {
        handleDisconnect('wagmi.onDisconnect')
      }
    },
  })

  // Watch for Ethereum account changes
  const { address: evmAddress, isConnected: isEvmConnected, connector: evmConnector } = useAccount()

  useEffect(() => {
    const current = useWalletStore.getState().connectedWallet

    if (isEvmConnected && evmAddress && evmConnector) {
      // CRITICAL: Ignore wagmi connections if we already have a Fuel wallet
      // Fuel wallet extensions inject Ethereum providers, causing wagmi to detect them
      if (current?.isFuel) {
        console.log('[WalletWatcher] wagmi detected EVM connection but Fuel wallet already connected - ignoring')
        return
      }

      console.log('[WalletWatcher] wagmi detected EVM connection')
      handleConnect(evmAddress, false, evmConnector, evmConnector.name)
    } else if (!isEvmConnected) {
      console.log('[WalletWatcher] wagmi useAccount - isEvmConnected:', isEvmConnected)
      console.log('[WalletWatcher] wagmi useAccount - current wallet:', current)
      console.log('[WalletWatcher] wagmi useAccount - current?.isFuel:', current?.isFuel)
      console.log('[WalletWatcher] wagmi useAccount - typeof current?.isFuel:', typeof current?.isFuel)

      // CRITICAL: Only disconnect if wallet is EXPLICITLY a non-Fuel wallet
      // Using === false to avoid disconnecting when isFuel is undefined
      if (current && current.isFuel === false) {
        console.log('[WalletWatcher] wagmi triggering disconnect for EVM wallet')
        handleDisconnect('wagmi.useAccount (isConnected=false)')
      } else if (current && current.isFuel === true) {
        console.log('[WalletWatcher] wagmi ignoring disconnect - Fuel wallet is connected')
      } else {
        console.log('[WalletWatcher] wagmi ignoring disconnect - no wallet or unclear state')
      }
    }
  }, [isEvmConnected, evmAddress, evmConnector, handleConnect, handleDisconnect])

  return null
}
