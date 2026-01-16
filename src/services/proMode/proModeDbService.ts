/**
 * Pro Mode Database Service
 * Dexie (IndexedDB) database for Pro Mode data persistence
 */

import Dexie, { Table } from 'dexie';
import {
  CustomStrategy,
  StrategyVersion,
  BacktestConfig,
  BacktestResult,
  CustomIndicator,
  ShareLink,
  BarData,
  PaperPosition,
  PaperOrder,
  PaperTrade,
} from '../../types/proMode';

// ============================================
// CACHED EXTERNAL DATA
// ============================================

export interface CachedExternalData {
  id: string;
  feedType: string;                   // 'binance', 'pyth', 'coingecko'
  symbol: string;
  resolution: string;
  data: BarData[];
  lastUpdated: number;
  expiresAt: number;
}

// ============================================
// HISTORICAL DATA CACHE
// ============================================

export interface HistoricalDataCache {
  id: string;
  marketId: string;
  symbol: string;
  resolution: string;
  startDate: number;
  endDate: number;
  bars: BarData[];
  source: string;                     // 'o2-api', 'binance', 'csv', etc.
  uploadedAt: number;
}

// ============================================
// PAPER TRADING STATE (Serializable)
// ============================================

export interface SerializedPaperTradingState {
  id: string;                         // Unique identifier for the state (typically 'current')
  strategyId?: string;                // Associated strategy ID
  initialCapital: number;
  currentCapital: number;
  cash: number;
  positions: PaperPosition[];         // Array instead of Map for serialization
  openOrders: PaperOrder[];
  orderHistory: PaperOrder[];
  tradeHistory: PaperTrade[];
  totalPnl: number;
  totalPnlPercent: number;
  totalFees: number;
  feeRate: number;
  slippagePercent: number;
  startedAt: number;
  lastUpdatedAt: number;
}

// ============================================
// PRO MODE DATABASE
// ============================================

export class ProModeDB extends Dexie {
  // Strategy tables
  customStrategies!: Table<CustomStrategy, string>;
  strategyVersions!: Table<StrategyVersion, string>;

  // Backtest tables
  backtestConfigs!: Table<BacktestConfig, string>;
  backtestResults!: Table<BacktestResult, string>;

  // Indicator tables
  customIndicators!: Table<CustomIndicator, string>;

  // External data tables
  externalDataCache!: Table<CachedExternalData, string>;
  historicalDataCache!: Table<HistoricalDataCache, string>;

  // Paper trading tables
  paperTradingState!: Table<SerializedPaperTradingState, string>;

  // Sharing tables
  shareLinks!: Table<ShareLink, string>;

  constructor() {
    super('ProModeDB');

    this.version(1).stores({
      // Strategy tables - indexes for common queries
      customStrategies: 'id, name, status, templateCategory, isTemplate, createdAt, updatedAt',
      strategyVersions: 'id, strategyId, version, createdAt',

      // Backtest tables
      backtestConfigs: 'id, strategyId, strategyVersionId, createdAt',
      backtestResults: 'id, configId, strategyId, strategyVersionId, status, createdAt',

      // Indicator tables
      customIndicators: 'id, name, category, createdAt',

      // External data tables
      externalDataCache: 'id, feedType, symbol, resolution, expiresAt',
      historicalDataCache: 'id, marketId, symbol, resolution, source, uploadedAt',

      // Sharing tables
      shareLinks: 'id, strategyId, strategyVersionId, expiresAt, createdAt',
    });

    // Version 2: Add paper trading state table
    this.version(2).stores({
      // Strategy tables - indexes for common queries
      customStrategies: 'id, name, status, templateCategory, isTemplate, createdAt, updatedAt',
      strategyVersions: 'id, strategyId, version, createdAt',

      // Backtest tables
      backtestConfigs: 'id, strategyId, strategyVersionId, createdAt',
      backtestResults: 'id, configId, strategyId, strategyVersionId, status, createdAt',

      // Indicator tables
      customIndicators: 'id, name, category, createdAt',

      // External data tables
      externalDataCache: 'id, feedType, symbol, resolution, expiresAt',
      historicalDataCache: 'id, marketId, symbol, resolution, source, uploadedAt',

      // Paper trading tables
      paperTradingState: 'id, strategyId, lastUpdatedAt',

      // Sharing tables
      shareLinks: 'id, strategyId, strategyVersionId, expiresAt, createdAt',
    });
  }
}

