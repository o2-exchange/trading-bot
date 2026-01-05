import { Wallet, Provider, Account, Address, bn, BYTES_32 } from 'fuels'
import { pad } from 'viem'
import { o2ApiService } from './o2ApiService'
import { walletService, fuel } from './walletService'
import { tradingAccountService } from './tradingAccountService'
import { TradeAccountManager } from './tradeAccountManager'
import { FuelSessionSigner } from './fuelSessionSigner'
import { EthereumAccountAdapter } from './ethereumAccountAdapter'
// import { createFuelAccountAdapter } from './fuelAccountAdapter'
import { Session, SessionCreationParams, SessionKey } from '../types/session'
import { db } from './dbService'
import { encrypt, decrypt } from '../utils/encryption'
import { DEFAULT_SESSION_EXPIRY_MS, FUEL_PROVIDER_URL } from '../constants/o2Constants'

/**
 * Determines if a wallet connector supports the sponsored (API-based) session creation flow.
 * Bako Safe and Fuelet don't support signMessage(), so they must use on-chain transaction flow.
 */
function supportsSponsorship(walletType: string): boolean {
  const unsupportedWallets = ['bako-safe', 'fuelet']
  return !unsupportedWallets.includes(walletType)
}
import { useSessionStore } from '../stores/useSessionStore'
import { SessionInput } from '../types/contracts/TradeAccount'
import { TradingAccount } from '../types/tradingAccount'

class SessionService {
  private password: string | null = null

  setPassword(password: string) {
    this.password = password
  }

