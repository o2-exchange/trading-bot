/**
 * External Data Service
 * Fetches historical market data from various sources for backtesting
 */

import { BarData, BarResolution } from '../../types/proMode';
import { proModeDb, HistoricalDataCache } from './proModeDbService';

// ============================================
// DATA SOURCE TYPES
// ============================================

export interface DataSourceConfig {
  type: 'o2-api' | 'binance' | 'bitget' | 'pyth' | 'coingecko' | 'csv-upload';
  marketId?: string;
  symbol?: string;
  uploadedFileId?: string;
}

export interface FetchOptions {
  startDate: number;
  endDate: number;
  resolution: BarResolution;
  useCache?: boolean;
}

// ============================================
// EXTERNAL DATA SERVICE
// ============================================

// O2 API environments
type O2Environment = 'mainnet' | 'testnet' | 'devnet';

const O2_API_URLS: Record<O2Environment, string> = {
  mainnet: 'https://api.o2.app',
  testnet: 'https://api.testnet.o2.app',
  devnet: 'https://api.devnet.o2.app',
};

// O2 Market Info type for caching
interface O2MarketInfo {
  market_id: string;
  base: { symbol: string; decimals: number };
  quote: { symbol: string; decimals: number };
}

class ExternalDataService {
  private readonly BINANCE_API = 'https://api.binance.com';
  private readonly BITGET_API = 'https://api.bitget.com';
  private readonly COINGECKO_API = 'https://api.coingecko.com/api/v3';
  private readonly FETCH_TIMEOUT_MS = 30000; // 30 second timeout
  private readonly MARKET_INFO_CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache
  private o2Environment: O2Environment = 'testnet'; // Default to testnet

  // Market info cache to avoid fetching on every bar request
  private marketInfoCache = new Map<string, { info: O2MarketInfo; timestamp: number }>();

  /**
   * Set O2 API environment (mainnet, testnet, devnet)
   */
  setO2Environment(env: O2Environment): void {
    this.o2Environment = env;
    // Clear cache when environment changes
    this.marketInfoCache.clear();
  }

  /**
   * Get current O2 environment
   */
  getO2Environment(): O2Environment {
    return this.o2Environment;
  }

  /**
   * Get available O2 environments
   */
  getO2Environments(): O2Environment[] {
    return ['mainnet', 'testnet', 'devnet'];
  }

  /**
   * Get current O2 API URL based on environment
   */
  private get O2_API(): string {
    return O2_API_URLS[this.o2Environment];
  }

  /**
   * Fetch with timeout support
   */
  private async fetchWithTimeout(url: string, timeoutMs: number = this.FETCH_TIMEOUT_MS): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Fetch historical bar data from configured source
   */
  async fetchBars(
    source: DataSourceConfig,
    options: FetchOptions
  ): Promise<BarData[]> {
    // Check cache first
    if (options.useCache !== false) {
      const cached = await this.getCachedData(source, options);
      if (cached && cached.length > 0) {
        return cached;
      }
    }

    // Fetch from source
    let bars: BarData[];

    switch (source.type) {
      case 'o2-api':
        bars = await this.fetchO2Bars(source.marketId!, options);
        break;
      case 'binance':
        bars = await this.fetchBinanceKlines(source.symbol!, options);
        break;
      case 'bitget':
        bars = await this.fetchBitgetBars(source.symbol!, options);
        break;
      case 'coingecko':
        bars = await this.fetchCoinGeckoHistory(source.symbol!, options);
        break;
      case 'csv-upload':
        bars = await this.getUploadedData(source.uploadedFileId!);
        break;
      default:
        throw new Error(`Unsupported data source: ${source.type}`);
    }

    // Cache the data
    if (bars.length > 0) {
      await this.cacheData(source, options, bars);
    }

    return bars;
  }

