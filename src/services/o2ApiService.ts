import axios, { AxiosInstance } from 'axios'
import { Address, BYTES_32 } from 'fuels'
import { pad } from 'viem'
import { Market, MarketTicker, MarketTickerApiResponse, OrderBookDepth, MarketsResponse } from '../types/market'
import { Order, OrderSide, OrderStatus, OrderType } from '../types/order'
import { Order as ApiOrder, DepthApiResponse } from '../types/o2-api-types'
import { BalanceApiResponse } from '../types/tradingAccount'
import { O2_API_URL } from '../constants/o2Constants'
import { walletService } from './walletService'
import { Decimal } from 'decimal.js'

export interface CreateTradingAccountRequest {
  identity: {
    Address: string
  }
}

export interface CreateTradingAccountResponse {
  trade_account_id: string
}

export interface CreateSessionRequest {
  contract_id: string
  session_id: string | { Address: string }
  signature: string | { Secp256k1: string }
  nonce: string
  expiry: string
  contract_ids?: string[]
}

export interface SessionSubmitTransactionRequest {
  actions: Array<{
    market_id: string
    actions: Array<{
      CreateOrder?: {
        side: 'Buy' | 'Sell'
        order_type: 'Spot' | 'Market' | 'Limit' | 'FillOrKill' | 'PostOnly'
        price: string
        quantity: string
      }
      CancelOrder?: {
        order_id: string
      }
      SettleBalance?: {
        to: any
      }
    }>
  }>
  signature: string | any
  nonce: string
  trade_account_id: string
  session_id: string | any
  variable_outputs?: number
  min_gas_limit?: string
  collect_orders?: boolean
}

export interface SessionSubmitTransactionResponse {
  tx_id: string
  orders: Order[] // Internal Order type (after mapping)
}

export interface SessionSubmitTransactionApiResponse {
  tx_id: string
  orders?: ApiOrder[] // API Order type (before mapping) - optional when collect_orders is false
}

export interface GetAccountResponse {
  trade_account: {
    nonce: number
    owner: {
      Address?: string
      ContractId?: string
    }
    synced_with_network: boolean
  } | null
  trade_account_id: string | null
}

/**
 * Map API Order response to internal Order type
 */
function mapApiOrderToOrder(apiOrder: ApiOrder): Order {
  // Map quantity_fill to filled_quantity
  const filledQuantity = apiOrder.quantity_fill || '0'
  
  // Map side from 'buy'/'sell' to OrderSide enum
  const side = apiOrder.side === 'buy' ? OrderSide.Buy : OrderSide.Sell
  
  // Calculate status from close, cancel, partially_filled fields
  let status: OrderStatus
  if (apiOrder.cancel) {
    status = OrderStatus.Cancelled
  } else if (apiOrder.close) {
    status = OrderStatus.Filled
  } else if (apiOrder.partially_filled) {
    status = OrderStatus.PartiallyFilled
  } else {
    status = OrderStatus.Open
  }
  
  // Map timestamp string to created_at and updated_at numbers
  const timestamp = parseInt(apiOrder.timestamp || '0', 10)
  const createdAt = timestamp
  const updatedAt = timestamp
  
  // Calculate remaining_quantity from quantity - quantity_fill
  const quantity = new Decimal(apiOrder.quantity || '0')
  const quantityFill = new Decimal(filledQuantity)
  const remainingQuantity = quantity.minus(quantityFill).toString()
  
  // Extract tx_id from history array (find the most recent confirmed tx_id)
  let txId: string | undefined
  if (apiOrder.history && apiOrder.history.length > 0) {
    // Find the most recent confirmed transaction
    const confirmedTx = [...apiOrder.history]
      .filter(h => h.status === 'confirmed')
      .sort((a, b) => {
        // Sort by type priority: created < trade < others
        const typePriority = { created: 0, trade: 1 }
        const aPriority = typePriority[a.type as keyof typeof typePriority] ?? 2
        const bPriority = typePriority[b.type as keyof typeof typePriority] ?? 2
        return bPriority - aPriority
      })
    if (confirmedTx.length > 0) {
      txId = confirmedTx[0].tx_id
    }
  }
  
  // Set order_type to default (Spot) since API doesn't provide it
  // This could be improved if we can infer it from other fields
  const orderType = OrderType.Spot
  
  // Map price_fill (keep as is)
  const priceFill = apiOrder.price_fill || undefined
  
  return {
    order_id: apiOrder.order_id,
    market_id: apiOrder.market_id,
    side,
    order_type: orderType,
    price: apiOrder.price,
    price_fill: priceFill,
    quantity: apiOrder.quantity,
    filled_quantity: filledQuantity,
    remaining_quantity: remainingQuantity,
    status,
    created_at: createdAt,
    updated_at: updatedAt,
    tx_id: txId,
  }
}

class O2ApiService {
  private client: AxiosInstance
  private baseUrl: string

