import { useSessionStore } from '../stores/useSessionStore'
import { useTermsOfUseStore } from '../stores/useTermsOfUseStore'
import { usePrivateKeysStore } from '../stores/usePrivateKeysStore'
import { useTradingAccountAddressesStore } from '../stores/useTradingAccountAddressesStore'

/**
 * Clears user data when disconnecting wallet
 * IMPORTANT: Keeps T&C acceptance so user doesn't have to re-accept when reconnecting
 * This matches O2's behavior - T&C acceptance persists across disconnects
 */
export function clearUserStorage() {
  console.log('[clearUserStorage] Clearing user data (keeping T&C acceptance)')

  // Clear sessions - critical for session invalidation
  const sessionStore = useSessionStore.getState()
  sessionStore.clearSessions()

  // DO NOT clear terms acceptance here!
  // T&C acceptance should persist across disconnects (like O2 does)
  // Only clear when switching to a different address

  // Clear private keys (sensitive user data)
  const privateKeysStore = usePrivateKeysStore.getState()
  privateKeysStore.clearPrivateKeys()

  // Clear trading account mappings
  const tradingAccountStore = useTradingAccountAddressesStore.getState()
  tradingAccountStore.clearContracts()

  console.log('[clearUserStorage] User data cleared (T&C preserved)')
}

/**
 * Clears user data when switching to a DIFFERENT wallet address
 * This clears EVERYTHING including T&C acceptance
 */
export function clearUserStorageForAccountChange(previousAddress?: string) {
  console.log('[clearUserStorage] Account changed - clearing ALL data including T&C')

  // Clear sessions
  const sessionStore = useSessionStore.getState()
  sessionStore.clearSessions()

  // Clear T&C acceptance for the OLD address only
  if (previousAddress) {
    const termsStore = useTermsOfUseStore.getState()
    termsStore.setAcceptance(previousAddress, false)
  }

  // Clear private keys
  const privateKeysStore = usePrivateKeysStore.getState()
  privateKeysStore.clearPrivateKeys()

  // Clear trading account mappings
  const tradingAccountStore = useTradingAccountAddressesStore.getState()
  tradingAccountStore.clearContracts()

  console.log('[clearUserStorage] All data cleared for account change')
}