  async createSession(
    ownerAddress: string,
    contractIds: string[],
    expiry?: number,
    tradingAccount?: TradingAccount
  ): Promise<Session> {
    console.log('[SessionService] ===== Starting session creation =====')
    console.log('[SessionService] Owner address:', ownerAddress)
    console.log('[SessionService] Contract IDs:', contractIds.length)

    if (!this.password) {
      throw new Error('Password not set for session encryption')
    }

    // Normalize address
    const normalizedAddress = ownerAddress.toLowerCase()

    // Get or create trading account (use provided one or fetch it)
    const account = tradingAccount || await tradingAccountService.getOrCreateTradingAccount(normalizedAddress)
    console.log('[SessionService] Trading account ID:', account.id)

    // Get owner account (supports both Fuel and Ethereum wallets)
    const connectedWallet = walletService.getConnectedWallet()
    if (!connectedWallet) {
      throw new Error('No wallet connected')
    }

    console.log('[SessionService] Wallet type:', connectedWallet.isFuel ? 'Fuel' : 'Ethereum')

    // Create provider for account adapter
    console.log('[SessionService] Creating Fuel provider...')
    const provider = new Provider(FUEL_PROVIDER_URL)
    await provider.init()
    console.log('[SessionService] Provider initialized')

    let ownerAccount: Account

    if (connectedWallet.isFuel) {
      // Fuel wallet - use fuel.getWallet() directly like O2 does
      // This returns an Account connected to the wallet extension via connector
      console.log('[SessionService] Getting Fuel wallet via fuel.getWallet() for:', connectedWallet.address)
      const fuelAddress = Address.fromString(connectedWallet.address)
      ownerAccount = await fuel.getWallet(fuelAddress, provider)
      console.log('[SessionService] Fuel wallet obtained, address:', ownerAccount.address.toB256())
    } else {
      // Ethereum wallet - create adapter
      console.log('[SessionService] Creating Ethereum account adapter for:', normalizedAddress)
      const ethAddress = Address.fromString(connectedWallet.address)
      ownerAccount = new EthereumAccountAdapter({
        address: ethAddress,
        provider,
      })
      console.log('[SessionService] Ethereum adapter created successfully')
    }

    // Generate session wallet first to get the private key
    console.log('[SessionService] Generating session wallet...')
    const sessionWallet = Wallet.generate({ provider })
    const sessionPrivateKey = (sessionWallet as any).privateKey
    const sessionAddress = sessionWallet.address.toB256()
    console.log('[SessionService] Session address:', sessionAddress)

    // Create session signer from the generated wallet's private key
    console.log('[SessionService] Creating session signer...')
    const sessionSigner = new FuelSessionSigner(sessionPrivateKey as any)

    // Create TradeAccountManager
    console.log('[SessionService] Creating TradeAccountManager...')
    const tradeAccountManager = new TradeAccountManager({
      account: ownerAccount as Account,
      signer: sessionSigner,
      tradeAccountId: Address.fromString(account.id).toB256() as any,
      defaultGasLimit: undefined, // Use default
    })
    console.log('[SessionService] TradeAccountManager created')

    // Fetch current nonce
    console.log('[SessionService] Fetching nonce...')
    await tradeAccountManager.fetchNonce()
    console.log('[SessionService] Nonce:', tradeAccountManager.nonce.toString())

    // IMPORTANT: expiry must be in SECONDS (Unix timestamp), not milliseconds!
    const expiryInSeconds = expiry
      ? Math.floor(expiry / 1000)  // Convert ms to seconds if provided
      : Math.floor(Date.now() / 1000) + Math.floor(DEFAULT_SESSION_EXPIRY_MS / 1000)
    console.log('[SessionService] Expiry timestamp (seconds):', expiryInSeconds, '- Date:', new Date(expiryInSeconds * 1000).toISOString())

    // Check if wallet supports sponsored flow (message signing)
    // Bako Safe and Fuelet don't support signMessage(), so they must use on-chain transaction flow
    const useSponsorship = supportsSponsorship(connectedWallet.type)
    console.log('[SessionService] Wallet type:', connectedWallet.type, '- Supports sponsorship:', useSponsorship)

    let createdSession: SessionInput
    try {
      if (useSponsorship) {
        // SPONSORED FLOW: Sign message, O2 API pays gas
        // Works for Fuel Wallet, MetaMask, and other wallets that support signMessage()
        console.log('[SessionService] Using SPONSORED flow (API-based)')

        // Generate session params (this will prompt user to sign a message)
        const sessionParams = await tradeAccountManager.api_CreateSessionParams(contractIds, expiryInSeconds)
        console.log('[SessionService] ✅ Session params generated (user signed!)')
        console.log('[SessionService] Session params:', {
          contract_id: sessionParams.contract_id,
          session_id: typeof sessionParams.session_id === 'object'
            ? (sessionParams.session_id as any)?.Address || JSON.stringify(sessionParams.session_id)
            : sessionParams.session_id,
          nonce: sessionParams.nonce,
          expiry: sessionParams.expiry,
          contract_ids_count: sessionParams.contract_ids?.length
        })

        // Convert owner address to B256 format for O2-Owner-Id header
        let ownerIdForHeader: string
        if (connectedWallet.isFuel) {
          // Fuel wallet - convert directly to B256
          const fuelAddress = Address.fromString(connectedWallet.address)
          ownerIdForHeader = fuelAddress.toB256()
          console.log('[SessionService] Fuel wallet - owner ID for header:', ownerIdForHeader)
        } else {
          // Ethereum wallet - pad to 32 bytes then convert to B256
          const paddedAddress = pad(normalizedAddress as `0x${string}`, { size: BYTES_32 })
          const fuelAddress = Address.fromString(paddedAddress)
          ownerIdForHeader = fuelAddress.toB256()
          console.log('[SessionService] Ethereum wallet - owner ID for header:', ownerIdForHeader)
        }

        // Create session via API
        console.log('[SessionService] Calling O2 API to create session...')
        await o2ApiService.createSession(
          {
            contract_id: sessionParams.contract_id,
            session_id: sessionParams.session_id as any,
            signature: sessionParams.signature as any,
            nonce: sessionParams.nonce,
            expiry: sessionParams.expiry,
            contract_ids: sessionParams.contract_ids,
          },
          ownerIdForHeader
        )
        console.log('[SessionService] ✅ Session API call successful')

        // Build the session object for local storage
        createdSession = {
          session_id: {
            Address: { bits: sessionAddress },
          },
          expiry: {
            unix: bn(expiryInSeconds.toString()),
          },
          contract_ids: contractIds.map((id) => ({ bits: id })),
        }

        // Try to recover session to verify
        try {
          const recoveredSession = await tradeAccountManager.recoverSession()
          tradeAccountManager.setSession(recoveredSession)
        } catch (error) {
          // Session already set, recovery is just verification
          console.warn('Could not recover session immediately (using local session)', error)
        }
      } else {
        // NON-SPONSORED FLOW: Create session on-chain via transaction
        // Required for Bako Safe and Fuelet which don't support signMessage()
        // User pays gas but transaction signing works with these wallets
        console.log('[SessionService] Using NON-SPONSORED flow (on-chain transaction)')
        console.log('[SessionService] This wallet does not support message signing, using transaction-based session creation')

        // Create session directly on-chain (this prompts user to sign a TRANSACTION, not a message)
        createdSession = await tradeAccountManager.newSession(contractIds, expiryInSeconds)
        console.log('[SessionService] ✅ Session created on-chain successfully')
      }
    } catch (error: any) {
      console.error('[SessionService] ❌ Error creating session:', error)
      if (error.response?.data) {
        console.error('[SessionService] API Error:', JSON.stringify(error.response.data, null, 2))
      }
      throw new Error(`Failed to create session: ${error.message}`)
    }

    // Update nonce in database (newSession already incremented it in memory)
    try {
      await tradingAccountService.updateNonce(account.id, parseInt(tradeAccountManager.nonce.toString()))
    } catch (error) {
      console.error('Failed to update nonce in database:', error)
      // Don't throw - nonce update failure shouldn't block session creation
    }

    // Encrypt and store session key
    let encryptedData: string, salt: string, iv: string
    try {
      const sessionKeyData = JSON.stringify({
        privateKey: sessionPrivateKey,
        address: sessionAddress,
      })

      const encrypted = await encrypt(sessionKeyData, this.password)
      encryptedData = encrypted.encryptedData
      salt = encrypted.salt
      iv = encrypted.iv

      await db.sessionKeys.put({
        id: sessionAddress,
        encryptedPrivateKey: encryptedData,
        salt,
        iv,
        createdAt: Date.now(),
      })
      console.log('Session key stored in database')
    } catch (error) {
      console.error('Failed to store session key:', error)
      throw new Error(`Failed to store session key: ${error}`)
    }

    // Store session metadata
    const session: Session = {
      id: sessionAddress,
      tradeAccountId: account.id,
      ownerAddress: normalizedAddress,
      contractIds,
      expiry: expiryInSeconds * 1000,  // Store as milliseconds for JS Date compatibility
      createdAt: Date.now(),
      isActive: true,
    }

    try {
      await db.sessions.put(session)
      console.log('Session metadata stored in database:', session.id)
    } catch (error) {
      console.error('Failed to store session metadata:', error)
      throw new Error(`Failed to store session metadata: ${error}`)
    }

    // Store session in zustand store (for cache) - indexed by trading account ID
    try {
      // Use the session that was created on-chain
      useSessionStore.getState().setSession(account.id as `0x${string}`, createdSession)
      console.log('[SessionService] Session cached with trading account ID:', account.id)
    } catch (error) {
      console.warn('Failed to store session in cache', error)
    }

    return session
  }

