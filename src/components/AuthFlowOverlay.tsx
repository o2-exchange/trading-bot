import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { authFlowService } from '../services/authFlowService'
import { walletService } from '../services/walletService'
import TermsOfUseDialog from './TermsOfUseDialog'
import SignMessageDialog from './SignMessageDialog'
import WelcomeModal from './WelcomeModal'
import { useToast } from './ToastProvider'

interface AuthFlowOverlayProps {
  onAuthReady?: () => void
  onAuthStateChange?: (state: string, isWhitelisted: boolean | null) => void
}

export default function AuthFlowOverlay({ onAuthReady, onAuthStateChange }: AuthFlowOverlayProps) {
  const { t } = useTranslation()
  const [authState, setAuthState] = useState(authFlowService.getState())
  const { addToast } = useToast()

  useEffect(() => {
    let mounted = true
    let hasStarted = false

    // Subscribe to auth flow state changes
    const unsubscribe = authFlowService.subscribe((context) => {
      if (mounted) {
        console.log('Auth flow state changed:', context.state, context.error)

        setAuthState(context)

        // Notify parent of state changes
        onAuthStateChange?.(context.state, context.isWhitelisted)

        // Notify parent when auth is ready
        if (context.state === 'ready') {
          onAuthReady?.()
        }

        // Show error as toast instead of blocking
        if (context.state === 'error' && context.error) {
          addToast(t('auth.error', { message: context.error }), 'error')
        }
      }
    })

    // Start auth flow if wallet is connected and state is idle
    const currentState = authFlowService.getState()
    console.log('AuthFlowOverlay mounted, current state:', currentState.state)

    // If already ready, notify parent
    if (currentState.state === 'ready') {
      console.log('Auth flow already ready')
      setAuthState(currentState)
      onAuthReady?.()
      onAuthStateChange?.(currentState.state, currentState.isWhitelisted)
      return unsubscribe
    }

    // Only start flow once
    if (currentState.state === 'idle' && !hasStarted) {
      hasStarted = true
      const wallet = walletService.getConnectedWallet()
      if (wallet) {
        console.log('Starting auth flow for wallet:', wallet.address)
        authFlowService.startFlow().catch((error) => {
          if (mounted) {
            console.error('Failed to start auth flow', error)
            addToast(t('auth.flow_error', { message: error.message }), 'error')
          }
        })
      } else {
        console.warn('No wallet connected when trying to start auth flow')
      }
    }

    return () => {
      mounted = false
      unsubscribe()
      // Only abort if the flow is in a "working" state (checking, creating, whitelisting)
      // Don't abort if flow is in a "display" state (awaiting user action) or already ready
      // This prevents React Strict Mode double-mounting from killing active flows
      const state = authFlowService.getState().state
      const interruptibleStates = ['checkingSituation', 'checkingTerms', 'whitelisting', 'creatingSession']
      if (interruptibleStates.includes(state)) {
        authFlowService.abort()
      }
    }
  }, [onAuthReady, onAuthStateChange])

  const handleTermsClose = () => {
    // Only reset if terms were actually declined
    // IMPORTANT: Use authFlowService.getState() for both checks to avoid stale React state
    const currentState = authFlowService.getState()
    // Don't reset if terms were accepted OR if we're in session creation/ready states
    // termsAccepted and state should both come from the service to avoid race conditions
    if (!currentState.termsAccepted &&
        currentState.state !== 'ready' &&
        currentState.state !== 'creatingSession' &&
        currentState.state !== 'awaitingWelcome') {
      authFlowService.reset()
    }
  }

  const handleSignMessageClose = () => {
    // User cancelled the signature - this is handled by the dialog itself
  }

  // Don't render anything for loading or error states - let them be handled elsewhere
  // Only render dialog overlays when needed
  return (
    <>
      <TermsOfUseDialog
        isOpen={authState.state === 'awaitingTerms'}
        onClose={handleTermsClose}
      />
      <SignMessageDialog
        isOpen={authState.state === 'awaitingSignature'}
        onClose={handleSignMessageClose}
      />
      <WelcomeModal
        isOpen={authState.state === 'awaitingWelcome'}
        onClose={() => authFlowService.dismissWelcome()}
      />
    </>
  )
}
