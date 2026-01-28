import { useEffect, useState } from 'react'
import { authFlowService, AuthFlowState } from '../services/authFlowService'
import { walletService } from '../services/walletService'
import TermsOfUseDialog from './TermsOfUseDialog'
import SignMessageDialog from './SignMessageDialog'
import WelcomeModal from './WelcomeModal'
import { useToast } from './ToastProvider'
import { clearAllSessionStorage } from '../utils/clearUserStorage'

interface AuthFlowGuardProps {
  children: React.ReactNode
}

export default function AuthFlowGuard({ children }: AuthFlowGuardProps) {
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
      }
    })

    // Start auth flow if wallet is connected and state is idle
    // The startFlow method will check for active session first
    const currentState = authFlowService.getState()
    console.log('AuthFlowGuard mounted, current state:', currentState.state)

    // If already ready, don't restart the flow
    if (currentState.state === 'ready') {
      console.log('Auth flow already ready')
      setAuthState(currentState)
      return unsubscribe
    }

    // Only start flow once, even if component remounts (React strict mode)
    if (currentState.state === 'idle' && !hasStarted) {
      hasStarted = true
      // Check if wallet is connected
      const wallet = walletService.getConnectedWallet()
      if (wallet) {
        console.log('Starting auth flow for wallet:', wallet.address)
        authFlowService.startFlow().catch((error) => {
          if (mounted) {
            console.error('Failed to start auth flow', error)
            addToast(`Auth flow error: ${error.message}`, 'error')
          }
        })
      } else {
        console.warn('No wallet connected when trying to start auth flow')
      }
    }

    return () => {
      mounted = false
      unsubscribe()
    }
  }, []) // Remove addToast dependency to prevent re-runs

  const handleTermsClose = () => {
    // Only reset if terms were actually declined (not just closed after acceptance)
    // Don't reset if we're already ready or in progress
    const currentState = authFlowService.getState()
    if (!authState.termsAccepted && currentState.state !== 'ready' && currentState.state !== 'creatingSession') {
      authFlowService.reset()
    }
  }

  const handleSignMessageClose = () => {
    // User cancelled - this will set state to signatureDeclined
  }

  // Handle awaitingSignature state FIRST - show SignMessageDialog
  if (authState.state === 'awaitingSignature') {
    return (
      <>
        <SignMessageDialog
          isOpen={true}
          onClose={handleSignMessageClose}
        />
        {/* Background while dialog is shown */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          background: 'var(--background)'
        }} />
      </>
    )
  }

  // Loading states - show spinner while authenticating
  const isLoading =
    authState.state === 'idle' ||
    authState.state === 'checkingSituation' ||
    authState.state === 'checkingTerms' ||
    authState.state === 'whitelisting' ||
    authState.state === 'creatingSession'

  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        background: 'var(--background)',
        gap: '16px'
      }}>
        <div style={{
          width: '32px',
          height: '32px',
          border: '3px solid var(--border)',
          borderTopColor: 'var(--primary)',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }} />
        <p style={{ color: 'var(--muted-foreground)', fontSize: '14px' }}>
          {authState.state === 'idle' ? 'Connecting...' :
           authState.state === 'whitelisting' ? 'Setting up your account...' :
           'Setting up trading session...'}
        </p>
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    )
  }

  // Show error state with retry
  if (authState.state === 'error') {
    const handleRetry = () => {
      authFlowService.forceReset()
      authFlowService.startFlow()
    }

    const handleClearAndRetry = async () => {
      await clearAllSessionStorage()
      authFlowService.forceReset()
      authFlowService.startFlow()
    }

    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        background: 'var(--background)',
        gap: '12px'
      }}>
        <p style={{ color: 'var(--destructive)', fontSize: '14px' }}>
          {authState.error || 'Authentication failed'}
        </p>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={handleRetry}
            style={{
              padding: '10px 20px',
              background: 'var(--primary)',
              color: 'var(--primary-foreground)',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500'
            }}
          >
            Retry
          </button>
          <button
            onClick={handleClearAndRetry}
            style={{
              padding: '10px 20px',
              background: 'var(--secondary)',
              color: 'var(--secondary-foreground)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500'
            }}
          >
            Clear & Retry
          </button>
        </div>
        <p style={{ color: 'var(--muted-foreground)', fontSize: '12px', marginTop: '8px' }}>
          If retry doesn't work, try "Clear & Retry" to reset session data
        </p>
      </div>
    )
  }

  // Ready state - render children
  if (authState.state === 'ready') {
    return <>{children}</>
  }

  // Welcome modal state - show modal over Dashboard
  if (authState.state === 'awaitingWelcome') {
    return (
      <>
        {children}
        <WelcomeModal
          isOpen={true}
          onClose={() => authFlowService.dismissWelcome()}
        />
      </>
    )
  }

  // Signature declined state - show retry UI
  if (authState.state === 'signatureDeclined') {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        background: 'var(--background)',
        gap: '16px'
      }}>
        <p style={{ color: 'var(--foreground)', fontSize: '16px', fontWeight: '500' }}>
          Signature required to continue
        </p>
        <p style={{ color: 'var(--muted-foreground)', fontSize: '14px', textAlign: 'center', maxWidth: '400px' }}>
          A wallet signature is needed to create your trading session. This does not cost any gas.
        </p>
        <button
          onClick={() => authFlowService.retrySignature()}
          style={{
            padding: '12px 24px',
            background: 'var(--primary)',
            color: 'var(--primary-foreground)',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '500',
            marginTop: '8px'
          }}
        >
          Sign Message
        </button>
      </div>
    )
  }

  // Terms dialog state
  return (
    <>
      <TermsOfUseDialog
        isOpen={authState.state === 'awaitingTerms'}
        onClose={handleTermsClose}
      />

      {/* Background while dialogs are shown */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        background: 'var(--background)'
      }} />
    </>
  )
}