  async getSession(sessionId: string): Promise<Session | null> {
    return (await db.sessions.get(sessionId)) || null
  }

  /**
   * Validates a session by checking if it's expired or revoked
   * CRITICAL: This now includes ON-CHAIN validation to detect session revocation
   *
   * Error handling strategy:
   * - Expired sessions: Clear and return false (definitive)
   * - Revoked on-chain: Clear and return false (definitive)
   * - Network errors: Return true (let trading fail if session is actually bad)
   */
  async validateSession(
    tradingAccountId: string,
    ownerAddress: string,
    skipOnChainValidation = false
  ): Promise<boolean> {
    try {
      // Get session from cache
      const cachedSession = useSessionStore.getState().getSession(tradingAccountId as `0x${string}`)
      if (!cachedSession) {
        console.log('[SessionService] No cached session found')
        return false
      }

      // Check expiry locally first
      const expiry = BigInt(cachedSession.expiry.unix.toString())
      const now = BigInt(Math.floor(Date.now() / 1000))

      if (expiry < now) {
        console.log('[SessionService] Session expired')
        // Clear expired session - this is definitive
        useSessionStore.getState().clearSessionForAccount(tradingAccountId as `0x${string}`)
        return false
      }

      // Get session from database
      const sessionId = cachedSession.session_id.Address?.bits
      if (!sessionId) {
        console.log('[SessionService] Invalid session ID format')
        useSessionStore.getState().clearSessionForAccount(tradingAccountId as `0x${string}`)
        return false
      }

      const dbSession = await db.sessions.get(sessionId)
      if (!dbSession || !dbSession.isActive) {
        console.log('[SessionService] Session not found in DB or inactive')
        useSessionStore.getState().clearSessionForAccount(tradingAccountId as `0x${string}`)
        return false
      }

      // Check if session matches the database
      if (dbSession.tradeAccountId.toLowerCase() !== tradingAccountId.toLowerCase()) {
        console.log('[SessionService] Session trading account mismatch')
        useSessionStore.getState().clearSessionForAccount(tradingAccountId as `0x${string}`)
        return false
      }

      // CRITICAL: Validate on-chain to detect session revocation
      // This is what catches when user signs in another O2 app
      if (!skipOnChainValidation) {
        console.log('[SessionService] Performing on-chain session validation...')
        try {
          const { sessionManagerService } = await import('./sessionManagerService')

          // Get the trading account manager (which will have the session set)
          const manager = await sessionManagerService.getTradeAccountManager(ownerAddress, false)

          if (!manager) {
            // Can't get manager - but session looks valid locally
            // Return true and let actual trading fail if session is bad
            console.warn('[SessionService] Could not get manager for validation - assuming valid')
            return true
          }

          // Validate session on-chain
          const isValidOnChain = await manager.validateSession()

          if (!isValidOnChain) {
            console.log('[SessionService] ❌ Session invalid on-chain - clearing session for this account')
            // Session was revoked (e.g., user signed in another app)
            // Only clear the specific account's session, not ALL sessions
            useSessionStore.getState().clearSessionForAccount(tradingAccountId as `0x${string}`)
            // Also mark as inactive in DB
            await this.deactivateSession(sessionId)
            return false
          }

          console.log('[SessionService] ✅ Session valid on-chain')
        } catch (error) {
          // Network error or other transient issue
          // DON'T clear session - it looks valid locally
          // Let actual trading fail if session is truly invalid
          console.warn('[SessionService] On-chain validation error (treating as valid):', error)
          return true
        }
      }

      return true
    } catch (error) {
      console.error('[SessionService] Error validating session:', error)
      // On general errors, return false but don't clear session
      return false
    }
  }

