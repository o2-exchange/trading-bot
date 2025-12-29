import { tradingAccountService } from './tradingAccountService'
import { sessionService } from './sessionService'
import { eligibilityService } from './eligibilityService'
import { useTermsOfUseStore } from '../stores/useTermsOfUseStore'
import { useSessionStore } from '../stores/useSessionStore'
import { useWelcomeStore } from '../stores/useWelcomeStore'
import { o2ApiService } from './o2ApiService'
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
  }

  private listeners: Set<(context: AuthFlowContext) => void> = new Set()

  // Prevent concurrent startFlow calls (e.g., from React strict mode)
  private isFlowRunning = false

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

      // First check for active session
      const activeSession = await this.checkActiveSession(normalizedAddress)
      if (activeSession) {
        // User has active session, but we still need to check eligibility status
        // for the Dashboard to display correctly
        await this.checkEligibilityStatus(normalizedAddress)

        this.setState({
          state: 'ready',
          sessionId: activeSession.id,
          error: null,
        })
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
      // Get trading account first
      const tradingAccount = await tradingAccountService.getTradingAccount(ownerAddress)
      if (!tradingAccount) {
        console.log('[AuthFlow] No trading account found for active session check')
        return null
      }

      // Get session from cache
      const cachedSession = useSessionStore.getState().getSession(tradingAccount.id as `0x${string}`)
      if (!cachedSession) {
        console.log('[AuthFlow] No cached session found')
        return null
      }

      // CRITICAL: Validate the session (check expiry, revocation, etc.)
      // This includes ON-CHAIN validation to detect if session was revoked
      console.log('[AuthFlow] Validating cached session on-chain...')
      const isValid = await sessionService.validateSession(
        tradingAccount.id,
        ownerAddress,
        false // DO NOT skip on-chain validation
      )

      if (!isValid) {
        console.log('[AuthFlow] ❌ Session invalid on-chain - clearing and restarting flow')
        // Clear ALL sessions when validation fails (like O2 does)
        useSessionStore.getState().clearSessions()
        return null
      }

      console.log('[AuthFlow] ✅ Session valid on-chain')

      // Get full session from database (skip validation to avoid recursion)
      const session = await sessionService.getActiveSession(ownerAddress, true)
      return session ? { id: session.id } : null
    } catch (error) {
      console.error('[AuthFlow] Error checking active session:', error)
      // Clear sessions on error to force fresh start
      useSessionStore.getState().clearSessions()
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
      console.warn('Failed to check eligibility status', error)
      // Don't throw - this is a background check and shouldn't block the flow
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
        await this.createSession()
      } else {
        this.setState({
          state: 'awaitingInvitation',
          error: eligibility.error || 'Invalid invitation code',
        })
      }
    } catch (error: any) {
      this.setState({
        state: 'awaitingInvitation',
        error: error.message || 'Failed to assign invitation code',
      })
    }
  }

  private async createSession(): Promise<void> {
    try {
      this.setState({ state: 'creatingSession' })

      const wallet = walletService.getConnectedWallet()
      if (!wallet) {
        throw new Error('No wallet connected')
      }

      console.log('[AuthFlow] Creating session for wallet:', wallet.address, 'Type:', wallet.isFuel ? 'Fuel' : 'Ethereum')

      const normalizedAddress = wallet.address.toLowerCase()

      // Get all markets for session contract IDs (uses cache)
      console.log('[AuthFlow] Fetching markets...')
      const markets = await marketService.fetchMarkets()
      // Exclude contract ID that O2 doesn't include (from a market not in O2's whitelist)
      // Use markets in their original order (O2 doesn't sort them)
      const EXCLUDED_CONTRACT_ID = '0xca78cbd896cd09f104cd32448e0ef155dace8a0a9ea21ad5f4f9435800038b9b'
      const marketContractIds = markets
        .filter((m) => m.contract_id.toLowerCase() !== EXCLUDED_CONTRACT_ID.toLowerCase())
        .map((m) => m.contract_id)
      // Include accounts_registry_id at the end if available (matching O2's pattern)
      const accountsRegistryId = marketService.getAccountsRegistryId()
      const contractIds = accountsRegistryId 
        ? [...marketContractIds, accountsRegistryId]
        : marketContractIds
      console.log('[AuthFlow] Contract IDs (markets + accounts_registry):', contractIds.length)

      // Set password for session encryption
      sessionService.setPassword('default-password-change-in-production')

      // Use cached trading account or fetch if not available
      const tradingAccount = this.context.tradingAccount ||
        await tradingAccountService.getOrCreateTradingAccount(normalizedAddress)

      // Update cache if we had to fetch it
      if (!this.context.tradingAccount) {
        this.setState({ tradingAccount })
      }

      console.log('[AuthFlow] Trading account:', tradingAccount.id)
      console.log('[AuthFlow] Starting session creation...')

      // Create session with cached trading account
      const session = await sessionService.createSession(
        normalizedAddress,
        contractIds,
        undefined,
        tradingAccount
      )

      console.log('[AuthFlow] ✅ Session created successfully:', session.id)

      // Check if welcome modal has been dismissed for this wallet
      const welcomeStore = useWelcomeStore.getState()
      const welcomeDismissed = welcomeStore.getDismissed(normalizedAddress)

      if (!welcomeDismissed) {
        this.setState({
          state: 'awaitingWelcome',
          sessionId: session.id,
          error: null,
        })
        console.log('[AuthFlow] Showing welcome modal for first-time user')
      } else {
        this.setState({
          state: 'ready',
          sessionId: session.id,
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
    })
  }
}

export const authFlowService = new AuthFlowService()