  /**
   * Fetch bars from O2 API
   * O2 Exchange uses ms timestamps and has format: 1s, 1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w, 1M
   * NOTE: O2 returns prices/volumes scaled by decimals (typically 10^9)
   * NOTE: O2 API limits to 5000 bars per request, so we fetch in chunks
   */
  async fetchO2Bars(marketId: string, options: FetchOptions): Promise<BarData[]> {
    const resolution = this.convertResolutionToO2String(options.resolution);

    // First get market info to determine decimals (throws on failure)
    const marketInfo = await this.getO2MarketInfo(marketId);
    const priceDecimals = marketInfo.quote.decimals;
    const volumeDecimals = marketInfo.base.decimals;
    const priceScale = Math.pow(10, priceDecimals);
    const volumeScale = Math.pow(10, volumeDecimals);

    console.log(`[ExternalDataService] O2 market decimals - price: ${priceDecimals}, volume: ${volumeDecimals}`);

    // O2 API limits to 5000 bars per request, use 4000 to be safe
    const MAX_BARS_PER_REQUEST = 4000;
    const resolutionMs = this.getResolutionMs(options.resolution);
    const allBars: BarData[] = [];

    let startTime = options.startDate;
    const endTime = options.endDate;

    console.log(`[ExternalDataService] Fetching O2 bars from ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`);

    while (startTime < endTime) {
      // Calculate chunk end time (max 4000 bars worth)
      const chunkEndTime = Math.min(startTime + (MAX_BARS_PER_REQUEST * resolutionMs), endTime);

      const url = new URL('/v1/bars', this.O2_API);
      url.searchParams.set('market_id', marketId);
      url.searchParams.set('resolution', resolution);
      url.searchParams.set('from', startTime.toString()); // O2 uses ms
      url.searchParams.set('to', chunkEndTime.toString());

      console.log(`[ExternalDataService] Fetching O2 bars chunk: ${url.toString()}`);

      const response = await this.fetchWithTimeout(url.toString());
      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        console.error(`[ExternalDataService] O2 API error: ${response.status} - ${errorText}`);
        throw new Error(`O2 API error: ${response.status}`);
      }

      const data = await response.json();

      if (!data.bars || !Array.isArray(data.bars)) {
        console.warn('[ExternalDataService] O2 API returned no bars data for chunk');
        // Move to next chunk
        startTime = chunkEndTime + 1;
        continue;
      }

      console.log(`[ExternalDataService] O2 API returned ${data.bars.length} bars in chunk`);

      // Process bars in this chunk
      let invalidBarCount = 0;

      for (let i = 0; i < data.bars.length; i++) {
        const bar = data.bars[i];

        const open = parseFloat(bar.open) / priceScale;
        const high = parseFloat(bar.high) / priceScale;
        const low = parseFloat(bar.low) / priceScale;
        const close = parseFloat(bar.close) / priceScale;
        const volume = (parseFloat(bar.buy_volume || '0') + parseFloat(bar.sell_volume || '0')) / volumeScale;

        // Validate all values are finite numbers
        if (!Number.isFinite(open) || !Number.isFinite(high) ||
            !Number.isFinite(low) || !Number.isFinite(close) || !Number.isFinite(volume)) {
          invalidBarCount++;
          continue;
        }

        allBars.push({
          timestamp: bar.timestamp, // O2 returns timestamp in ms
          open,
          high,
          low,
          close,
          volume,
        });
      }

      if (invalidBarCount > 0) {
        console.warn(`[ExternalDataService] Skipped ${invalidBarCount} invalid bars in chunk`);
      }

      // Move to next chunk - use last bar timestamp + 1ms to avoid duplicates
      if (data.bars.length > 0) {
        const lastBarTimestamp = data.bars[data.bars.length - 1].timestamp;
        startTime = lastBarTimestamp + 1;
      } else {
        startTime = chunkEndTime + 1;
      }

      // Rate limiting - wait 100ms between requests
      if (startTime < endTime) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Sort by timestamp to ensure order
    allBars.sort((a, b) => a.timestamp - b.timestamp);

    console.log(`[ExternalDataService] Total O2 bars fetched: ${allBars.length}`);

    // Log first and last bar for debugging
    if (allBars.length > 0) {
      console.log(`[ExternalDataService] First bar (scaled): ${JSON.stringify(allBars[0])}`);
      console.log(`[ExternalDataService] Last bar (scaled): ${JSON.stringify(allBars[allBars.length - 1])}`);
    }

    return allBars;
  }

