/**
 * PostHog Analytics Event Types - Simplified
 * Tracks only essential metrics: wallet, auth, sessions, orders, volume, PnL
 */

// Base event properties (attached to all events)
export interface BaseEventProperties {
  timestamp: number
  session_duration_ms: number // Time since app load
}

// ===============================
// SIMPLIFIED EVENTS (6 total)
// ===============================

export interface AppOpenedEvent extends BaseEventProperties {
  viewport_width: number
  viewport_height: number
  referrer: string | null
}

export interface WalletConnectedEvent extends BaseEventProperties {
  wallet_address: string
  wallet_type: string
  is_evm: boolean
}

export interface MessageSignedEvent extends BaseEventProperties {
  wallet_address: string
  time_to_sign_ms: number
}

export interface SessionStartedEvent extends BaseEventProperties {
  wallet_address: string
  session_id: string
  market_pairs: string[]
  strategy_count: number
  is_resume: boolean
}

export interface OrderPlacedEvent extends BaseEventProperties {
  wallet_address: string
  session_id: string
  order_id: string
  market_pair: string
  side: 'Buy' | 'Sell'
  order_type: 'Market' | 'Limit'
  price_usd: number
  quantity: number
  value_usd: number
}

export interface SessionEndedEvent extends BaseEventProperties {
  wallet_address: string
  session_id: string
  duration_ms: number
  trade_count: number
  total_volume_usd: number
  realized_pnl: number
  end_reason: 'user_stopped' | 'error' | 'loss_limit'
}

// ===============================
// EVENT NAME UNION TYPE
// ===============================

export type AnalyticsEventName =
  | 'app_opened'
  | 'wallet_connected'
  | 'message_signed'
  | 'session_started'
  | 'order_placed'
  | 'session_ended'

// ===============================
// TYPE-SAFE EVENT MAP
// ===============================

export interface AnalyticsEventMap {
  'app_opened': AppOpenedEvent
  'wallet_connected': WalletConnectedEvent
  'message_signed': MessageSignedEvent
  'session_started': SessionStartedEvent
  'order_placed': OrderPlacedEvent
  'session_ended': SessionEndedEvent
}

// ===============================
// USER PROPERTIES
// ===============================

export interface AnalyticsUserProperties {
  wallet_address: string
  wallet_type: string
  is_evm: boolean
  first_seen: string
  last_seen: string
  total_sessions: number
  total_trades: number
  total_volume_usd: number
  total_pnl: number
}
