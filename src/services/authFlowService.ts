import { tradingAccountService } from './tradingAccountService'
import { sessionService } from './sessionService'
import { eligibilityService } from './eligibilityService'
import { useTermsOfUseStore } from '../stores/useTermsOfUseStore'
import { useSessionStore } from '../stores/useSessionStore'
import { useWelcomeStore } from '../stores/useWelcomeStore'
import { walletService } from './walletService'
import { marketService } from './marketService'
import { whitelistService } from './whitelistService'
import { TradingAccount } from '../types/tradingAccount'

export type AuthFlowState =
  | 'idle'
  | 'checkingSituation'
  | 'checkingTerms'
  | 'awaitingTerms'
  | 'verifyingAccessQueue'
  | 'displayingAccessQueue'
  | 'awaitingInvitation'
  | 'awaitingSignature'
  | 'signatureDeclined'
  | 'creatingSession'
  | 'awaitingWelcome'
  | 'ready'
  | 'error'

export interface AuthFlowContext {
  state: AuthFlowState
  error: string | null
  isWhitelisted: boolean | null
  termsAccepted: boolean
  tradingAccount: TradingAccount | null
  accessQueue: {
    queuePosition: number | null
    email: string | null
    telegram: string | null
  }
  invitationCode: string | null
  sessionId: string | null
  pendingSession: {
    contractIds: string[]
  } | null
}

class AuthFlowService {
  private context: AuthFlowContext = {
    state: 'idle',
    error: null,
    isWhitelisted: null,
    termsAccepted: false,
    tradingAccount: null,
    accessQueue: {
      queuePosition: null,
      email: null,
      telegram: null,
    },
    invitationCode: null,
    sessionId: null,
    pendingSession: null,
  }

  private listeners: Set<(context: AuthFlowContext) => void> = new Set()

  // Prevent concurrent startFlow calls (e.g., from React strict mode)
  private isFlowRunning = false

  // Abort controller for cancelling in-progress flows (e.g., on wallet change)
  private abortController: AbortController | null = null