  /**
   * Get resolution in milliseconds
   */
  private getResolutionMs(resolution: BarResolution): number {
    const resolutionMap: Record<BarResolution, number> = {
      '1m': 60000,
      '5m': 300000,
      '15m': 900000,
      '30m': 1800000,
      '1h': 3600000,
      '4h': 14400000,
      '1D': 86400000,
    };
    return resolutionMap[resolution] || 3600000; // Default to 1h
  }

  /**
   * Get O2 market info including decimals (with caching)
   * Throws on failure - do not silently return null
   */
  private async getO2MarketInfo(marketId: string): Promise<O2MarketInfo> {
    // Check cache first
    const cached = this.marketInfoCache.get(marketId);
    if (cached && Date.now() - cached.timestamp < this.MARKET_INFO_CACHE_TTL) {
      console.log(`[ExternalDataService] Using cached market info for ${marketId}`);
      return cached.info;
    }

    console.log(`[ExternalDataService] Fetching market info for ${marketId}`);

    try {
      const response = await this.fetchWithTimeout(`${this.O2_API}/v1/markets`);
      if (!response.ok) {
        throw new Error(`O2 markets API error: ${response.status}`);
      }

      const data = await response.json();
      if (!data.markets || !Array.isArray(data.markets)) {
        throw new Error('O2 markets API returned invalid data structure');
      }

      const marketInfo = data.markets.find((m: any) => m.market_id === marketId);
      if (!marketInfo) {
        throw new Error(`Market ${marketId} not found in O2 markets`);
      }

      // Validate required decimals fields
      if (typeof marketInfo.quote?.decimals !== 'number') {
        throw new Error(`Market ${marketId} is missing quote.decimals`);
      }
      if (typeof marketInfo.base?.decimals !== 'number') {
        throw new Error(`Market ${marketId} is missing base.decimals`);
      }

      const info: O2MarketInfo = {
        market_id: marketInfo.market_id,
        base: { symbol: marketInfo.base.symbol, decimals: marketInfo.base.decimals },
        quote: { symbol: marketInfo.quote.symbol, decimals: marketInfo.quote.decimals },
      };

      // Cache the result
      this.marketInfoCache.set(marketId, { info, timestamp: Date.now() });

      console.log(`[ExternalDataService] Cached market info for ${marketId}: price decimals=${info.quote.decimals}, volume decimals=${info.base.decimals}`);

      return info;
    } catch (error) {
      console.error('[ExternalDataService] Failed to get market info:', error);
      throw error; // Re-throw - do not silently fail
    }
  }

  /**
   * Convert resolution to O2 API format string
   */
  private convertResolutionToO2String(resolution: BarResolution): string {
    const map: Record<BarResolution, string> = {
      '1m': '1m',
      '5m': '5m',
      '15m': '15m',
      '30m': '30m',
      '1h': '1h',
      '4h': '4h',
      '1D': '1d',
    };
    return map[resolution] || '1h';
  }

  /**
   * Get available O2 markets
   */
  async getO2Markets(): Promise<Array<{ id: string; baseSymbol: string; quoteSymbol: string }>> {
    try {
      const response = await this.fetchWithTimeout(`${this.O2_API}/v1/markets`);
      if (!response.ok) {
        throw new Error(`O2 API error: ${response.status}`);
      }

      const data = await response.json();

      if (!data.markets || !Array.isArray(data.markets)) {
        console.warn('[ExternalDataService] O2 markets API returned invalid structure');
        return [];
      }

      console.log(`[ExternalDataService] Fetched ${data.markets.length} O2 markets`);

      return data.markets.map((market: any) => ({
        id: market.market_id || market.id,
        baseSymbol: market.base?.symbol || 'UNKNOWN',
        quoteSymbol: market.quote?.symbol || 'USDC',
      }));
    } catch (error) {
      console.error('[ExternalDataService] Failed to fetch O2 markets:', error);
      throw error; // Re-throw so the caller knows the request failed
    }
  }