  constructor(baseUrl: string = O2_API_URL) {
    this.baseUrl = baseUrl
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    })

    // Add response interceptor for 429 rate limiting errors
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const config = error.config

        // Don't retry if we've already retried too many times
        if (!config || !config.retryCount) {
          config.retryCount = 0
        }

        // Retry on 429 (rate limit) with exponential backoff
        if (error.response?.status === 429 && config.retryCount < 3) {
          config.retryCount += 1
          const delay = Math.min(1000 * Math.pow(2, config.retryCount - 1), 5000) // 1s, 2s, 4s (max 5s)

          console.log(`[O2 API] Rate limited (429), retrying in ${delay}ms (attempt ${config.retryCount}/3)`)

          // Wait before retrying
          await new Promise((resolve) => setTimeout(resolve, delay))

          // Retry the request
          return this.client(config)
        }

        // If not 429 or max retries reached, throw the error
        return Promise.reject(error)
      }
    )
  }

  setBaseUrl(url: string) {
    this.baseUrl = url
    this.client.defaults.baseURL = url
  }

  // Account API
  async createTradingAccount(request: CreateTradingAccountRequest, ownerId: string): Promise<CreateTradingAccountResponse> {
    // The API expects the request body to have identity.Address format
    // ownerId is used in the header
    const response = await this.client.post<CreateTradingAccountResponse>('/accounts', request, {
      headers: {
        'O2-Owner-Id': ownerId,
      },
    })
    return response.data
  }

  async getAccount(tradeAccountId: string, ownerId: string): Promise<{ nonce: string }> {
    const response = await this.client.get<GetAccountResponse>(`/accounts?trade_account_id=${tradeAccountId}`, {
      headers: {
        'O2-Owner-Id': ownerId,
      },
    })
    // Response structure: { trade_account: { nonce: number }, trade_account_id: string }
    return { nonce: String(response.data.trade_account?.nonce || 0) }
  }

  async getAccountByOwner(ownerAddress: string): Promise<GetAccountResponse> {
    const response = await this.client.get<GetAccountResponse>(`/accounts?owner=${ownerAddress}`)
    return response.data
  }

  // Session API
  async createSession(request: CreateSessionRequest, ownerId: string): Promise<any> {
    // Convert to API format - match O2's exact field order
    const apiRequest = {
      nonce: request.nonce,
      contract_id: request.contract_id,
      contract_ids: request.contract_ids,
      session_id: request.session_id,
      signature: request.signature,
      expiry: request.expiry,
    }
    console.log('[O2ApiService] Session request body:', JSON.stringify(apiRequest, null, 2))
    const response = await this.client.put('/session', apiRequest, {
      headers: {
        'O2-Owner-Id': ownerId,
      },
    })
    return response.data
  }

  async sessionSubmitTransaction(request: SessionSubmitTransactionRequest, ownerId: string): Promise<SessionSubmitTransactionResponse> {
    // Convert ownerId to B256 format for header (same as other API calls)
    const wallet = walletService.getConnectedWallet()
    let ownerIdForHeader: string
    
    if (wallet && !wallet.isFuel) {
      // Ethereum wallet - pad to 32 bytes then convert to B256
      const paddedAddress = pad(ownerId as `0x${string}`, { size: BYTES_32 })
      const fuelAddress = Address.fromString(paddedAddress)
      ownerIdForHeader = fuelAddress.toB256()
    } else {
      // Fuel wallet - convert directly to B256
      const fuelAddress = Address.fromString(ownerId)
      ownerIdForHeader = fuelAddress.toB256()
    }

    const response = await this.client.post<SessionSubmitTransactionApiResponse>('/session/actions', request, {
      headers: {
        'O2-Owner-Id': ownerIdForHeader,
      },
    })
    // Map API orders to internal Order type
    // When collect_orders is false, orders array is not returned, so handle undefined
    return {
      tx_id: response.data.tx_id,
      orders: response.data.orders ? response.data.orders.map(mapApiOrderToOrder) : [],
    }
  }

  // Market API
  async getMarkets(): Promise<MarketsResponse> {
    const response = await this.client.get<MarketsResponse>('/markets')
    return response.data
  }

  async getTicker(marketId: string): Promise<MarketTicker> {
    const response = await this.client.get<MarketTickerApiResponse[]>(`/markets/ticker?market_id=${marketId}`)
    
    // API returns array with single object
    const tickerData = Array.isArray(response.data) ? response.data[0] : response.data
    
    if (!tickerData) {
      throw new Error(`No ticker data returned for market ${marketId}`)
    }
    
    // Map API response to internal MarketTicker format
    return {
      market_id: marketId,
      last_price: tickerData.last,  // Map 'last' to 'last_price'
      volume_24h: tickerData.base_volume,
      high_24h: tickerData.high,
      low_24h: tickerData.low,
      change_24h: tickerData.change,
      change_24h_percent: tickerData.percentage,
      bid: tickerData.bid,
      ask: tickerData.ask,
    }
  }

  async getDepth(marketId: string, precision: number = 100): Promise<OrderBookDepth> {
    const response = await this.client.get<any>(`/depth?market_id=${marketId}&precision=${precision}`)
    
    // Handle both possible API response structures:
    // 1. Direct bids/asks format: { bids: [...], asks: [...] }
    // 2. Orders format: { orders: { buys: [...], sells: [...] } }
    let bids: Array<[string, string]> = []
    let asks: Array<[string, string]> = []
    
    if (response.data.bids && response.data.asks) {
      // Direct format
      bids = response.data.bids
      asks = response.data.asks
    } else if (response.data.orders) {
      // Orders format - map buys to bids, sells to asks
      bids = response.data.orders.buys || []
      asks = response.data.orders.sells || []
    }
    
    return {
      bids,
      asks,
      timestamp: Date.now(),
    }
  }

  // Balance API
  async getBalance(assetId: string, contractId: string, ownerId: string): Promise<BalanceApiResponse> {
    // Convert ownerId to B256 format for header (same as session creation)
    const wallet = walletService.getConnectedWallet()
    let ownerIdForHeader: string
    
    if (wallet && !wallet.isFuel) {
      // Ethereum wallet - pad to 32 bytes then convert to B256
      const paddedAddress = pad(ownerId as `0x${string}`, { size: BYTES_32 })
      const fuelAddress = Address.fromString(paddedAddress)
      ownerIdForHeader = fuelAddress.toB256()
    } else {
      // Fuel wallet - convert directly to B256
      const fuelAddress = Address.fromString(ownerId)
      ownerIdForHeader = fuelAddress.toB256()
    }

    const response = await this.client.get<BalanceApiResponse>(`/balance?asset_id=${assetId}&contract=${contractId}`, {
      headers: {
        'O2-Owner-Id': ownerIdForHeader,
      },
    })
    return response.data
  }

  // Orders API
  async getOrders(params: {
    market_id?: string
    contract?: string
    is_open?: boolean
    direction?: 'asc' | 'desc'
    count?: number
  }, ownerId: string): Promise<Order[]> {
    // Convert ownerId to B256 format for header (same as session creation)
    const wallet = walletService.getConnectedWallet()
    let ownerIdForHeader: string
    
    if (wallet && !wallet.isFuel) {
      // Ethereum wallet - pad to 32 bytes then convert to B256
      const paddedAddress = pad(ownerId as `0x${string}`, { size: BYTES_32 })
      const fuelAddress = Address.fromString(paddedAddress)
      ownerIdForHeader = fuelAddress.toB256()
    } else {
      // Fuel wallet - convert directly to B256
      const fuelAddress = Address.fromString(ownerId)
      ownerIdForHeader = fuelAddress.toB256()
    }

    const queryParams = new URLSearchParams()
    if (params.market_id) queryParams.append('market_id', params.market_id)
    if (params.contract) queryParams.append('contract', params.contract)
    if (params.is_open !== undefined) queryParams.append('is_open', String(params.is_open))
    if (params.direction) queryParams.append('direction', params.direction)
    if (params.count) queryParams.append('count', String(params.count))

    const response = await this.client.get<{ orders: ApiOrder[] }>(`/orders?${queryParams.toString()}`, {
      headers: {
        'O2-Owner-Id': ownerIdForHeader,
      },
    })
    // Map API orders to internal Order type
    return response.data.orders.map(mapApiOrderToOrder)
  }

  async getOrder(orderId: string, marketId: string, ownerId: string): Promise<Order> {
    // Convert ownerId to B256 format for header (same as session creation)
    const wallet = walletService.getConnectedWallet()
    let ownerIdForHeader: string
    
    if (wallet && !wallet.isFuel) {
      // Ethereum wallet - pad to 32 bytes then convert to B256
      const paddedAddress = pad(ownerId as `0x${string}`, { size: BYTES_32 })
      const fuelAddress = Address.fromString(paddedAddress)
      ownerIdForHeader = fuelAddress.toB256()
    } else {
      // Fuel wallet - convert directly to B256
      const fuelAddress = Address.fromString(ownerId)
      ownerIdForHeader = fuelAddress.toB256()
    }

    // Use correct endpoint: /v1/order with query parameters (not /orders/{orderId})
    const queryParams = new URLSearchParams()
    queryParams.append('order_id', orderId)
    queryParams.append('market_id', marketId)

    // API returns { order: ApiOrder } structure
    const response = await this.client.get<{ order: ApiOrder }>(`/order?${queryParams.toString()}`, {
      headers: {
        'O2-Owner-Id': ownerIdForHeader,
      },
    })
    // Map API order to internal Order type
    return mapApiOrderToOrder(response.data.order)
  }

  // Trades API
  async getTrades(marketId: string, count: number = 20): Promise<any[]> {
    const response = await this.client.get(`/trades?market_id=${marketId}&count=${count}&direction=desc`)
    return response.data.trades || []
  }
}

export const o2ApiService = new O2ApiService()

