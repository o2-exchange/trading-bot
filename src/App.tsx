import { useState, useEffect } from 'react'
import { WagmiProvider } from 'wagmi'
import { Analytics } from '@vercel/analytics/react'
import Dashboard from './components/Dashboard'
import { WalletConnectionWatcher } from './components/WalletConnectionWatcher'
import { walletService, wagmiConfig } from './services/walletService'
import { useWalletStore } from './stores/useWalletStore'
import { ToastProvider } from './components/ToastProvider'

function App() {
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

  // Don't render until we've checked for existing connection
  if (!isInitialized) {
    return (
      <WagmiProvider config={wagmiConfig}>
        <ToastProvider>
          <div className="app">
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
              <p>Loading...</p>
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