// Singleton instance
export const proModeDb = new ProModeDB();

// ============================================
// STRATEGY OPERATIONS
// ============================================

export const strategyOperations = {
  async getAll(): Promise<CustomStrategy[]> {
    return proModeDb.customStrategies.toArray();
  },

  async getById(id: string): Promise<CustomStrategy | undefined> {
    return proModeDb.customStrategies.get(id);
  },

  async getTemplates(): Promise<CustomStrategy[]> {
    return proModeDb.customStrategies.where('isTemplate').equals(1).toArray();
  },

  async getByStatus(status: string): Promise<CustomStrategy[]> {
    return proModeDb.customStrategies.where('status').equals(status).toArray();
  },

  async create(strategy: CustomStrategy): Promise<string> {
    return proModeDb.customStrategies.add(strategy);
  },

  async update(id: string, changes: Partial<CustomStrategy>): Promise<number> {
    return proModeDb.customStrategies.update(id, {
      ...changes,
      updatedAt: Date.now(),
    });
  },

  async delete(id: string): Promise<void> {
    // Delete associated versions first
    await proModeDb.strategyVersions.where('strategyId').equals(id).delete();
    // Delete associated backtest results
    await proModeDb.backtestResults.where('strategyId').equals(id).delete();
    // Delete associated backtest configs
    await proModeDb.backtestConfigs.where('strategyId').equals(id).delete();
    // Delete the strategy
    await proModeDb.customStrategies.delete(id);
  },

  async search(query: string): Promise<CustomStrategy[]> {
    const lowerQuery = query.toLowerCase();
    return proModeDb.customStrategies
      .filter(s =>
        s.name.toLowerCase().includes(lowerQuery) ||
        (s.description?.toLowerCase().includes(lowerQuery) ?? false) ||
        s.tags.some(t => t.toLowerCase().includes(lowerQuery))
      )
      .toArray();
  },
};

// ============================================
// VERSION OPERATIONS
// ============================================

export const versionOperations = {
  async getByStrategyId(strategyId: string): Promise<StrategyVersion[]> {
    return proModeDb.strategyVersions
      .where('strategyId')
      .equals(strategyId)
      .reverse()
      .sortBy('createdAt');
  },

  async getById(id: string): Promise<StrategyVersion | undefined> {
    return proModeDb.strategyVersions.get(id);
  },

  async create(version: StrategyVersion): Promise<string> {
    return proModeDb.strategyVersions.add(version);
  },

  async delete(id: string): Promise<void> {
    await proModeDb.strategyVersions.delete(id);
  },

  async deleteByStrategyId(strategyId: string): Promise<number> {
    return proModeDb.strategyVersions.where('strategyId').equals(strategyId).delete();
  },
};

// ============================================
// BACKTEST OPERATIONS
// ============================================

