import { Account, Address, Provider, bn } from 'fuels'
import { pad } from 'viem'
import { TradeAccountManager } from './tradeAccountManager'
import { FuelSessionSigner } from './fuelSessionSigner'
import { EthereumAccountAdapter } from './ethereumAccountAdapter'
import { sessionService } from './sessionService'
import { walletService, fuel } from './walletService'
import { o2ApiService } from './o2ApiService'
import { FUEL_PROVIDER_URL } from '../constants/o2Constants'
import { BYTES_32 } from 'fuels'
import { useSessionStore } from '../stores/useSessionStore'
import { SessionInput } from '../types/contracts/TradeAccount'

class SessionManagerService {
  private managers: Map<string, TradeAccountManager> = new Map()

  async getTradeAccountManager(ownerAddress: string, refreshNonce: boolean = false): Promise<TradeAccountManager> {
    // Normalize address
    const normalizedAddress = ownerAddress.toLowerCase()
    
    // Check if we already have a manager for this session
    // CRITICAL: Skip validation here to prevent infinite recursion
    // (this is called FROM validateSession, so we can't validate again!)
    const session = await sessionService.getActiveSession(normalizedAddress, true)
    if (!session) {
      throw new Error('No active session found. Please create a session first.')
    }

    const cacheKey = `${normalizedAddress}-${session.id}`
    if (this.managers.has(cacheKey)) {
      const cachedManager = this.managers.get(cacheKey)!
      // If refreshNonce is true, fetch latest nonce from API before returning (matching O2 frontend)
      if (refreshNonce) {
        // Get owner ID for API call
        const wallet = walletService.getConnectedWallet()
        let ownerIdForHeader: string
        if (wallet && !wallet.isFuel) {
          const paddedAddress = pad(normalizedAddress as `0x${string}`, { size: BYTES_32 })
          const fuelAddress = Address.fromString(paddedAddress)
          ownerIdForHeader = fuelAddress.toB256()
        } else {
          const fuelAddress = Address.fromString(normalizedAddress)
          ownerIdForHeader = fuelAddress.toB256()
        }
        await cachedManager.fetchNonceFromAPI(session.tradeAccountId, ownerIdForHeader, o2ApiService)
      }
      return cachedManager
    }

    // Get owner account (supports both Fuel and Ethereum wallets)
    const connectedWallet = walletService.getConnectedWallet()
    if (!connectedWallet) {
      throw new Error('No wallet connected')
    }

    // Create provider for account adapter
    const provider = new Provider(FUEL_PROVIDER_URL)
    await provider.init()

    let ownerAccount: Account

    if (connectedWallet.isFuel) {
      // Fuel wallet - use fuel.getWallet() directly like O2 does
      console.log('[SessionManagerService] Getting Fuel wallet via fuel.getWallet() for:', connectedWallet.address)
      const fuelAddress = Address.fromString(connectedWallet.address)
      ownerAccount = await fuel.getWallet(fuelAddress, provider)
    } else {
      // Ethereum wallet - create adapter
      const ethAddress = Address.fromString(connectedWallet.address)
      ownerAccount = new EthereumAccountAdapter({
        address: ethAddress,
        provider,
      })
    }

    // Get session key (session.id is the session address, not normalized)
    const sessionKey = await sessionService.getSessionKey(session.id)
    if (!sessionKey) {
      throw new Error('Session key not found. Please recreate the session.')
    }

    // Create session signer from stored key
    const sessionSigner = new FuelSessionSigner(sessionKey.privateKey as any)

    // Create TradeAccountManager
    const manager = new TradeAccountManager({
      account: ownerAccount,
      signer: sessionSigner,
      tradeAccountId: Address.fromString(session.tradeAccountId).toB256() as any,
    })

    // Fetch nonce from API (matching O2 frontend behavior)
    const wallet = walletService.getConnectedWallet()
    let ownerIdForHeader: string
    if (wallet && !wallet.isFuel) {
      const paddedAddress = pad(normalizedAddress as `0x${string}`, { size: BYTES_32 })
      const fuelAddress = Address.fromString(paddedAddress)
      ownerIdForHeader = fuelAddress.toB256()
    } else {
      const fuelAddress = Address.fromString(normalizedAddress)
      ownerIdForHeader = fuelAddress.toB256()
    }
    await manager.fetchNonceFromAPI(session.tradeAccountId, ownerIdForHeader, o2ApiService)

    // Try to recover session from chain
    let sessionSet = false
    try {
      await manager.recoverSession()
      sessionSet = true
      console.log('[SessionManagerService] Session recovered from chain')
    } catch (error) {
      console.warn('[SessionManagerService] Could not recover session from chain, trying store...', error)

      // Fallback: get session from store
      const storedSession = useSessionStore.getState().getSession(session.tradeAccountId as `0x${string}`)
      if (storedSession) {
        manager.setSession(storedSession)
        sessionSet = true
        console.log('[SessionManagerService] Session set from store')
      } else {
        // If store doesn't have it, construct from database session
        console.log('[SessionManagerService] No session in store, constructing from database...')
        const sessionInput: SessionInput = {
          session_id: {
            Address: { bits: session.id },
          },
          expiry: {
            unix: bn(session.expiry.toString()),
          },
          contract_ids: session.contractIds.map((id) => ({ bits: id })),
        }
        manager.setSession(sessionInput)
        sessionSet = true
        console.log('[SessionManagerService] Session constructed from database')
      }
    }

    // Verify session is set before proceeding
    if (!sessionSet) {
      throw new Error('Could not initialize session: neither on-chain recovery nor store/database retrieval succeeded')
    }

    this.managers.set(cacheKey, manager)
    return manager
  }

  clearManager(ownerAddress: string, sessionId: string) {
    const cacheKey = `${ownerAddress}-${sessionId}`
    this.managers.delete(cacheKey)
  }

  clearAll() {
    this.managers.clear()
  }
}

export const sessionManagerService = new SessionManagerService()

