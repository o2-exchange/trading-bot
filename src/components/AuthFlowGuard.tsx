import { useEffect, useState } from 'react'
import { authFlowService, AuthFlowState } from '../services/authFlowService'
import { walletService } from '../services/walletService'
import TermsOfUseDialog from './TermsOfUseDialog'
import AccessQueueDialog from './AccessQueueDialog'
import InvitationCodeDialog from './InvitationCodeDialog'
import WelcomeModal from './WelcomeModal'
import { useToast } from './ToastProvider'

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

  const handleAccessQueueClose = () => {
    // Keep dialog open if user is in queue
    if (authState.state === 'displayingAccessQueue') {
      return
    }
  }

  const handleInvitationClose = () => {
    // If no invitation code, user can skip (will remain in queue)
  }

  // Loading states - show spinner while authenticating
  const isLoading =
    authState.state === 'idle' ||
    authState.state === 'checkingSituation' ||
    authState.state === 'checkingTerms' ||
    authState.state === 'verifyingAccessQueue' ||
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
          {authState.state === 'idle' ? 'Connecting...' : 'Setting up trading session...'}
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
        <button
          onClick={() => authFlowService.startFlow()}
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

  // Dialog states - show dialogs with loading background
  return (
    <>
      <TermsOfUseDialog
        isOpen={authState.state === 'awaitingTerms'}
        onClose={handleTermsClose}
      />
      <AccessQueueDialog
        isOpen={authState.state === 'displayingAccessQueue'}
        queuePosition={authState.accessQueue.queuePosition}
        email={authState.accessQueue.email}
        telegram={authState.accessQueue.telegram}
        onClose={handleAccessQueueClose}
      />
      <InvitationCodeDialog
        isOpen={authState.state === 'awaitingInvitation'}
        onClose={handleInvitationClose}
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
