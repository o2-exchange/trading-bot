/**
 * Backtest Engine Service
 * Runs strategy simulations on historical market data
 */

import {
  BacktestConfig,
  BacktestResult,
  BacktestMetrics,
  BacktestTrade,
  EquityPoint,
  DrawdownPoint,
  BarData,
  EMPTY_BACKTEST_METRICS,
  createEmptyBacktestResult,
} from '../../types/proMode/backtest';
import {
  CustomStrategy,
  StrategySignal,
} from '../../types/proMode/customStrategy';
import { pyodideService } from './pyodideService';
import { proModeDb } from './proModeDbService';

// ============================================
// SIMULATION STATE
// ============================================

interface SimulationState {
  cash: number;
  position: {
    side: 'long' | 'short' | null;
    quantity: number;
    avgPrice: number;
    entryTimestamp: number;
  };
  equity: number;
  highWaterMark: number;
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  drawdownCurve: DrawdownPoint[];
}

// ============================================
// BACKTEST ENGINE
// ============================================

class BacktestEngine {
  private runningBacktests = new Map<string, {
    cancel: () => void;
    progress: number;
  }>();

  /**
   * Run a backtest simulation
   */
  async runBacktest(
    config: BacktestConfig,
    strategy: CustomStrategy,
    onProgress?: (progress: number) => void
  ): Promise<BacktestResult> {
    const backtestId = config.id;
    let cancelled = false;
    const startTime = Date.now();

    // Create initial result
    const result = createEmptyBacktestResult(config.id, config.strategyId, config.strategyVersionId);
    result.status = 'running';
    result.startedAt = startTime;

    // Register cancellation handler
    this.runningBacktests.set(backtestId, {
      cancel: () => { cancelled = true; },
      progress: 0,
    });

    try {
      // Initialize Pyodide
      await pyodideService.initialize();

      // Validate strategy code
      const validation = await pyodideService.validateCode(strategy.pythonCode);
      if (!validation.isValid) {
        return this.createFailedResult(result, validation.errors[0]?.message || 'Validation failed');
      }

      // Load historical data
      onProgress?.(5);
      const bars = await this.loadHistoricalData(config);

      if (bars.length === 0) {
        return this.createFailedResult(result, 'No historical data available for the selected period');
      }

      result.totalBars = bars.length;

      // Initialize simulation state
      const state: SimulationState = {
        cash: config.initialCapital,
        position: {
          side: null,
          quantity: 0,
          avgPrice: 0,
          entryTimestamp: 0,
        },
        equity: config.initialCapital,
        highWaterMark: config.initialCapital,
        trades: [],
        equityCurve: [{
          timestamp: bars[0].timestamp,
          equity: config.initialCapital,
          cash: config.initialCapital,
          positionValue: 0,
          drawdown: 0,
          drawdownPercent: 0,
        }],
        drawdownCurve: [{
          timestamp: bars[0].timestamp,
          drawdown: 0,
          drawdownPercent: 0,
          peakEquity: config.initialCapital,
          currentEquity: config.initialCapital,
        }],
      };

      // Run simulation bar by bar
      const totalBars = bars.length;
      let lastProgressUpdate = 0;

      for (let i = 0; i < totalBars; i++) {
        if (cancelled) {
          result.status = 'cancelled';
          result.statusMessage = 'Backtest cancelled by user';
          return result;
        }

        const bar = bars[i];
        const historicalBars = bars.slice(0, i + 1);

        // Execute strategy to get signals
        const { signals, error } = await pyodideService.executeStrategy(
          strategy,
          historicalBars,
          5000 // 5 second timeout per bar
        );

        if (error) {
          console.warn(`Strategy error at bar ${i}: ${error}`);
        }

        // Process signals
        if (signals && signals.length > 0) {
          for (const signal of signals) {
            this.processSignal(signal, bar, state, config);
          }
        }

        // Update equity
        this.updateEquity(bar, state);

        // Record equity and drawdown
        const drawdown = state.highWaterMark - state.equity;
        const drawdownPercent = state.highWaterMark > 0
          ? (drawdown / state.highWaterMark) * 100
          : 0;

        state.equityCurve.push({
          timestamp: bar.timestamp,
          equity: state.equity,
          cash: state.cash,
          positionValue: state.position.quantity * bar.close,
          drawdown,
          drawdownPercent,
        });

        state.drawdownCurve.push({
          timestamp: bar.timestamp,
          drawdown,
          drawdownPercent,
          peakEquity: state.highWaterMark,
          currentEquity: state.equity,
        });

        result.barsProcessed = i + 1;

        // Update progress (10% to 90% for simulation)
        const progress = 10 + Math.floor((i / totalBars) * 80);
        if (progress > lastProgressUpdate) {
          lastProgressUpdate = progress;
          result.progress = progress;
          onProgress?.(progress);

          const running = this.runningBacktests.get(backtestId);
          if (running) {
            running.progress = progress;
          }
        }
      }

      // Close any remaining position at last bar price
      const lastBar = bars[bars.length - 1];
      if (state.position.side !== null && state.position.quantity > 0) {
        this.closePosition(lastBar, state, config, 'End of backtest');
      }

      onProgress?.(95);
      result.progress = 95;

      // Calculate metrics
      const metrics = this.calculateMetrics(state, config);

      onProgress?.(100);
      result.progress = 100;

      // Populate result
      result.status = 'completed';
      result.metrics = metrics;
      result.trades = state.trades;
      result.equityCurve = state.equityCurve;
      result.drawdownCurve = state.drawdownCurve;
      result.executionTimeMs = Date.now() - startTime;
      result.completedAt = Date.now();

      // Save result to database
      await proModeDb.backtestResults.put(result);

      return result;

    } catch (error: unknown) {
      console.error('Backtest error:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      return this.createFailedResult(result, message);
    } finally {
      this.runningBacktests.delete(backtestId);
    }
  }

  cancelBacktest(backtestId: string): void {
    const running = this.runningBacktests.get(backtestId);
    if (running) {
      running.cancel();
    }
  }

  getProgress(backtestId: string): number {
    return this.runningBacktests.get(backtestId)?.progress ?? 0;
  }

  isRunning(backtestId: string): boolean {
    return this.runningBacktests.has(backtestId);
  }

  private async loadHistoricalData(config: BacktestConfig): Promise<BarData[]> {
    const marketId = config.dataSource.marketId || config.dataSource.symbol || '';
    const cached = await proModeDb.historicalDataCache
      .where('marketId')
      .equals(marketId)
      .first();

    if (cached && cached.bars) {
      return cached.bars.filter(
        bar => bar.timestamp >= config.startDate && bar.timestamp <= config.endDate
      );
    }

    return this.generateSampleData(config);
  }

  private generateSampleData(config: BacktestConfig): BarData[] {
    const bars: BarData[] = [];
    const msPerBar = this.getBarDuration(config.barResolution);
    let timestamp = config.startDate;
    let price = 100;

    while (timestamp <= config.endDate) {
      const change = (Math.random() - 0.5) * 4 + (100 - price) * 0.01;
      price = Math.max(1, price + change);

      bars.push({
        timestamp,
        open: price * (1 - Math.random() * 0.01),
        high: price * (1 + Math.random() * 0.02),
        low: price * (1 - Math.random() * 0.02),
        close: price,
        volume: Math.floor(Math.random() * 1000000) + 100000,
      });

      timestamp += msPerBar;
    }

    return bars;
  }

  private getBarDuration(resolution: string): number {
    const durations: Record<string, number> = {
      '1m': 60000, '5m': 300000, '15m': 900000,
      '1h': 3600000, '4h': 14400000, '1D': 86400000,
    };
    return durations[resolution] || 3600000;
  }

  private processSignal(
    signal: StrategySignal,
    bar: BarData,
    state: SimulationState,
    config: BacktestConfig
  ): void {
    const { type, quantity, price, orderType } = signal;

    let execPrice = price || bar.close;
    if (config.slippage.model === 'fixed' && config.slippage.fixedAmount) {
      execPrice += type === 'buy' ? config.slippage.fixedAmount : -config.slippage.fixedAmount;
    } else if (config.slippage.model === 'percentage' && config.slippage.percentage) {
      const factor = type === 'buy' ? 1 + config.slippage.percentage / 100 : 1 - config.slippage.percentage / 100;
      execPrice *= factor;
    }

    const orderValue = quantity * execPrice;
    const fee = orderValue * config.feeRate;
    const slippageAmount = Math.abs(execPrice - (price || bar.close)) * quantity;

    if (type === 'buy') {
      if (orderValue + fee > state.cash) return;

      if (state.position.side === 'short') {
        this.closePosition(bar, state, config, signal.reason || 'Signal');
      }

      if (state.position.side === null) {
        state.position = { side: 'long', quantity, avgPrice: execPrice, entryTimestamp: bar.timestamp };
      } else {
        const totalQty = state.position.quantity + quantity;
        state.position.avgPrice = (state.position.quantity * state.position.avgPrice + orderValue) / totalQty;
        state.position.quantity = totalQty;
      }

      state.cash -= orderValue + fee;
      state.trades.push({
        id: crypto.randomUUID(),
        timestamp: bar.timestamp,
        side: 'buy',
        price: execPrice,
        quantity,
        value: orderValue,
        fee,
        slippage: slippageAmount,
        signal: signal.reason || 'buy',
        indicatorValues: signal.indicatorValues,
        orderType: orderType === 'limit' ? 'limit' : 'market',
      });

    } else if (type === 'sell' || type === 'close') {
      if (state.position.side === 'long' && state.position.quantity > 0) {
        const sellQty = type === 'close' ? state.position.quantity : Math.min(quantity, state.position.quantity);
        const pnl = (execPrice - state.position.avgPrice) * sellQty - fee;
        const pnlPercent = (pnl / (state.position.avgPrice * sellQty)) * 100;

        state.trades.push({
          id: crypto.randomUUID(),
          timestamp: bar.timestamp,
          side: 'sell',
          price: execPrice,
          quantity: sellQty,
          value: sellQty * execPrice,
          fee,
          slippage: slippageAmount,
          pnl,
          pnlPercent,
          holdingPeriodMs: bar.timestamp - state.position.entryTimestamp,
          signal: signal.reason || 'sell',
          indicatorValues: signal.indicatorValues,
          orderType: orderType === 'limit' ? 'limit' : 'market',
        });

        state.cash += sellQty * execPrice - fee;
        state.position.quantity -= sellQty;

        if (state.position.quantity <= 0) {
          state.position = { side: null, quantity: 0, avgPrice: 0, entryTimestamp: 0 };
        }
      }
    }
  }

  private closePosition(bar: BarData, state: SimulationState, config: BacktestConfig, reason: string): void {
    if (state.position.side === null || state.position.quantity <= 0) return;

    const quantity = state.position.quantity;
    const execPrice = bar.close;
    const fee = quantity * execPrice * config.feeRate;
    const pnl = (execPrice - state.position.avgPrice) * quantity - fee;
    const pnlPercent = (pnl / (state.position.avgPrice * quantity)) * 100;

    state.trades.push({
      id: crypto.randomUUID(),
      timestamp: bar.timestamp,
      side: 'sell',
      price: execPrice,
      quantity,
      value: quantity * execPrice,
      fee,
      slippage: 0,
      pnl,
      pnlPercent,
      holdingPeriodMs: bar.timestamp - state.position.entryTimestamp,
      signal: reason,
      orderType: 'market',
    });

    state.cash += quantity * execPrice - fee;
    state.position = { side: null, quantity: 0, avgPrice: 0, entryTimestamp: 0 };
  }

  private updateEquity(bar: BarData, state: SimulationState): void {
    const positionValue = state.position.side ? state.position.quantity * bar.close : 0;
    state.equity = state.cash + positionValue;
    if (state.equity > state.highWaterMark) state.highWaterMark = state.equity;
  }

  private calculateMetrics(state: SimulationState, config: BacktestConfig): BacktestMetrics {
    const trades = state.trades;
    const equityCurve = state.equityCurve;
    const totalReturn = state.equity - config.initialCapital;
    const totalReturnPercent = (totalReturn / config.initialCapital) * 100;
    const days = (config.endDate - config.startDate) / 86400000;
    const years = days / 365;
    const annualizedReturn = years > 0 ? (Math.pow(state.equity / config.initialCapital, 1 / years) - 1) * 100 : totalReturnPercent;

    const dailyReturns = this.calculateDailyReturns(equityCurve);
    const volatility = this.calculateStdDev(dailyReturns) * Math.sqrt(252) * 100;
    const avgDaily = dailyReturns.length > 0 ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
    const stdDaily = this.calculateStdDev(dailyReturns);
    const sharpeRatio = stdDaily > 0 ? (avgDaily / stdDaily) * Math.sqrt(252) : 0;
    const negReturns = dailyReturns.filter(r => r < 0);
    const stdNeg = this.calculateStdDev(negReturns);
    const sortinoRatio = stdNeg > 0 ? (avgDaily / stdNeg) * Math.sqrt(252) : sharpeRatio;

    let maxDrawdown = 0, maxDrawdownPercent = 0, maxDrawdownDuration = 0, ddStart = 0;
    for (const p of state.drawdownCurve) {
      if (p.drawdown > maxDrawdown) { maxDrawdown = p.drawdown; maxDrawdownPercent = p.drawdownPercent; }
      if (p.drawdown > 0 && !ddStart) ddStart = p.timestamp;
      else if (p.drawdown === 0 && ddStart) { maxDrawdownDuration = Math.max(maxDrawdownDuration, (p.timestamp - ddStart) / 86400000); ddStart = 0; }
    }
    const calmarRatio = maxDrawdownPercent > 0 ? annualizedReturn / maxDrawdownPercent : 0;

    const closingTrades = trades.filter(t => t.pnl !== undefined);
    const winningTrades = closingTrades.filter(t => (t.pnl ?? 0) > 0);
    const losingTrades = closingTrades.filter(t => (t.pnl ?? 0) <= 0);
    const winRate = closingTrades.length > 0 ? (winningTrades.length / closingTrades.length) * 100 : 0;
    const totalWins = winningTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
    const totalLosses = Math.abs(losingTrades.reduce((s, t) => s + (t.pnl ?? 0), 0));
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : (totalWins > 0 ? 999 : 0);
    const averageWin = winningTrades.length > 0 ? totalWins / winningTrades.length : 0;
    const averageLoss = losingTrades.length > 0 ? totalLosses / losingTrades.length : 0;
    const largestWin = winningTrades.length > 0 ? Math.max(...winningTrades.map(t => t.pnl ?? 0)) : 0;
    const largestLoss = losingTrades.length > 0 ? Math.abs(Math.min(...losingTrades.map(t => t.pnl ?? 0))) : 0;
    const avgTradeReturn = closingTrades.length > 0 ? closingTrades.reduce((s, t) => s + (t.pnl ?? 0), 0) / closingTrades.length : 0;
    const avgTradeReturnPercent = closingTrades.length > 0 ? closingTrades.reduce((s, t) => s + (t.pnlPercent ?? 0), 0) / closingTrades.length : 0;
    const avgHoldingPeriodMs = closingTrades.length > 0 ? closingTrades.reduce((s, t) => s + (t.holdingPeriodMs ?? 0), 0) / closingTrades.length : 0;
    const totalVolume = trades.reduce((s, t) => s + t.value, 0);
    const totalFees = trades.reduce((s, t) => s + t.fee, 0);
    const totalSlippage = trades.reduce((s, t) => s + t.slippage, 0);

    const uniqueDays = new Set(equityCurve.map(p => Math.floor(p.timestamp / 86400000)));
    const tradingDays = uniqueDays.size;
    const profitableDays = Math.floor(tradingDays * (winRate / 100));
    const profitableDaysPercent = tradingDays > 0 ? (profitableDays / tradingDays) * 100 : 0;

    return {
      ...EMPTY_BACKTEST_METRICS,
      totalReturn, totalReturnPercent, annualizedReturn, sharpeRatio, sortinoRatio, calmarRatio,
      maxDrawdown, maxDrawdownPercent, maxDrawdownDuration, volatility,
      totalTrades: trades.length, winningTrades: winningTrades.length, losingTrades: losingTrades.length, winRate,
      profitFactor, averageWin, averageLoss, largestWin, largestLoss,
      averageTradeReturn: avgTradeReturn, averageTradeReturnPercent: avgTradeReturnPercent,
      averageHoldingPeriodMs: avgHoldingPeriodMs, tradingDays, profitableDays, profitableDaysPercent,
      totalVolume, totalFees, totalSlippage,
      expectancy: avgTradeReturn, expectancyPercent: avgTradeReturnPercent,
    };
  }

  private calculateDailyReturns(equityCurve: EquityPoint[]): number[] {
    if (equityCurve.length < 2) return [];
    const returns: number[] = [];
    let prevEquity = equityCurve[0].equity;
    let currentDay = Math.floor(equityCurve[0].timestamp / 86400000);

    for (let i = 1; i < equityCurve.length; i++) {
      const day = Math.floor(equityCurve[i].timestamp / 86400000);
      if (day > currentDay) {
        returns.push((equityCurve[i - 1].equity - prevEquity) / prevEquity);
        prevEquity = equityCurve[i - 1].equity;
        currentDay = day;
      }
    }
    if (prevEquity > 0) returns.push((equityCurve[equityCurve.length - 1].equity - prevEquity) / prevEquity);
    return returns;
  }

  private calculateStdDev(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (values.length - 1);
    return Math.sqrt(variance);
  }

  private createFailedResult(result: BacktestResult, error: string): BacktestResult {
    result.status = 'failed';
    result.errorMessage = error;
    result.completedAt = Date.now();
    return result;
  }
}

export const backtestEngine = new BacktestEngine();
export { BacktestEngine };