  async getActiveSession(ownerAddress: string, skipValidation = false): Promise<Session | null> {
    // Normalize address for query
    const normalizedAddress = ownerAddress.toLowerCase()

    // First check cache in zustand store
    const tradingAccount = await tradingAccountService.getTradingAccount(normalizedAddress)
    if (tradingAccount) {
      const cachedSession = useSessionStore.getState().getSession(tradingAccount.id as `0x${string}`)
      if (cachedSession) {
        // Get the full session from database
        const sessionId = cachedSession.session_id.Address?.bits
        if (sessionId) {
          const dbSession = await db.sessions.get(sessionId)
          if (dbSession && dbSession.isActive && dbSession.expiry > Date.now()) {
            // Only validate if not skipping (to prevent infinite recursion)
            if (!skipValidation) {
              // CRITICAL: Validate the session before using it (including on-chain check)
              const isValid = await this.validateSession(
                tradingAccount.id,
                normalizedAddress,
                false // DO NOT skip on-chain validation - this is critical!
              )
              if (!isValid) {
                // If invalid, clear it
                useSessionStore.getState().clearSessionForAccount(tradingAccount.id as `0x${string}`)
                return null
              }
            }
            return dbSession
          }
        }
      }
    }

    // Fallback to database query
    const allSessions = await db.sessions
      .where('ownerAddress')
      .equals(normalizedAddress)
      .toArray()

    const activeSessions = allSessions
      .filter((s) => s.isActive && s.expiry > Date.now())
      .sort((a, b) => b.createdAt - a.createdAt)

    return activeSessions.length > 0 ? activeSessions[0] : null
  }

  async hasActiveSession(ownerAddress: string): Promise<boolean> {
    const session = await this.getActiveSession(ownerAddress)
    return session !== null
  }

  async getSessionKey(sessionId: string): Promise<SessionKey | null> {
    if (!this.password) {
      throw new Error('Password not set for session decryption')
    }

    const encrypted = await db.sessionKeys.get(sessionId)
    if (!encrypted) {
      return null
    }

    const decrypted = await decrypt(
      encrypted.encryptedPrivateKey,
      this.password,
      encrypted.salt,
      encrypted.iv
    )

    const keyData = JSON.parse(decrypted)
    return {
      privateKey: keyData.privateKey,
      address: keyData.address,
    }
  }

  async deactivateSession(sessionId: string): Promise<void> {
    await db.sessions.update(sessionId, { isActive: false })
  }

  async deleteSession(sessionId: string): Promise<void> {
    await db.sessions.delete(sessionId)
    await db.sessionKeys.delete(sessionId)
  }
}

export const sessionService = new SessionService()