  subscribe(listener: (context: AuthFlowContext) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify() {
    this.listeners.forEach((listener) => listener(this.context))
  }

  private setState(updates: Partial<AuthFlowContext>) {
    this.context = { ...this.context, ...updates }
    this.notify()
  }

  getState(): AuthFlowContext {
    return { ...this.context }
  }

  /**
   * Abort the current auth flow if one is running.
   * Use this when wallet changes to prevent stale data.
   */
  abort() {
    if (this.abortController) {
      console.log('[AuthFlow] Aborting current flow')
      this.abortController.abort()
      this.abortController = null
    }
    this.isFlowRunning = false
  }

  /**
   * Check if the current flow has been aborted.
   */
  private isAborted(): boolean {
    return this.abortController?.signal.aborted ?? false
  }

  async startFlow(): Promise<void> {
    // CRITICAL: Prevent concurrent calls (e.g., from React strict mode double-mounting)
    // This prevents duplicate API calls that cause 429 rate limiting
    if (this.isFlowRunning) {
      console.log('[AuthFlow] Flow already running, skipping duplicate call')
      return
    }

    // Check if we're already in a non-idle state
    if (this.context.state !== 'idle' && this.context.state !== 'error') {
      console.log('[AuthFlow] Flow already in progress, state:', this.context.state)
      return
    }

    // Cancel any previous flow and create new abort controller
    this.abort()
    this.abortController = new AbortController()
    this.isFlowRunning = true

    try {
      const wallet = walletService.getConnectedWallet()
      if (!wallet) {
        throw new Error('No wallet connected')
      }

      const normalizedAddress = wallet.address.toLowerCase()

      // Set password for session encryption/decryption early
      // This ensures it's available whether we're creating a new session
      // or retrieving an existing one
      sessionService.setPassword('default-password-change-in-production')

      // Check if aborted before continuing
      if (this.isAborted()) {
        console.log('[AuthFlow] Flow aborted before session check')
        return
      }

      // First check for active session
      const activeSession = await this.checkActiveSession(normalizedAddress)
      if (activeSession) {
        // User has active session - set ready state immediately
        // IMPORTANT: Assume whitelisted=true since user already has a valid session
        // (they passed whitelist check when session was created)
        // This prevents briefly showing "Not whitelisted" during background check
        this.setState({
          state: 'ready',
          sessionId: activeSession.id,
          isWhitelisted: true, // Assume true - user has valid session so must be whitelisted
          error: null,
        })

        // Run eligibility check in background (non-blocking) for dashboard display
        // This will update the state if for some reason they're no longer whitelisted
        this.checkEligibilityStatus(normalizedAddress).catch(() => {
          // Ignore errors - this is purely informational for dashboard
          console.log('[AuthFlow] Background eligibility check failed (non-critical)')
        })

        return
      }

      // Check if aborted before proceeding
      if (this.isAborted()) {
        console.log('[AuthFlow] Flow aborted before checkSituation')
        return
      }

      // No active session, proceed with auth flow
      this.setState({ state: 'checkingSituation', error: null })
      await this.checkSituation()
    } catch (error: any) {
      console.error('[AuthFlow] Error in startFlow:', error)
      // Set error state so UI can show retry button
      this.setState({
        state: 'error',
        error: error.message || 'Failed to start authentication flow',
      })
    } finally {
      this.isFlowRunning = false
    }
  }

  private async checkActiveSession(ownerAddress: string): Promise<{ id: string } | null> {
    try {
      // Check for abort before starting
      if (this.isAborted()) {
        console.log('[AuthFlow] checkActiveSession aborted at start')
        return null
      }

      // Get trading account first
      const tradingAccount = await tradingAccountService.getTradingAccount(ownerAddress)
      if (!tradingAccount) {
        console.log('[AuthFlow] No trading account found for active session check')
        return null
      }

      // Check for abort after trading account fetch
      if (this.isAborted()) {
        console.log('[AuthFlow] checkActiveSession aborted after trading account fetch')
        return null
      }

      // Get session from cache
      const cachedSession = useSessionStore.getState().getSession(tradingAccount.id as `0x${string}`)
      if (!cachedSession) {
        console.log('[AuthFlow] No cached session found')
        return null
      }

      // Check expiry LOCALLY first (like fuel-o2 does)
      // This avoids unnecessary on-chain calls for expired sessions
      const expiry = BigInt(cachedSession.expiry.unix.toString())
      const now = BigInt(Math.floor(Date.now() / 1000))
      if (expiry < now) {
        console.log('[AuthFlow] Session expired locally, clearing')
        useSessionStore.getState().clearSessionForAccount(tradingAccount.id as `0x${string}`)
        return null
      }

      // Check for abort before on-chain validation
      if (this.isAborted()) {
        console.log('[AuthFlow] checkActiveSession aborted before on-chain validation')
        return null
      }

      // Session looks valid locally, try on-chain validation
      console.log('[AuthFlow] Validating cached session on-chain...')
      try {
        const isValid = await sessionService.validateSession(
          tradingAccount.id,
          ownerAddress,
          false // DO NOT skip on-chain validation
        )

        // Check for abort after on-chain validation
        if (this.isAborted()) {
          console.log('[AuthFlow] checkActiveSession aborted after on-chain validation')
          return null
        }

        if (!isValid) {
          console.log('[AuthFlow] ❌ Session invalid on-chain - clearing session for this account')
          // Only clear the specific account's session, not ALL sessions
          useSessionStore.getState().clearSessionForAccount(tradingAccount.id as `0x${string}`)
          return null
        }
      } catch (validationError) {
        // On-chain validation failed (network error, etc.)
        // DON'T clear session - let user retry or proceed with locally valid session
        console.warn('[AuthFlow] On-chain validation error (may be network issue):', validationError)
        // Still return the session - it looks valid locally
        // The actual trading will fail if session is truly invalid
      }

      // Final abort check before returning
      if (this.isAborted()) {
        console.log('[AuthFlow] checkActiveSession aborted before returning session')
        return null
      }

      console.log('[AuthFlow] ✅ Session valid')

      // Get full session from database (skip validation to avoid recursion)
      const session = await sessionService.getActiveSession(ownerAddress, true)
      return session ? { id: session.id } : null
    } catch (error) {
      console.error('[AuthFlow] Error checking active session:', error)
      // DON'T clear sessions on general errors - might be network issue
      // Return null to proceed with auth flow, but don't destroy existing session
      return null
    }
  }

  private async checkEligibilityStatus(ownerAddress: string): Promise<void> {
    try {
      const normalizedAddress = ownerAddress.toLowerCase()

      // Get trading account (should be cached or fetch if needed)
      let tradingAccount = this.context.tradingAccount ||
        await tradingAccountService.getTradingAccount(normalizedAddress)

      if (!tradingAccount) {
        // Can't check without trading account - try to get or create it
        tradingAccount = await tradingAccountService.getOrCreateTradingAccount(normalizedAddress)
        this.setState({ tradingAccount })
      }

      // Fetch markets if needed (uses cache)
      await marketService.fetchMarkets()

      // Check on-chain whitelist status first (more reliable)
      const booksWhitelistId = marketService.getBooksWhitelistId()
      let isWhitelisted = false

      if (booksWhitelistId) {
        try {
          isWhitelisted = await whitelistService.checkWhitelistStatus(
            tradingAccount.id,
            booksWhitelistId
          )
        } catch (error) {
          console.warn('Failed to check on-chain whitelist status', error)
          // Fallback to API eligibility check
        }
      }

      // If not whitelisted on-chain, check API eligibility (for invitation codes, etc.)
      if (!isWhitelisted) {
        const eligibility = await eligibilityService.checkEligibility(
          normalizedAddress,
          tradingAccount.id
        )
        isWhitelisted = eligibility.isEligible && eligibility.isWhitelisted
      }

      // Update state with eligibility status
      this.setState({ isWhitelisted })
    } catch (error) {
      console.warn('[AuthFlow] Failed to check eligibility status (non-critical):', error)
      // Don't throw - this is a background check and shouldn't block the flow
      // If we have an active session, assume user is whitelisted for dashboard display
      if (this.context.sessionId) {
        this.setState({ isWhitelisted: true })
      }
    }
  }

  private async checkSituation(): Promise<void> {
    try {
      const wallet = walletService.getConnectedWallet()
      if (!wallet) {
        throw new Error('No wallet connected')
      }

      const normalizedAddress = wallet.address.toLowerCase()

      // Get or create trading account and cache it
      const tradingAccount = await tradingAccountService.getOrCreateTradingAccount(normalizedAddress)
      this.setState({ tradingAccount })

      // Fetch markets to get books_whitelist_id (uses cache if available)
      // fetchMarkets will automatically fetch from API if books_whitelist_id is missing
      await marketService.fetchMarkets()

      // Check on-chain whitelist status first (more reliable)
      let booksWhitelistId = marketService.getBooksWhitelistId()

      // If booksWhitelistId is still null, force refresh from API
      if (!booksWhitelistId) {
        console.log('[AuthFlow] booksWhitelistId not found, forcing market refresh')
        await marketService.fetchMarkets(true) // force refresh
        booksWhitelistId = marketService.getBooksWhitelistId()
      }

      console.log('[AuthFlow] booksWhitelistId:', booksWhitelistId ? 'found' : 'still null')
      console.log('[AuthFlow] tradingAccount.id:', tradingAccount.id)

      let isWhitelisted = false

      if (booksWhitelistId) {
        try {
          isWhitelisted = await whitelistService.checkWhitelistStatus(
            tradingAccount.id,
            booksWhitelistId
          )
          console.log('[AuthFlow] On-chain whitelist check result:', isWhitelisted)
        } catch (error) {
          console.warn('[AuthFlow] Failed to check on-chain whitelist status:', error)
          // Fallback to API eligibility check
        }
      } else {
        console.warn('[AuthFlow] No booksWhitelistId available, skipping on-chain check')
      }

      // If not whitelisted on-chain, check API eligibility (for invitation codes, etc.)
      if (!isWhitelisted) {
        console.log('[AuthFlow] Checking API eligibility as fallback...')
        const eligibility = await eligibilityService.checkEligibility(
          normalizedAddress,
          tradingAccount.id
        )
        console.log('[AuthFlow] API eligibility result:', eligibility)
        isWhitelisted = eligibility.isEligible && eligibility.isWhitelisted
      }

      this.setState({ isWhitelisted })

      // If whitelisted, skip to session creation (after terms check)
      if (isWhitelisted) {
        // Check terms first
        await this.checkTerms()
        return
      }

      // Not whitelisted, need to go through terms and access queue
      await this.checkTerms()
    } catch (error: any) {
      this.setState({
        state: 'error',
        error: error.message || 'Failed to check situation',
      })
    }
  }

  private async checkTerms(): Promise<void> {
    try {
      this.setState({ state: 'checkingTerms' })

      const wallet = walletService.getConnectedWallet()
      if (!wallet) {
        throw new Error('No wallet connected')
      }

      const normalizedAddress = wallet.address.toLowerCase()
      const termsStore = useTermsOfUseStore.getState()
      const accepted = termsStore.getAcceptance(normalizedAddress)

      if (accepted) {
        this.setState({ termsAccepted: true })
        // Whitelisted users skip verifyAccessQueue entirely
        if (this.context.isWhitelisted) {
          await this.createSession()
        } else {
          await this.verifyAccessQueue()
        }
      } else {
        this.setState({ state: 'awaitingTerms', termsAccepted: false })
      }
    } catch (error: any) {
      this.setState({
        state: 'error',
        error: error.message || 'Failed to check terms',
      })
    }
  }

  async acceptTerms(): Promise<void> {
    try {
      const wallet = walletService.getConnectedWallet()
      if (!wallet) {
        throw new Error('No wallet connected')
      }

      const normalizedAddress = wallet.address.toLowerCase()
      const termsStore = useTermsOfUseStore.getState()
      termsStore.setAcceptance(normalizedAddress, true)

      this.setState({ termsAccepted: true })
      // Whitelisted users skip verifyAccessQueue entirely
      if (this.context.isWhitelisted) {
        await this.createSession()
      } else {
        await this.verifyAccessQueue()
      }
    } catch (error: any) {
      this.setState({
        state: 'error',
        error: error.message || 'Failed to accept terms',
      })
    }
  }

  private async verifyAccessQueue(): Promise<void> {
    try {
      // Skip if already whitelisted (shouldn't reach here, but safety check)
      if (this.context.isWhitelisted) {
        await this.createSession()
        return
      }

      this.setState({ state: 'verifyingAccessQueue' })

      const wallet = walletService.getConnectedWallet()
      if (!wallet) {
        throw new Error('No wallet connected')
      }

      const normalizedAddress = wallet.address.toLowerCase()
      
      // Use cached trading account or fetch if not available
      const tradingAccount = this.context.tradingAccount || 
        await tradingAccountService.getOrCreateTradingAccount(normalizedAddress)
      
      // Update cache if we had to fetch it
      if (!this.context.tradingAccount) {
        this.setState({ tradingAccount })
      }

      // Check access queue via eligibility service
      const eligibility = await eligibilityService.checkEligibility(
        normalizedAddress,
        tradingAccount.id
      )

      // If eligible, proceed to session creation
      if (eligibility.isEligible) {
        // Check for invitation code from URL
        const urlInvite = eligibilityService.getInviteCodeFromUrl()
        if (urlInvite) {
          this.setState({ invitationCode: urlInvite })
          // Invitation code will be handled in createSession if needed
        }
        await this.createSession()
        return
      }

      // Not eligible - show access queue or invitation dialog
      if (eligibility.waitlistPosition !== undefined && eligibility.waitlistPosition !== null) {
        this.setState({
          state: 'displayingAccessQueue',
          accessQueue: {
            queuePosition: eligibility.waitlistPosition,
            email: null,
            telegram: null,
          },
        })
      } else {
        this.setState({ state: 'awaitingInvitation' })
      }
    } catch (error: any) {
      this.setState({
        state: 'error',
        error: error.message || 'Failed to verify access queue',
      })
    }
  }

  async assignInvitationCode(code: string): Promise<void> {
    try {
      this.setState({ state: 'verifyingAccessQueue', invitationCode: code })

      const wallet = walletService.getConnectedWallet()
      if (!wallet) {
        throw new Error('No wallet connected')
      }

      const normalizedAddress = wallet.address.toLowerCase()
      
      // Use cached trading account or fetch if not available
      const tradingAccount = this.context.tradingAccount || 
        await tradingAccountService.getOrCreateTradingAccount(normalizedAddress)
      
      // Update cache if we had to fetch it
      if (!this.context.tradingAccount) {
        this.setState({ tradingAccount })
      }

      // Assign invitation code via eligibility service
      const eligibility = await eligibilityService.checkEligibility(
        normalizedAddress,
        tradingAccount.id,
        code
      )

      if (eligibility.isEligible) {
        // Set isWhitelisted from eligibility response before creating session
        this.setState({ isWhitelisted: eligibility.isWhitelisted })
        await this.createSession()
      } else {
        // Set state AND throw error so the UI can catch it and show error toast
        const errorMessage = eligibility.error || 'Invalid invitation code'
        this.setState({
          state: 'awaitingInvitation',
          error: errorMessage,
        })
        throw new Error(errorMessage)
      }
    } catch (error: any) {
      // Update state with error
      this.setState({
        state: 'awaitingInvitation',
        error: error.message || 'Failed to assign invitation code',
      })
      // Re-throw so the UI can handle it (show error toast, keep dialog open)
      throw error
    }
  }

  private async createSession(): Promise<void> {
    try {
      const wallet = walletService.getConnectedWallet()
      if (!wallet) {
        throw new Error('No wallet connected')
      }

      console.log('[AuthFlow] Preparing session for wallet:', wallet.address, 'Type:', wallet.isFuel ? 'Fuel' : 'Ethereum')

      const normalizedAddress = wallet.address.toLowerCase()

      // Get all markets for session contract IDs (uses cache)
      console.log('[AuthFlow] Fetching markets...')
      const markets = await marketService.fetchMarkets()
      // Exclude contract ID that O2 doesn't include (from a market not in O2's whitelist)
      // Use markets in their original order (O2 doesn't sort them)
      // const EXCLUDED_CONTRACT_ID = '0xca78cbd896cd09f104cd32448e0ef155dace8a0a9ea21ad5f4f9435800038b9b'
      // const marketContractIds = markets
      //   .filter((m) => m.contract_id.toLowerCase() !== EXCLUDED_CONTRACT_ID.toLowerCase())
      //   .map((m) => m.contract_id)
      const marketContractIds = markets.map((m) => m.contract_id)
      // Include accounts_registry_id at the end if available (matching O2's pattern)
      const accountsRegistryId = marketService.getAccountsRegistryId()
      const contractIds = accountsRegistryId
        ? [...marketContractIds, accountsRegistryId]
        : marketContractIds
      console.log('[AuthFlow] Contract IDs (markets + accounts_registry):', contractIds.length)

      // Password already set at the start of startFlow() - no need to set again

      // Use cached trading account or fetch if not available
      const tradingAccount = this.context.tradingAccount ||
        await tradingAccountService.getOrCreateTradingAccount(normalizedAddress)

      // Update cache if we had to fetch it
      if (!this.context.tradingAccount) {
        this.setState({ tradingAccount })
      }

      console.log('[AuthFlow] Trading account:', tradingAccount.id)
      console.log('[AuthFlow] Ready for signature - showing confirmation dialog')

      // Instead of immediately creating session (which triggers wallet popup),
      // show a confirmation dialog first so user knows what's coming
      this.setState({
        state: 'awaitingSignature',
        pendingSession: { contractIds },
        error: null,
      })
    } catch (error: any) {
      console.error('[AuthFlow] ❌ Error preparing session:', error)
      console.error('[AuthFlow] Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      })
      this.setState({
        state: 'error',
        error: error.message || 'Failed to prepare session',
      })
    }
  }

  /**
   * Called when user confirms they want to sign the message.
   * This triggers the actual wallet signature popup.
   */
  async confirmSignature(): Promise<void> {
    if (!this.context.pendingSession) {
      throw new Error('No pending session to confirm')
    }

    try {
      this.setState({ state: 'creatingSession' })

      const wallet = walletService.getConnectedWallet()
      if (!wallet) {
        throw new Error('No wallet connected')
      }

      const normalizedAddress = wallet.address.toLowerCase()
      const { contractIds } = this.context.pendingSession

      // Use cached trading account
      const tradingAccount = this.context.tradingAccount
      if (!tradingAccount) {
        throw new Error('Trading account not found')
      }

      console.log('[AuthFlow] User confirmed - starting session creation...')

      // Create session with cached trading account
      // This is where the wallet signature popup will appear
      const session = await sessionService.createSession(
        normalizedAddress,
        contractIds,
        undefined,
        tradingAccount
      )

      console.log('[AuthFlow] ✅ Session created successfully:', session.id)

      // Clear pending session
      this.setState({ pendingSession: null })

      // Check if welcome modal has been dismissed for this wallet
      const welcomeStore = useWelcomeStore.getState()
      const welcomeDismissed = welcomeStore.getDismissed(normalizedAddress)

      if (!welcomeDismissed) {
        this.setState({
          state: 'awaitingWelcome',
          sessionId: session.id,
          isWhitelisted: true,  // User is whitelisted since session was created
          error: null,
        })
        console.log('[AuthFlow] Showing welcome modal for first-time user')
      } else {
        this.setState({
          state: 'ready',
          sessionId: session.id,
          isWhitelisted: true,  // User is whitelisted since session was created
          error: null,
        })
        console.log('[AuthFlow] Auth flow complete - ready to trade')
      }
    } catch (error: any) {
      console.error('[AuthFlow] ❌ Error creating session:', error)
      console.error('[AuthFlow] Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      })
      this.setState({
        state: 'error',
        error: error.message || 'Failed to create session',
      })
    }
  }

  /**
   * Called when user declines to sign the message.
   * Keeps wallet connected but shows a retry UI.
   */
  declineSignature(): void {
    console.log('[AuthFlow] User declined signature')
    this.setState({
      state: 'signatureDeclined',
      error: null,
    })
  }

  /**
   * Called when user wants to retry signing after declining.
   * Shows the signature dialog again.
   */
  retrySignature(): void {
    console.log('[AuthFlow] User wants to retry signature')
    this.setState({
      state: 'awaitingSignature',
      error: null,
    })
  }

  async dismissWelcome(): Promise<void> {
    try {
      const wallet = walletService.getConnectedWallet()
      if (!wallet) {
        throw new Error('No wallet connected')
      }

      const normalizedAddress = wallet.address.toLowerCase()
      const welcomeStore = useWelcomeStore.getState()
      welcomeStore.setDismissed(normalizedAddress, true)

      this.setState({ state: 'ready', error: null })
      console.log('[AuthFlow] Welcome modal dismissed - ready to trade')
    } catch (error: any) {
      console.error('[AuthFlow] Error dismissing welcome:', error)
      // Still transition to ready even on error
      this.setState({ state: 'ready', error: null })
    }
  }

  reset() {
    // Reset the flow running flag
    this.isFlowRunning = false

    this.setState({
      state: 'idle',
      error: null,
      isWhitelisted: null,
      termsAccepted: false,
      tradingAccount: null,
      accessQueue: {
        queuePosition: null,
        email: null,
        telegram: null,
      },
      invitationCode: null,
      sessionId: null,
      pendingSession: null,
    })
  }

  /**
   * Force reset the auth flow - clears isFlowRunning flag and resets state.
   * Use this for retry scenarios where the flow may be stuck.
   */
  forceReset() {
    console.log('[AuthFlow] Force resetting auth flow')
    this.isFlowRunning = false
    this.reset()
  }
}

export const authFlowService = new AuthFlowService()
