/**
 * useAnalytics React Hook - Simplified
 * Provides easy access to 6 core analytics events
 */

import { useCallback } from 'react'
import { analyticsService } from '../services/analyticsService'

export function useAnalytics() {
  const trackWalletConnected = useCallback((
    walletAddress: string,
    walletType: string,
    isEvm: boolean
  ) => {
    analyticsService.trackWalletConnected(walletAddress, walletType, isEvm)
  }, [])

  const trackMessageSigned = useCallback((
    walletAddress: string,
    timeToSignMs: number
  ) => {
    analyticsService.trackMessageSigned(walletAddress, timeToSignMs)
  }, [])

  const trackSessionStarted = useCallback((
    sessionId: string,
    walletAddress: string,
    marketPairs: string[],
    strategyCount: number,
    isResume: boolean
  ) => {
    analyticsService.trackSessionStarted(sessionId, walletAddress, marketPairs, strategyCount, isResume)
  }, [])

  const trackOrderPlaced = useCallback((
    orderId: string,
    sessionId: string,
    walletAddress: string,
    marketPair: string,
    side: 'Buy' | 'Sell',
    orderType: 'Market' | 'Limit',
    priceUsd: number,
    quantity: number,
    valueUsd: number
  ) => {
    analyticsService.trackOrderPlaced(orderId, sessionId, walletAddress, marketPair, side, orderType, priceUsd, quantity, valueUsd)
  }, [])

  const trackSessionEnded = useCallback((
    sessionId: string,
    walletAddress: string,
    tradeCount: number,
    totalVolumeUsd: number,
    realizedPnl: number,
    endReason: 'user_stopped' | 'error' | 'loss_limit'
  ) => {
    analyticsService.trackSessionEnded(sessionId, walletAddress, tradeCount, totalVolumeUsd, realizedPnl, endReason)
  }, [])

  const reset = useCallback(() => {
    analyticsService.reset()
  }, [])

  return {
    trackWalletConnected,
    trackMessageSigned,
    trackSessionStarted,
    trackOrderPlaced,
    trackSessionEnded,
    reset,
    isUserIdentified: analyticsService.isUserIdentified(),
  }
}
