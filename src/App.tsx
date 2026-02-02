import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { WagmiProvider } from 'wagmi'
import { Analytics } from '@vercel/analytics/react'
import AppLayout from './components/AppLayout'
import TradingEngineManager from './components/TradingEngineManager'
import DashboardPage from './components/pages/DashboardPage'
import TradesPage from './components/pages/TradesPage'
import TutorialsPage from './components/pages/TutorialsPage'
import { WalletConnectionWatcher } from './components/WalletConnectionWatcher'
import { MobileRestrictionOverlay } from './components/MobileRestrictionOverlay'
import { walletService, wagmiConfig } from './services/walletService'
import { ToastProvider } from './components/ToastProvider'

function App() {
  const { t } = useTranslation()
  const [isInitialized, setIsInitialized] = useState(false)

  useEffect(() => {
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
        <BrowserRouter>
          <WalletConnectionWatcher />
          <TradingEngineManager />
          <div className="app">
            <Routes>
              <Route element={<AppLayout />}>
                <Route index element={<DashboardPage />} />
                <Route path="trades" element={<TradesPage />} />
                <Route path="tutorials" element={<TutorialsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </div>
        </BrowserRouter>
        <Analytics />
        <MobileRestrictionOverlay />
      </ToastProvider>
    </WagmiProvider>
  )
}

export default App
