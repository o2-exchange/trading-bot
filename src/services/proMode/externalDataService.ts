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
  type: 'o2-api' | 'binance' | 'pyth' | 'coingecko' | 'csv-upload';
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

class ExternalDataService {
  private readonly BINANCE_API = 'https://api.binance.com';
  private readonly COINGECKO_API = 'https://api.coingecko.com/api/v3';

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
   */
  async fetchO2Bars(marketId: string, options: FetchOptions): Promise<BarData[]> {
    try {
      const resolution = this.convertResolutionToO2(options.resolution);
      const url = new URL('/v1/bars', 'https://api.o2.xyz');
      url.searchParams.set('market_id', marketId);
      url.searchParams.set('resolution', resolution);
      url.searchParams.set('start_time', Math.floor(options.startDate / 1000).toString());
      url.searchParams.set('end_time', Math.floor(options.endDate / 1000).toString());

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`O2 API error: ${response.status}`);
      }

      const data = await response.json();

      return data.bars.map((bar: any) => ({
        timestamp: bar.timestamp * 1000,
        open: parseFloat(bar.open),
        high: parseFloat(bar.high),
        low: parseFloat(bar.low),
        close: parseFloat(bar.close),
        volume: parseFloat(bar.volume || '0'),
      }));
    } catch (error) {
      console.error('Failed to fetch O2 bars:', error);
      return [];
    }
  }

  /**
   * Fetch klines from Binance API
   */
  async fetchBinanceKlines(symbol: string, options: FetchOptions): Promise<BarData[]> {
    try {
      const interval = this.convertResolutionToBinance(options.resolution);
      const bars: BarData[] = [];

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

        const response = await fetch(url.toString());
        if (!response.ok) {
          throw new Error(`Binance API error: ${response.status}`);
        }

        const data = await response.json();

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

      return bars;
    } catch (error) {
      console.error('Failed to fetch Binance klines:', error);
      return [];
    }
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

  private convertResolutionToO2(resolution: BarResolution): string {
    const map: Record<BarResolution, string> = {
      '1m': '1',
      '5m': '5',
      '15m': '15',
      '1h': '60',
      '4h': '240',
      '1D': '1440',
    };
    return map[resolution] || '60';
  }

  private convertResolutionToBinance(resolution: BarResolution): string {
    const map: Record<BarResolution, string> = {
      '1m': '1m',
      '5m': '5m',
      '15m': '15m',
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
