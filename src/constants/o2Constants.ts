// o2 Exchange API endpoints (mainnet only)
export const O2_API_URL = 'https://api.o2.app/v1' as const

export const O2_WEBSOCKET_URL = 'wss://api.o2.app/v1/ws' as const

export const O2_ANALYTICS_API_URL = 'https://api.o2.app/analytics/v1' as const

export const FUEL_PROVIDER_URL = 'https://mainnet.fuel.network/v1/graphql' as const

// Default session expiry (30 days)
export const DEFAULT_SESSION_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000

// Minimum order size in USD (if applicable)
export const MIN_ORDER_SIZE_USD = 1

// Default order precision
export const DEFAULT_PRECISION = 100

// Hide USDT markets and balances from UI (set to false when USDT is fully available)
export const HIDE_USDT_IN_UI = false

