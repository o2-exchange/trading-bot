import { useSessionStore } from '../stores/useSessionStore'
import { useTermsOfUseStore } from '../stores/useTermsOfUseStore'
import { usePrivateKeysStore } from '../stores/usePrivateKeysStore'
import { useTradingAccountAddressesStore } from '../stores/useTradingAccountAddressesStore'
import { db } from '../services/dbService'

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
 * This clears EVERYTHING including T&C acceptance and IndexedDB sessions
 * NOTE: This is now async because it clears IndexedDB
 */
export async function clearUserStorageForAccountChange(previousAddress?: string): Promise<void> {
  console.log('[clearUserStorage] Account changed - clearing ALL data including T&C')

  // Clear sessions (Zustand)
  const sessionStore = useSessionStore.getState()
  sessionStore.clearSessions()

  // Clear IndexedDB sessions for the previous address
  // This ensures no stale session data persists in IndexedDB
  if (previousAddress) {
    try {
      const sessionsToDelete = await db.sessions
        .where('ownerAddress')
        .equals(previousAddress.toLowerCase())
        .toArray()

      for (const session of sessionsToDelete) {
        await db.sessions.delete(session.id)
        // Also delete corresponding session keys
        await db.sessionKeys.delete(session.id)
      }
      console.log('[clearUserStorage] Cleared IndexedDB sessions for:', previousAddress)
    } catch (error) {
      console.warn('[clearUserStorage] Failed to clear IndexedDB:', error)
    }
  }

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

/**
 * Clears ALL session storage across all layers (Zustand + IndexedDB)
 * Use this for "Clear & Retry" functionality to ensure clean state
 */
export async function clearAllSessionStorage(): Promise<void> {
  console.log('[clearUserStorage] Clearing all session storage layers')

  // 1. Clear Zustand session store
  const sessionStore = useSessionStore.getState()
  sessionStore.clearSessions()

  // 2. Clear IndexedDB sessions table
  try {
    await db.sessions.clear()
    console.log('[clearUserStorage] IndexedDB sessions cleared')
  } catch (error) {
    console.warn('[clearUserStorage] Failed to clear IndexedDB sessions:', error)
  }

  // 3. Clear IndexedDB sessionKeys table
  try {
    await db.sessionKeys.clear()
    console.log('[clearUserStorage] IndexedDB sessionKeys cleared')
  } catch (error) {
    console.warn('[clearUserStorage] Failed to clear IndexedDB sessionKeys:', error)
  }

  // 4. Clear private keys store
  const privateKeysStore = usePrivateKeysStore.getState()
  privateKeysStore.clearPrivateKeys()

  console.log('[clearUserStorage] All session storage layers cleared')

  // 5. Reset strategy configs (averageBuyPrice, lastFillPrices)
  await resetStrategyConfigs()
}

/**
 * Resets strategy config session state (averageBuyPrice, lastFillPrices)
 * without clearing user's strategy settings (spread, order type, etc.)
 * Use this when starting a new session to prevent stale buy prices affecting sell orders
 */
export async function resetStrategyConfigs(): Promise<void> {
  try {
    const configs = await db.strategyConfigs.toArray()
    for (const config of configs) {
      await db.strategyConfigs.update(config.id, {
        config: {
          ...config.config,
          averageBuyPrice: undefined,
          averageSellPrice: undefined,
          lastFillPrices: { buy: [], sell: [] }
        },
        version: (config.version ?? 0) + 1
      })
    }
    console.log('[clearUserStorage] Strategy configs reset (cleared averageBuyPrice, lastFillPrices)')
  } catch (error) {
    console.warn('[clearUserStorage] Failed to reset strategy configs:', error)
  }

  // Also clear processed fills to prevent stale fill tracking
  try {
    await db.processedFills.clear()
    console.log('[clearUserStorage] Processed fills cleared')
  } catch (error) {
    console.warn('[clearUserStorage] Failed to clear processed fills:', error)
  }
}