export const backtestOperations = {
  // Configs
  async getConfigById(id: string): Promise<BacktestConfig | undefined> {
    return proModeDb.backtestConfigs.get(id);
  },

  async getConfigsByStrategyId(strategyId: string): Promise<BacktestConfig[]> {
    return proModeDb.backtestConfigs
      .where('strategyId')
      .equals(strategyId)
      .reverse()
      .sortBy('createdAt');
  },

  async createConfig(config: BacktestConfig): Promise<string> {
    return proModeDb.backtestConfigs.add(config);
  },

  async deleteConfig(id: string): Promise<void> {
    // Delete associated results first
    await proModeDb.backtestResults.where('configId').equals(id).delete();
    await proModeDb.backtestConfigs.delete(id);
  },

  // Results
  async getResultById(id: string): Promise<BacktestResult | undefined> {
    return proModeDb.backtestResults.get(id);
  },

  async getResultsByConfigId(configId: string): Promise<BacktestResult[]> {
    return proModeDb.backtestResults
      .where('configId')
      .equals(configId)
      .reverse()
      .sortBy('createdAt');
  },

  async getResultsByStrategyId(strategyId: string): Promise<BacktestResult[]> {
    return proModeDb.backtestResults
      .where('strategyId')
      .equals(strategyId)
      .reverse()
      .sortBy('createdAt');
  },

  async createResult(result: BacktestResult): Promise<string> {
    return proModeDb.backtestResults.add(result);
  },

  async updateResult(id: string, changes: Partial<BacktestResult>): Promise<number> {
    return proModeDb.backtestResults.update(id, changes);
  },

  async deleteResult(id: string): Promise<void> {
    await proModeDb.backtestResults.delete(id);
  },

  async getRecentResults(limit: number = 10): Promise<BacktestResult[]> {
    return proModeDb.backtestResults
      .orderBy('createdAt')
      .reverse()
      .limit(limit)
      .toArray();
  },
};

// ============================================
// INDICATOR OPERATIONS
// ============================================

export const indicatorOperations = {
  async getAll(): Promise<CustomIndicator[]> {
    return proModeDb.customIndicators.toArray();
  },

  async getById(id: string): Promise<CustomIndicator | undefined> {
    return proModeDb.customIndicators.get(id);
  },

  async getByCategory(category: string): Promise<CustomIndicator[]> {
    return proModeDb.customIndicators.where('category').equals(category).toArray();
  },

  async create(indicator: CustomIndicator): Promise<string> {
    return proModeDb.customIndicators.add(indicator);
  },

  async update(id: string, changes: Partial<CustomIndicator>): Promise<number> {
    return proModeDb.customIndicators.update(id, {
      ...changes,
      updatedAt: Date.now(),
    });
  },

  async delete(id: string): Promise<void> {
    await proModeDb.customIndicators.delete(id);
  },
};

// ============================================
// EXTERNAL DATA CACHE OPERATIONS
// ============================================

export const externalDataOperations = {
  async get(feedType: string, symbol: string, resolution: string): Promise<CachedExternalData | undefined> {
    return proModeDb.externalDataCache
      .where(['feedType', 'symbol', 'resolution'])
      .equals([feedType, symbol, resolution])
      .first();
  },

  async set(data: CachedExternalData): Promise<string> {
    // Remove existing cache for same feed/symbol/resolution
    await proModeDb.externalDataCache
      .where(['feedType', 'symbol', 'resolution'])
      .equals([data.feedType, data.symbol, data.resolution])
      .delete();

    return proModeDb.externalDataCache.add(data);
  },

  async clearExpired(): Promise<number> {
    const now = Date.now();
    return proModeDb.externalDataCache.where('expiresAt').below(now).delete();
  },

  async clearAll(): Promise<void> {
    await proModeDb.externalDataCache.clear();
  },
};

// ============================================
// HISTORICAL DATA CACHE OPERATIONS
// ============================================

export const historicalDataOperations = {
  async get(marketId: string, resolution: string): Promise<HistoricalDataCache | undefined> {
    return proModeDb.historicalDataCache
      .where(['marketId', 'resolution'])
      .equals([marketId, resolution])
      .first();
  },

  async getBySource(source: string): Promise<HistoricalDataCache[]> {
    return proModeDb.historicalDataCache.where('source').equals(source).toArray();
  },

  async set(data: HistoricalDataCache): Promise<string> {
    return proModeDb.historicalDataCache.add(data);
  },

  async update(id: string, changes: Partial<HistoricalDataCache>): Promise<number> {
    return proModeDb.historicalDataCache.update(id, changes);
  },

  async delete(id: string): Promise<void> {
    await proModeDb.historicalDataCache.delete(id);
  },

  async getAll(): Promise<HistoricalDataCache[]> {
    return proModeDb.historicalDataCache.toArray();
  },
};