  /**
   * Fetch klines from Binance API
   */
  async fetchBinanceKlines(symbol: string, options: FetchOptions): Promise<BarData[]> {
    try {
      const interval = this.convertResolutionToBinance(options.resolution);
      const bars: BarData[] = [];

      console.log(`[ExternalDataService] Fetching Binance klines for ${symbol}, interval: ${interval}`);

      // Binance limits to 1000 candles per request
      const limit = 1000;
      let startTime = options.startDate;

      while (startTime < options.endDate) {
        const url = new URL('/api/v3/klines', this.BINANCE_API);
        url.searchParams.set('symbol', symbol.toUpperCase());
        url.searchParams.set('interval', interval);
        url.searchParams.set('startTime', startTime.toString());
        url.searchParams.set('endTime', options.endDate.toString());
        url.searchParams.set('limit', limit.toString());

        console.log(`[ExternalDataService] Binance request: ${url.toString()}`);

        const response = await fetch(url.toString());
        if (!response.ok) {
          console.error(`[ExternalDataService] Binance API error: ${response.status}`);
          throw new Error(`Binance API error: ${response.status}`);
        }

        const data = await response.json();
        console.log(`[ExternalDataService] Binance returned ${data.length} klines`);

        if (data.length === 0) break;

        for (const kline of data) {
          bars.push({
            timestamp: kline[0],
            open: parseFloat(kline[1]),
            high: parseFloat(kline[2]),
            low: parseFloat(kline[3]),
            close: parseFloat(kline[4]),
            volume: parseFloat(kline[5]),
          });
        }

        // Move to next batch
        startTime = data[data.length - 1][0] + 1;

        // Rate limiting - wait 100ms between requests
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      console.log(`[ExternalDataService] Total Binance bars fetched: ${bars.length}`);

      // Log first and last bar for debugging
      if (bars.length > 0) {
        console.log(`[ExternalDataService] First bar: ${JSON.stringify(bars[0])}`);
        console.log(`[ExternalDataService] Last bar: ${JSON.stringify(bars[bars.length - 1])}`);
      }

      return bars;
    } catch (error) {
      console.error('[ExternalDataService] Failed to fetch Binance klines:', error);
      return [];
    }
  }

  /**
   * Fetch klines from Bitget API
   * Bitget API docs: https://www.bitget.com/api-doc/spot/market/Get-Candle-Data
   * Returns: [[timestamp, open, high, low, close, baseVolume, quoteVolume], ...]
   */
  async fetchBitgetBars(symbol: string, options: FetchOptions): Promise<BarData[]> {
    try {
      const granularity = this.convertResolutionToBitget(options.resolution);
      const bars: BarData[] = [];

      console.log(`[ExternalDataService] Fetching Bitget klines for ${symbol}, granularity: ${granularity}`);

      // Bitget limits to 1000 candles per request
      const limit = 1000;
      let startTime = options.startDate;

      while (startTime < options.endDate) {
        const url = new URL('/api/v2/spot/market/candles', this.BITGET_API);
        url.searchParams.set('symbol', symbol.toUpperCase());
        url.searchParams.set('granularity', granularity);
        url.searchParams.set('startTime', startTime.toString());
        url.searchParams.set('endTime', options.endDate.toString());
        url.searchParams.set('limit', limit.toString());

        console.log(`[ExternalDataService] Bitget request: ${url.toString()}`);

        const response = await this.fetchWithTimeout(url.toString());
        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          console.error(`[ExternalDataService] Bitget API error: ${response.status} - ${errorText}`);
          throw new Error(`Bitget API error: ${response.status}`);
        }

        const data = await response.json();

        // Bitget returns { code: "00000", data: [...], msg: "success" }
        if (data.code !== '00000' || !data.data || !Array.isArray(data.data)) {
          console.error(`[ExternalDataService] Bitget API returned error:`, data);
          throw new Error(`Bitget API error: ${data.msg || 'Invalid response'}`);
        }

        console.log(`[ExternalDataService] Bitget returned ${data.data.length} klines`);

        if (data.data.length === 0) break;

        // Bitget returns arrays: [timestamp, open, high, low, close, baseVol, quoteVol]
        for (const kline of data.data) {
          const timestamp = parseInt(kline[0], 10);
          bars.push({
            timestamp,
            open: parseFloat(kline[1]),
            high: parseFloat(kline[2]),
            low: parseFloat(kline[3]),
            close: parseFloat(kline[4]),
            volume: parseFloat(kline[5]), // baseVolume
          });
        }

        // Move to next batch - get the newest timestamp and continue from there
        const timestamps = data.data.map((k: string[]) => parseInt(k[0], 10));
        const newestTimestamp = Math.max(...timestamps);

        // Move forward from the newest timestamp
        startTime = newestTimestamp + this.getResolutionMs(options.resolution);

        // Rate limiting - wait 100ms between requests
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Sort by timestamp (ascending)
      bars.sort((a, b) => a.timestamp - b.timestamp);

      // Remove duplicates based on timestamp
      const uniqueBars: BarData[] = [];
      const seenTimestamps = new Set<number>();
      for (const bar of bars) {
        if (!seenTimestamps.has(bar.timestamp)) {
          seenTimestamps.add(bar.timestamp);
          uniqueBars.push(bar);
        }
      }

      console.log(`[ExternalDataService] Total Bitget bars fetched: ${uniqueBars.length}`);

      // Log first and last bar for debugging
      if (uniqueBars.length > 0) {
        console.log(`[ExternalDataService] First bar: ${JSON.stringify(uniqueBars[0])}`);
        console.log(`[ExternalDataService] Last bar: ${JSON.stringify(uniqueBars[uniqueBars.length - 1])}`);
      }

      return uniqueBars;
    } catch (error) {
      console.error('[ExternalDataService] Failed to fetch Bitget klines:', error);
      throw error; // Re-throw so caller knows fetch failed
    }
  }

  /**
   * Get available Bitget spot symbols
   */
  async getBitgetSymbols(): Promise<Array<{ symbol: string; baseCoin: string; quoteCoin: string }>> {
    try {
      const url = new URL('/api/v2/spot/public/symbols', this.BITGET_API);
      const response = await this.fetchWithTimeout(url.toString());

      if (!response.ok) {
        throw new Error(`Bitget API error: ${response.status}`);
      }

      const data = await response.json();

      if (data.code !== '00000' || !data.data || !Array.isArray(data.data)) {
        console.error('[ExternalDataService] Bitget symbols API returned error:', data);
        return [];
      }

      // Filter for USDT pairs that are trading
      return data.data
        .filter((s: any) => s.quoteCoin === 'USDT' && s.status === 'online')
        .map((s: any) => ({
          symbol: s.symbol,
          baseCoin: s.baseCoin,
          quoteCoin: s.quoteCoin,
        }));
    } catch (error) {
      console.error('[ExternalDataService] Failed to fetch Bitget symbols:', error);
      return [];
    }
  }

  /**
   * Convert resolution to Bitget granularity format
   * Bitget uses: 1min, 5min, 15min, 30min, 1h, 4h, 1day, 1week
   */
  private convertResolutionToBitget(resolution: BarResolution): string {
    const map: Record<BarResolution, string> = {
      '1m': '1min',
      '5m': '5min',
      '15m': '15min',
      '30m': '30min',
      '1h': '1h',
      '4h': '4h',
      '1D': '1day',
    };
    return map[resolution] || '1h';
  }

  /**
   * Fetch historical data from CoinGecko
   * Note: CoinGecko only provides daily data for free tier
   */
  async fetchCoinGeckoHistory(coinId: string, options: FetchOptions): Promise<BarData[]> {
    try {
      const days = Math.ceil((options.endDate - options.startDate) / (24 * 60 * 60 * 1000));

      const url = new URL(`/coins/${coinId.toLowerCase()}/market_chart`, this.COINGECKO_API);
      url.searchParams.set('vs_currency', 'usd');
      url.searchParams.set('days', days.toString());

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
      }

      const data = await response.json();
      const bars: BarData[] = [];

      // CoinGecko returns prices at various intervals
      // We'll convert to daily OHLCV-like data
      const pricesByDay = new Map<number, number[]>();

      for (const [timestamp, price] of data.prices) {
        const dayKey = Math.floor(timestamp / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000);
        if (!pricesByDay.has(dayKey)) {
          pricesByDay.set(dayKey, []);
        }
        pricesByDay.get(dayKey)!.push(price);
      }

      // Convert to bars
      for (const [timestamp, prices] of pricesByDay) {
        if (prices.length === 0) continue;

        bars.push({
          timestamp,
          open: prices[0],
          high: Math.max(...prices),
          low: Math.min(...prices),
          close: prices[prices.length - 1],
          volume: 0, // CoinGecko doesn't provide volume in market_chart
        });
      }

      // Sort by timestamp
      bars.sort((a, b) => a.timestamp - b.timestamp);

      // Filter to requested range
      return bars.filter(
        bar => bar.timestamp >= options.startDate && bar.timestamp <= options.endDate
      );
    } catch (error) {
      console.error('Failed to fetch CoinGecko history:', error);
      return [];
    }
  }

