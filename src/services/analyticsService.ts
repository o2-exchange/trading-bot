/**
 * PostHog Analytics Service - Simplified
 * Tracks only essential metrics: wallet, auth, sessions, orders, volume, PnL
 */

import posthog from 'posthog-js'
import type {
  AnalyticsEventName,
  AnalyticsEventMap,
  BaseEventProperties,
  AnalyticsUserProperties,
} from '../types/analytics'

class AnalyticsService {
  private appLoadTime: number = Date.now()
  private identifiedUser: string | null = null
  private sessionStartTime: number | null = null
  private currentSessionId: string | null = null

  /**
   * Initialize the analytics service
   */
  initialize(): void {
    this.appLoadTime = Date.now()
    this.trackAppOpened()
  }

  /**
   * Identify user by wallet address
   */
  identify(walletAddress: string, walletType: string, isEvm: boolean): void {
    const normalizedAddress = walletAddress.toLowerCase()

    if (this.identifiedUser === normalizedAddress) {
      return
    }

    posthog.identify(normalizedAddress, {
      wallet_address: normalizedAddress,
      wallet_type: walletType,
      is_evm: isEvm,
      first_seen: new Date().toISOString(),
      last_seen: new Date().toISOString(),
    })

    this.identifiedUser = normalizedAddress
  }

  /**
   * Update user properties
   */
  setUserProperties(properties: Partial<AnalyticsUserProperties>): void {
    posthog.people.set(properties)
  }

  /**
   * Reset user identity (call on wallet disconnect)
   */
  reset(): void {
    posthog.reset()
    this.identifiedUser = null
    this.sessionStartTime = null
    this.currentSessionId = null
  }

  /**
   * Type-safe event tracking
   */
  private track<E extends AnalyticsEventName>(
    eventName: E,
    properties: Omit<AnalyticsEventMap[E], keyof BaseEventProperties>
  ): void {
    const baseProps: BaseEventProperties = {
      timestamp: Date.now(),
      session_duration_ms: Date.now() - this.appLoadTime,
    }

    posthog.capture(eventName, {
      ...baseProps,
      ...properties,
    })
  }

  // ===============================
  // TRACKING METHODS (6 events)
  // ===============================

  private trackAppOpened(): void {
    this.track('app_opened', {
      viewport_width: window.innerWidth,
      viewport_height: window.innerHeight,
      referrer: document.referrer || null,
    })
  }

  trackWalletConnected(walletAddress: string, walletType: string, isEvm: boolean): void {
    // Identify user
    this.identify(walletAddress, walletType, isEvm)

    this.track('wallet_connected', {
      wallet_address: walletAddress.toLowerCase(),
      wallet_type: walletType,
      is_evm: isEvm,
    })
  }

  trackMessageSigned(walletAddress: string, timeToSignMs: number): void {
    this.track('message_signed', {
      wallet_address: walletAddress.toLowerCase(),
      time_to_sign_ms: timeToSignMs,
    })
  }

  trackSessionStarted(
    sessionId: string,
    walletAddress: string,
    marketPairs: string[],
    strategyCount: number,
    isResume: boolean
  ): void {
    this.sessionStartTime = Date.now()
    this.currentSessionId = sessionId

    this.track('session_started', {
      wallet_address: walletAddress.toLowerCase(),
      session_id: sessionId,
      market_pairs: marketPairs,
      strategy_count: strategyCount,
      is_resume: isResume,
    })

    // Increment session count
    this.setUserProperties({
      last_seen: new Date().toISOString(),
    })
  }

  trackOrderPlaced(
    orderId: string,
    sessionId: string,
    walletAddress: string,
    marketPair: string,
    side: 'Buy' | 'Sell',
    orderType: 'Market' | 'Limit',
    priceUsd: number,
    quantity: number,
    valueUsd: number
  ): void {
    this.track('order_placed', {
      wallet_address: walletAddress.toLowerCase(),
      session_id: sessionId,
      order_id: orderId,
      market_pair: marketPair,
      side,
      order_type: orderType,
      price_usd: priceUsd,
      quantity,
      value_usd: valueUsd,
    })
  }

  trackSessionEnded(
    sessionId: string,
    walletAddress: string,
    tradeCount: number,
    totalVolumeUsd: number,
    realizedPnl: number,
    endReason: 'user_stopped' | 'error' | 'loss_limit'
  ): void {
    const durationMs = this.sessionStartTime
      ? Date.now() - this.sessionStartTime
      : 0

    this.track('session_ended', {
      wallet_address: walletAddress.toLowerCase(),
      session_id: sessionId,
      duration_ms: durationMs,
      trade_count: tradeCount,
      total_volume_usd: totalVolumeUsd,
      realized_pnl: realizedPnl,
      end_reason: endReason,
    })

    // Update user properties with cumulative stats
    this.setUserProperties({
      last_seen: new Date().toISOString(),
    })

    this.sessionStartTime = null
    this.currentSessionId = null
  }

  // ===============================
  // UTILITY METHODS
  // ===============================

  getAppLoadTime(): number {
    return this.appLoadTime
  }

  isUserIdentified(): boolean {
    return this.identifiedUser !== null
  }

  getCurrentSessionId(): string | null {
    return this.currentSessionId
  }
}

export const analyticsService = new AnalyticsService()