// ============================================
// SHARE LINK OPERATIONS
// ============================================

export const shareLinkOperations = {
  async getById(id: string): Promise<ShareLink | undefined> {
    return proModeDb.shareLinks.get(id);
  },

  async getByStrategyId(strategyId: string): Promise<ShareLink[]> {
    return proModeDb.shareLinks
      .where('strategyId')
      .equals(strategyId)
      .toArray();
  },

  async create(link: ShareLink): Promise<string> {
    return proModeDb.shareLinks.add(link);
  },

  async incrementDownloads(id: string): Promise<void> {
    const link = await proModeDb.shareLinks.get(id);
    if (link) {
      await proModeDb.shareLinks.update(id, {
        downloadsCount: link.downloadsCount + 1,
      });
    }
  },

  async delete(id: string): Promise<void> {
    await proModeDb.shareLinks.delete(id);
  },

  async clearExpired(): Promise<number> {
    const now = Date.now();
    return proModeDb.shareLinks.where('expiresAt').below(now).delete();
  },
};

// ============================================
// PAPER TRADING STATE OPERATIONS
// ============================================

export const paperTradingStateOperations = {
  async get(id: string = 'current'): Promise<SerializedPaperTradingState | undefined> {
    return proModeDb.paperTradingState.get(id);
  },

  async save(state: SerializedPaperTradingState): Promise<void> {
    await proModeDb.paperTradingState.put(state);
  },

  async delete(id: string = 'current'): Promise<void> {
    await proModeDb.paperTradingState.delete(id);
  },

  async getByStrategyId(strategyId: string): Promise<SerializedPaperTradingState | undefined> {
    return proModeDb.paperTradingState
      .where('strategyId')
      .equals(strategyId)
      .first();
  },

  async clear(): Promise<void> {
    await proModeDb.paperTradingState.clear();
  },
};

// ============================================
// DATABASE UTILITIES
// ============================================

export const dbUtils = {
  async clearAllData(): Promise<void> {
    await proModeDb.transaction(
      'rw',
      [
        proModeDb.customStrategies,
        proModeDb.strategyVersions,
        proModeDb.backtestConfigs,
        proModeDb.backtestResults,
        proModeDb.customIndicators,
        proModeDb.externalDataCache,
        proModeDb.historicalDataCache,
        proModeDb.paperTradingState,
        proModeDb.shareLinks,
      ],
      async () => {
        await proModeDb.customStrategies.clear();
        await proModeDb.strategyVersions.clear();
        await proModeDb.backtestConfigs.clear();
        await proModeDb.backtestResults.clear();
        await proModeDb.customIndicators.clear();
        await proModeDb.externalDataCache.clear();
        await proModeDb.historicalDataCache.clear();
        await proModeDb.paperTradingState.clear();
        await proModeDb.shareLinks.clear();
      }
    );
  },

  async getStorageUsage(): Promise<{ strategies: number; backtests: number; cache: number }> {
    const strategies = await proModeDb.customStrategies.count();
    const backtests = await proModeDb.backtestResults.count();
    const cache = (await proModeDb.externalDataCache.count()) +
                  (await proModeDb.historicalDataCache.count());

    return { strategies, backtests, cache };
  },

  async exportAllData(): Promise<object> {
    return {
      customStrategies: await proModeDb.customStrategies.toArray(),
      strategyVersions: await proModeDb.strategyVersions.toArray(),
      backtestConfigs: await proModeDb.backtestConfigs.toArray(),
      backtestResults: await proModeDb.backtestResults.toArray(),
      customIndicators: await proModeDb.customIndicators.toArray(),
      shareLinks: await proModeDb.shareLinks.toArray(),
    };
  },
};