  /**
   * Parse uploaded CSV file
   */
  async parseCSVFile(file: File): Promise<{ bars: BarData[]; id: string }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = async (event) => {
        try {
          const csv = event.target?.result as string;
          const bars = this.parseCSV(csv);
          const id = crypto.randomUUID();

          // Store in database
          await proModeDb.historicalDataCache.put({
            id,
            marketId: `csv-${id}`,
            symbol: `csv-${id}`,
            resolution: '1D',
            bars,
            startDate: bars[0]?.timestamp || 0,
            endDate: bars[bars.length - 1]?.timestamp || 0,
            source: 'csv-upload',
            uploadedAt: Date.now(),
          });

          resolve({ bars, id });
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  /**
   * Parse CSV string to bar data
   * Expects columns: timestamp/date, open, high, low, close, volume
   */
  parseCSV(csv: string): BarData[] {
    const lines = csv.trim().split('\n');
    if (lines.length < 2) {
      throw new Error('CSV must have header and at least one data row');
    }

    // Parse header to find column indices
    const header = lines[0].toLowerCase().split(',').map(h => h.trim());
    const indices = {
      timestamp: this.findColumnIndex(header, ['timestamp', 'date', 'time', 'datetime']),
      open: this.findColumnIndex(header, ['open', 'o']),
      high: this.findColumnIndex(header, ['high', 'h']),
      low: this.findColumnIndex(header, ['low', 'l']),
      close: this.findColumnIndex(header, ['close', 'c', 'price']),
      volume: this.findColumnIndex(header, ['volume', 'vol', 'v']),
    };

    if (indices.timestamp === -1 || indices.close === -1) {
      throw new Error('CSV must have timestamp/date and close/price columns');
    }

    const bars: BarData[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      if (values.length < 2) continue;

      try {
        const timestamp = this.parseTimestamp(values[indices.timestamp]);
        const close = parseFloat(values[indices.close]);

        if (isNaN(timestamp) || isNaN(close)) continue;

        bars.push({
          timestamp,
          open: indices.open !== -1 ? parseFloat(values[indices.open]) : close,
          high: indices.high !== -1 ? parseFloat(values[indices.high]) : close,
          low: indices.low !== -1 ? parseFloat(values[indices.low]) : close,
          close,
          volume: indices.volume !== -1 ? parseFloat(values[indices.volume]) : 0,
        });
      } catch (error) {
        console.warn(`Skipping invalid row ${i}:`, error);
      }
    }

    // Sort by timestamp
    bars.sort((a, b) => a.timestamp - b.timestamp);

    return bars;
  }

  /**
   * Parse JSON file to bar data
   */
  parseJSON(json: string): BarData[] {
    const data = JSON.parse(json);

    // Handle array format
    if (Array.isArray(data)) {
      return data.map((item: any) => ({
        timestamp: this.parseTimestamp(item.timestamp || item.date || item.time),
        open: parseFloat(item.open || item.o || item.close),
        high: parseFloat(item.high || item.h || item.close),
        low: parseFloat(item.low || item.l || item.close),
        close: parseFloat(item.close || item.c || item.price),
        volume: parseFloat(item.volume || item.vol || 0),
      }));
    }

    // Handle object with bars array
    if (data.bars && Array.isArray(data.bars)) {
      return this.parseJSON(JSON.stringify(data.bars));
    }

    throw new Error('Invalid JSON format');
  }

  /**
   * Get available Binance symbols
   */
  async getBinanceSymbols(): Promise<string[]> {
    try {
      const response = await fetch(`${this.BINANCE_API}/api/v3/exchangeInfo`);
      if (!response.ok) {
        throw new Error(`Binance API error: ${response.status}`);
      }

      const data = await response.json();
      return data.symbols
        .filter((s: any) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
        .map((s: any) => s.symbol);
    } catch (error) {
      console.error('Failed to fetch Binance symbols:', error);
      return [];
    }
  }

  /**
   * Get available CoinGecko coins
   */
  async getCoinGeckoCoins(): Promise<Array<{ id: string; symbol: string; name: string }>> {
    try {
      const response = await fetch(`${this.COINGECKO_API}/coins/list`);
      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to fetch CoinGecko coins:', error);
      return [];
    }
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private async getCachedData(
    source: DataSourceConfig,
    options: FetchOptions
  ): Promise<BarData[] | null> {
    const marketId = source.marketId || source.symbol || source.uploadedFileId || '';

    const cached = await proModeDb.historicalDataCache
      .where('marketId')
      .equals(marketId)
      .filter(data =>
        data.resolution === options.resolution &&
        data.startDate <= options.startDate &&
        data.endDate >= options.endDate
      )
      .first();

    if (cached) {
      return cached.bars.filter(
        bar => bar.timestamp >= options.startDate && bar.timestamp <= options.endDate
      );
    }

    return null;
  }

  private async cacheData(
    source: DataSourceConfig,
    options: FetchOptions,
    bars: BarData[]
  ): Promise<void> {
    const marketId = source.marketId || source.symbol || source.uploadedFileId || '';

    const cacheEntry: HistoricalDataCache = {
      id: `${marketId}-${options.resolution}-${options.startDate}-${options.endDate}`,
      marketId,
      symbol: marketId,
      resolution: options.resolution,
      bars,
      startDate: options.startDate,
      endDate: options.endDate,
      source: source.type,
      uploadedAt: Date.now(),
    };

    await proModeDb.historicalDataCache.put(cacheEntry);
  }

  private async getUploadedData(fileId: string): Promise<BarData[]> {
    const data = await proModeDb.historicalDataCache
      .where('id')
      .equals(fileId)
      .first();

    return data?.bars || [];
  }

  private findColumnIndex(header: string[], aliases: string[]): number {
    for (const alias of aliases) {
      const index = header.indexOf(alias);
      if (index !== -1) return index;
    }
    return -1;
  }

  private parseTimestamp(value: string | number): number {
    if (typeof value === 'number') {
      // Already a timestamp - check if seconds or milliseconds
      return value < 10000000000 ? value * 1000 : value;
    }

    // Try parsing as date string
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date.getTime();
    }

    // Try parsing as Unix timestamp string
    const num = parseFloat(value);
    if (!isNaN(num)) {
      return num < 10000000000 ? num * 1000 : num;
    }

    throw new Error(`Invalid timestamp: ${value}`);
  }

  private convertResolutionToBinance(resolution: BarResolution): string {
    const map: Record<BarResolution, string> = {
      '1m': '1m',
      '5m': '5m',
      '15m': '15m',
      '30m': '30m',
      '1h': '1h',
      '4h': '4h',
      '1D': '1d',
    };
    return map[resolution] || '1h';
  }
}

// Export singleton instance
export const externalDataService = new ExternalDataService();

// Export class for testing
export { ExternalDataService };

// Export types
export type { O2Environment };
