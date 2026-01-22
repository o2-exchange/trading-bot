import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { WagmiProvider } from 'wagmi'
import { Analytics } from '@vercel/analytics/react'
import Dashboard from './components/Dashboard'
import { WalletConnectionWatcher } from './components/WalletConnectionWatcher'
import { walletService, wagmiConfig } from './services/walletService'
import { useWalletStore } from './stores/useWalletStore'
import { ToastProvider } from './components/ToastProvider'

function App() {
  const { t } = useTranslation()
  const connectedWallet = useWalletStore((state) => state.connectedWallet)
  const [isInitialized, setIsInitialized] = useState(false)

  useEffect(() => {
    // Restore connection on mount
    const restoreConnection = async () => {
      try {
        await walletService.restoreConnection()
      } catch (error) {
        console.warn('Failed to restore connection', error)
      } finally {
        setIsInitialized(true)
      }
    }

    restoreConnection()
  }, [])

  // Prevent accidental tab closure
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
      return ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  // Don't render until we've checked for existing connection
  if (!isInitialized) {
    return (
      <WagmiProvider config={wagmiConfig}>
        <ToastProvider>
          <div className="app">
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
              <p>{t('common.loading')}</p>
            </div>
          </div>
        </ToastProvider>
      </WagmiProvider>
    )
  }

  return (
    <WagmiProvider config={wagmiConfig}>
      <ToastProvider>
        <WalletConnectionWatcher />
        <div className="app">
          <Dashboard
            isWalletConnected={!!connectedWallet}
            onDisconnect={() => walletService.disconnect()}
          />
        </div>
        <Analytics />
      </ToastProvider>
    </WagmiProvider>
  )
}

export default App

