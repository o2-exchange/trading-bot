import Dexie, { Table } from 'dexie'
import { Session } from '../types/session'
import { Market } from '../types/market'
import { Trade } from '../types/trade'
import { StrategyConfigStore } from '../types/strategy'
import { Order } from '../types/order'
import { TradingAccount } from '../types/tradingAccount'
import { SessionKey } from '../types/session'
import { TradingSession } from '../types/tradingSession'

export interface EncryptedSessionKey {
  id: string // Session ID (address)
  encryptedPrivateKey: string
  salt: string
  iv: string
  createdAt: number
}

export interface Settings {
  id: string
  apiUrl: string
  websocketUrl: string
  fuelProviderUrl: string
  createdAt: number
  updatedAt: number
}

// Track processed order fills to prevent duplicate processing on restart
export interface ProcessedFill {
  orderId: string // Primary key - order_id
  filledQuantity: string // Last processed filled_quantity
  marketId: string
  updatedAt: number
}

export class O2TradingBotDB extends Dexie {
  sessions!: Table<Session, string>
  sessionKeys!: Table<EncryptedSessionKey, string>
  markets!: Table<Market, string>
  trades!: Table<Trade, number>
  orders!: Table<Order, string>
  strategyConfigs!: Table<StrategyConfigStore, string>
  tradingAccounts!: Table<TradingAccount, string>
  settings!: Table<Settings, string>
  tradingSessions!: Table<TradingSession, string>
  processedFills!: Table<ProcessedFill, string>

  constructor() {
    super('O2TradingBotDB')
    this.version(1).stores({
      sessions: 'id, tradeAccountId, ownerAddress, createdAt',
      sessionKeys: 'id, createdAt',
      markets: 'market_id, contract_id',
      trades: '++id, timestamp, marketId, orderId, sessionId',
      orders: 'order_id, market_id, status, createdAt',
      strategyConfigs: 'id, marketId, strategyType',
      tradingAccounts: 'id, ownerAddress',
      settings: 'id',
    })
    this.version(2).stores({
      sessions: 'id, tradeAccountId, ownerAddress, createdAt',
      sessionKeys: 'id, createdAt',
      markets: 'market_id, contract_id',
      trades: '++id, timestamp, marketId, orderId, sessionId',
      orders: 'order_id, market_id, status, createdAt',
      strategyConfigs: 'id, marketId, strategyType',
      tradingAccounts: 'id, ownerAddress',
      settings: 'id',
      tradingSessions: 'id, ownerAddress, marketId, status, createdAt',
    })
    // Version 3: Add processedFills table for tracking order fills across restarts
    this.version(3).stores({
      sessions: 'id, tradeAccountId, ownerAddress, createdAt',
      sessionKeys: 'id, createdAt',
      markets: 'market_id, contract_id',
      trades: '++id, timestamp, marketId, orderId, sessionId',
      orders: 'order_id, market_id, status, createdAt',
      strategyConfigs: 'id, marketId, strategyType',
      tradingAccounts: 'id, ownerAddress',
      settings: 'id',
      tradingSessions: 'id, ownerAddress, marketId, status, createdAt',
      processedFills: 'orderId, marketId, updatedAt',
    })
  }
}

export const db = new O2TradingBotDB()

