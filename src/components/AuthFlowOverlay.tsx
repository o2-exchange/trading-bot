import { useEffect, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { authFlowService } from '../services/authFlowService'
import { walletService } from '../services/walletService'
import { useWalletStore } from '../stores/useWalletStore'
import TermsOfUseDialog from './TermsOfUseDialog'
import SignMessageDialog from './SignMessageDialog'
import { useToast } from './ToastProvider'

interface AuthFlowOverlayProps {
  onAuthReady?: () => void
  onAuthStateChange?: (state: string, isWhitelisted: boolean | null) => void
}

export default function AuthFlowOverlay({ onAuthReady, onAuthStateChange }: AuthFlowOverlayProps) {
  const { t } = useTranslation()
  const [authState, setAuthState] = useState(authFlowService.getState())
  const { addToast } = useToast()
  const connectedWallet = useWalletStore((state) => state.connectedWallet)
  const isWalletConnected = !!connectedWallet
  const hasStartedRef = useRef(false)

  // Subscribe to auth flow state changes (stable — does not depend on wallet state)
  useEffect(() => {
    let mounted = true

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

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [onAuthReady, onAuthStateChange])

  // Start auth flow when wallet connects (reactive to wallet state changes)
  // This replaces the old mount-based approach that was fragile to unmount/remount cycles
  useEffect(() => {
    if (!isWalletConnected) {
      // Wallet disconnected — reset the started flag so flow runs on next connect
      hasStartedRef.current = false
      return
    }

    // Wallet is connected — check if we need to start the flow
    const currentState = authFlowService.getState()

    // If already ready, just notify parent
    if (currentState.state === 'ready') {
      onAuthReady?.()
      onAuthStateChange?.(currentState.state, currentState.isWhitelisted)
      return
    }

    // Only start flow once per connection
    if (currentState.state === 'idle' && !hasStartedRef.current) {
      hasStartedRef.current = true
      const wallet = walletService.getConnectedWallet()
      if (wallet) {
        console.log('Starting auth flow for wallet:', wallet.address)
        authFlowService.startFlow().catch((error) => {
          console.error('Failed to start auth flow', error)
          addToast(t('auth.flow_error', { message: error.message }), 'error')
        })
      }
    }
  }, [isWalletConnected, onAuthReady, onAuthStateChange])

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
    </>
  )
}
