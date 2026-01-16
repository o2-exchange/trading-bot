/**
 * Live Strategy Runner
 * Coordinates strategy execution with paper/live trading and risk management
 */

import {
  LiveStrategyConfig,
  LiveStrategyState,
  LiveStrategyStatus,
  TradingMode,
  RiskLimits,
  LiveBar,
  LivePosition,
  LiveOrder,
  createEmptyRiskStatus,
  createEmptyPaperTradingState,
} from '../../types/proMode/liveTrading';
import { CustomStrategy, StrategySignal } from '../../types/proMode/customStrategy';
import { paperTradingService } from './paperTradingService';
import { riskManager } from './riskManager';
import { strategyOperations } from './proModeDbService';
import { liveOrderExecutor } from './liveOrderExecutor';

// ============================================
// LIVE STRATEGY RUNNER
// ============================================

interface StrategyExecutionResult {
  signals: StrategySignal[];
  error?: string;
}

type StateChangeListener = (state: LiveStrategyState) => void;

class LiveStrategyRunner {
  private state: LiveStrategyState | null = null;
  private strategy: CustomStrategy | null = null;
  private worker: Worker | null = null;
  private isInitialized: boolean = false;
  private listeners: Set<StateChangeListener> = new Set();
  private barQueue: LiveBar[] = [];
  private isProcessingBar: boolean = false;

  /**
   * Initialize the runner with configuration
   */
  async initialize(config: LiveStrategyConfig): Promise<void> {
    console.log('[LiveStrategyRunner] Initializing with config:', config);

    // Load strategy
    this.strategy = await strategyOperations.getById(config.strategyId) || null;
    if (!this.strategy) {
      throw new Error(`Strategy ${config.strategyId} not found`);
    }

    // Initialize state
    this.state = {
      config,
      status: 'idle',
      riskStatus: createEmptyRiskStatus(config.initialCapital),
      barsProcessed: 0,
      signalsGenerated: 0,
      ordersPlaced: 0,
      tradesExecuted: 0,
    };

    // Initialize paper trading if in paper mode
    if (config.tradingMode === 'paper') {
      paperTradingService.initialize(
        config.initialCapital,
        config.feeRate,
        config.slippagePercent
      );
      this.state.paperState = paperTradingService.getState() || undefined;

      // Subscribe to paper trading updates
      paperTradingService.subscribe((paperState) => {
        if (this.state) {
          this.state.paperState = paperState;
          this.notifyListeners();
        }
      });
    } else if (config.tradingMode === 'live') {
      // Verify active trading session before allowing live trading
      const hasSession = await liveOrderExecutor.hasActiveSession();
      if (!hasSession) {
        throw new Error('No active trading session. Please connect wallet and create a session first.');
      }

      // Subscribe to live order executor updates
      liveOrderExecutor.subscribe((positions, orders) => {
        if (this.state) {
          this.state.livePositions = positions;
          this.state.liveOrders = orders;
          this.notifyListeners();
        }
      });

      console.log('[LiveStrategyRunner] Live trading mode initialized');
    }

    // Initialize risk manager
    riskManager.initialize(config.initialCapital, config.riskLimits);

    // Subscribe to risk status updates
    riskManager.subscribe((riskStatus) => {
      if (this.state) {
        this.state.riskStatus = riskStatus;
        this.notifyListeners();
      }
    });

    // Initialize Pyodide worker
    await this.initializeWorker();

    this.isInitialized = true;
    this.notifyListeners();

    console.log('[LiveStrategyRunner] Initialized successfully');
  }

  /**
   * Initialize the Pyodide worker
   */
  private async initializeWorker(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.worker = new Worker(
        new URL('../../workers/pyodide-classic.worker.js', import.meta.url),
        { type: 'module' }
      );

      const initTimeout = setTimeout(() => {
        reject(new Error('Worker initialization timeout'));
      }, 60000);

      this.worker.onmessage = (event) => {
        const { type, error } = event.data;

        if (type === 'pyodide_ready') {
          clearTimeout(initTimeout);
          console.log('[LiveStrategyRunner] Worker ready');
          resolve();
        } else if (type === 'error' && !this.isInitialized) {
          clearTimeout(initTimeout);
          reject(new Error(error || 'Worker initialization failed'));
        }
      };

      this.worker.onerror = (error) => {
        clearTimeout(initTimeout);
        reject(error);
      };
    });
  }

  /**
   * Get current state
   */
  getState(): LiveStrategyState | null {
    return this.state;
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    if (this.state) {
      this.listeners.forEach(listener => listener(this.state!));
    }
  }

  /**
   * Start strategy execution
   */
  async start(): Promise<void> {
    if (!this.state || !this.strategy || !this.worker) {
      throw new Error('Runner not initialized');
    }

    if (this.state.status === 'running') {
      console.warn('[LiveStrategyRunner] Already running');
      return;
    }

    console.log('[LiveStrategyRunner] Starting strategy execution');

    this.state.status = 'starting';
    this.state.startedAt = Date.now();
    this.notifyListeners();

    // Initialize strategy in worker
    try {
      await this.initializeStrategy();
      this.state.status = 'running';
      console.log('[LiveStrategyRunner] Strategy started successfully');
    } catch (error) {
      this.state.status = 'error';
      this.state.error = error instanceof Error ? error.message : 'Failed to start strategy';
      console.error('[LiveStrategyRunner] Failed to start:', error);
    }

    this.notifyListeners();
  }

  /**
   * Initialize strategy in worker
   */
  private initializeStrategy(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.worker || !this.strategy) {
        reject(new Error('Worker or strategy not available'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Strategy initialization timeout'));
      }, 30000);

      const messageHandler = (event: MessageEvent) => {
        const { type, error } = event.data;

        if (type === 'strategy_init_complete') {
          clearTimeout(timeout);
          this.worker!.removeEventListener('message', messageHandler);
          resolve();
        } else if (type === 'strategy_init_error' || (type === 'error' && error)) {
          clearTimeout(timeout);
          this.worker!.removeEventListener('message', messageHandler);
          reject(new Error(error || 'Strategy initialization failed'));
        }
      };

      this.worker.addEventListener('message', messageHandler);

      this.worker.postMessage({
        type: 'init_strategy',
        code: this.strategy.pythonCode,
        params: this.strategy.configValues,
      });
    });
  }

  /**
   * Process a new bar
   */
  async processBar(bar: LiveBar): Promise<void> {
    if (!this.state || this.state.status !== 'running') {
      return;
    }

    // Check if trading is halted
    if (this.state.riskStatus.isHalted) {
      console.warn('[LiveStrategyRunner] Trading halted, skipping bar');
      return;
    }

    // Queue bar for processing
    this.barQueue.push(bar);
    await this.processBarQueue();
  }

  /**
   * Process queued bars
   */
  private async processBarQueue(): Promise<void> {
    if (this.isProcessingBar || this.barQueue.length === 0) {
      return;
    }

    this.isProcessingBar = true;

    while (this.barQueue.length > 0) {
      const bar = this.barQueue.shift()!;

      try {
        await this.executeSingleBar(bar);
      } catch (error) {
        console.error('[LiveStrategyRunner] Error processing bar:', error);
      }
    }

    this.isProcessingBar = false;
  }

  /**
   * Execute strategy on a single bar
   */
  private async executeSingleBar(bar: LiveBar): Promise<void> {
    if (!this.state || !this.worker) return;

    // Get current position (from paper trading or live)
    let position: any = null;
    if (this.state.config.tradingMode === 'paper') {
      position = paperTradingService.getPosition(this.state.config.marketId);
    } else if (this.state.config.tradingMode === 'live') {
      const livePosition = liveOrderExecutor.getPosition(this.state.config.marketId);
      if (livePosition) {
        position = {
          side: livePosition.side,
          quantity: livePosition.quantity,
          averageEntryPrice: livePosition.averageEntryPrice,
          unrealizedPnl: livePosition.unrealizedPnl,
        };
      }
    }

    // Execute strategy
    const result = await this.executeOnBar(bar, position);

    if (result.error) {
      console.error('[LiveStrategyRunner] Strategy error:', result.error);
      return;
    }

    this.state.barsProcessed++;
    this.state.lastBarTimestamp = bar.timestamp;

    // Process signals
    for (const signal of result.signals) {
      await this.processSignal(signal, bar.close);
    }

    this.state.signalsGenerated += result.signals.length;

    // Update risk manager
    if (this.state.config.tradingMode === 'paper' && this.state.paperState) {
      const positions = paperTradingService.getAllPositions();
      riskManager.updateEquity(this.state.paperState.currentCapital, positions);
    } else if (this.state.config.tradingMode === 'live') {
      // For live trading, use live positions for risk calculation
      const livePositions = liveOrderExecutor.getPositions();
      const totalPnl = livePositions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
      const currentEquity = this.state.config.initialCapital + totalPnl;

      // Convert live positions to paper position format for risk manager
      const positionsForRisk = livePositions.map(p => ({
        id: p.marketId,
        marketId: p.marketId,
        side: p.side,
        quantity: p.quantity,
        averageEntryPrice: p.averageEntryPrice,
        currentPrice: p.currentPrice,
        unrealizedPnl: p.unrealizedPnl,
        unrealizedPnlPercent: p.unrealizedPnlPercent,
        openedAt: p.openedAt,
      }));

      riskManager.updateEquity(currentEquity, positionsForRisk);

      // Update live position prices
      liveOrderExecutor.updatePositionPnl(this.state.config.marketId, bar.close);
    }

    this.notifyListeners();
  }

  /**
   * Execute strategy on bar in worker
   */
  private executeOnBar(bar: LiveBar, position: any): Promise<StrategyExecutionResult> {
    return new Promise((resolve) => {
      if (!this.worker) {
        resolve({ signals: [], error: 'Worker not available' });
        return;
      }

      const timeout = setTimeout(() => {
        resolve({ signals: [], error: 'Strategy execution timeout' });
      }, 10000);

      const messageHandler = (event: MessageEvent) => {
        const { type, signals, error } = event.data;

        if (type === 'bar_result' || type === 'signals') {
          clearTimeout(timeout);
          this.worker!.removeEventListener('message', messageHandler);
          resolve({ signals: signals || [], error });
        } else if (type === 'error') {
          clearTimeout(timeout);
          this.worker!.removeEventListener('message', messageHandler);
          resolve({ signals: [], error });
        }
      };

      this.worker.addEventListener('message', messageHandler);

      // Convert position for Python
      const positionDict = position ? {
        side: position.side,
        quantity: position.quantity,
        avg_price: position.averageEntryPrice,
        unrealized_pnl: position.unrealizedPnl,
      } : null;

      this.worker.postMessage({
        type: 'process_bar',
        bar: {
          timestamp: bar.timestamp,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
        },
        position: positionDict,
        orders: [], // TODO: Pass open orders
      });
    });
  }

  /**
   * Process a signal from the strategy
   */
  private async processSignal(signal: StrategySignal, currentPrice: number): Promise<void> {
    if (!this.state) return;

    // Filter out cancel signals - they're not executable orders
    if (signal.type === 'cancel') {
      console.log('[LiveStrategyRunner] Cancel signal received - skipping (not implemented)');
      return;
    }

    console.log('[LiveStrategyRunner] Processing signal:', signal);

    // Get positions based on trading mode
    const positions = this.state.config.tradingMode === 'paper'
      ? paperTradingService.getAllPositions()
      : liveOrderExecutor.getPositions().map(p => ({
          id: p.marketId,
          marketId: p.marketId,
          side: p.side,
          quantity: p.quantity,
          averageEntryPrice: p.averageEntryPrice,
          currentPrice: p.currentPrice,
          unrealizedPnl: p.unrealizedPnl,
          unrealizedPnlPercent: p.unrealizedPnlPercent,
          openedAt: p.openedAt,
        }));

    // Check risk limits before placing order
    const riskCheck = riskManager.checkOrder({
      side: signal.type === 'buy' ? 'buy' : 'sell',
      quantity: signal.quantity,
      price: signal.price || currentPrice,
      marketId: this.state.config.marketId,
    }, positions);

    if (!riskCheck.allowed) {
      console.warn('[LiveStrategyRunner] Order blocked by risk manager:', riskCheck.violations);
      return;
    }

    // Execute order based on trading mode
    if (this.state.config.tradingMode === 'paper') {
      const order = paperTradingService.processSignal(
        signal,
        this.state.config.marketId,
        currentPrice,
        this.state.config.strategyId
      );

      if (order) {
        this.state.ordersPlaced++;
        if (order.status === 'filled') {
          this.state.tradesExecuted++;
        }
        riskManager.recordOrder();
      }
    } else if (this.state.config.tradingMode === 'live') {
      // Live order execution via O2 API
      const result = await liveOrderExecutor.processSignal(
        signal,
        this.state.config.marketId,
        currentPrice
      );

      if (result.success) {
        this.state.ordersPlaced++;
        if (result.order?.status === 'filled') {
          this.state.tradesExecuted++;
        }
        riskManager.recordOrder();
        console.log('[LiveStrategyRunner] Live order placed:', result.order?.orderId);
      } else {
        console.error('[LiveStrategyRunner] Live order failed:', result.error);
        // Don't halt trading on single order failure, but log it
      }
    }

    this.notifyListeners();
  }

  /**
   * Pause strategy execution
   */
  pause(): void {
    if (!this.state || this.state.status !== 'running') return;

    console.log('[LiveStrategyRunner] Pausing strategy');
    this.state.status = 'paused';
    this.notifyListeners();
  }

  /**
   * Resume strategy execution
   */
  resume(): void {
    if (!this.state || this.state.status !== 'paused') return;

    console.log('[LiveStrategyRunner] Resuming strategy');
    this.state.status = 'running';
    this.notifyListeners();
  }

  /**
   * Stop strategy execution
   */
  async stop(): Promise<void> {
    if (!this.state) return;

    console.log('[LiveStrategyRunner] Stopping strategy');
    this.state.status = 'stopping';
    this.notifyListeners();

    // Cancel all open orders
    if (this.state.config.tradingMode === 'paper') {
      const cancelled = paperTradingService.cancelAllOrders();
      console.log(`[LiveStrategyRunner] Cancelled ${cancelled} paper orders`);
    } else if (this.state.config.tradingMode === 'live') {
      const result = await liveOrderExecutor.cancelAllOrders();
      console.log(`[LiveStrategyRunner] Cancelled ${result.cancelled} live orders, ${result.failed} failed`);
    }

    this.state.status = 'stopped';
    this.state.stoppedAt = Date.now();
    this.notifyListeners();
  }

  /**
   * Emergency stop - close all positions and halt
   */
  async emergencyStop(): Promise<void> {
    if (!this.state) return;

    console.error('[LiveStrategyRunner] EMERGENCY STOP TRIGGERED');
    this.state.status = 'stopping';
    this.notifyListeners();

    // Halt risk manager
    riskManager.emergencyStop();

    // Close all positions
    if (this.state.config.tradingMode === 'paper') {
      const currentPrice = this.state.lastBarTimestamp
        ? paperTradingService.getPosition(this.state.config.marketId)?.currentPrice
        : undefined;

      if (currentPrice) {
        paperTradingService.closeAllPositions(
          new Map([[this.state.config.marketId, currentPrice]])
        );
      }
    } else if (this.state.config.tradingMode === 'live') {
      // Close real positions with market orders
      const livePosition = liveOrderExecutor.getPosition(this.state.config.marketId);
      const currentPrice = livePosition?.currentPrice;

      if (currentPrice) {
        const result = await liveOrderExecutor.closeAllPositions(
          new Map([[this.state.config.marketId, currentPrice]])
        );
        console.log(`[LiveStrategyRunner] Emergency close: ${result.closed} closed, ${result.failed} failed`);
      }
    }

    this.state.status = 'stopped';
    this.state.stoppedAt = Date.now();
    this.state.error = 'Emergency stop triggered';
    this.notifyListeners();
  }

  /**
   * Update price and check limit orders
   */
  updatePrice(price: number, high?: number, low?: number): void {
    if (!this.state) return;

    // Update paper trading positions
    if (this.state.config.tradingMode === 'paper') {
      paperTradingService.updatePrice(this.state.config.marketId, price);

      // Check limit orders
      if (high !== undefined && low !== undefined) {
        paperTradingService.checkOpenOrders(
          this.state.config.marketId,
          price,
          high,
          low
        );
      }
    } else if (this.state.config.tradingMode === 'live') {
      // Update live position prices
      liveOrderExecutor.updatePositionPnl(this.state.config.marketId, price);
    }
  }

  /**
   * Cleanup and destroy runner
   */
  destroy(): void {
    console.log('[LiveStrategyRunner] Destroying runner');

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    paperTradingService.clear();
    liveOrderExecutor.clear();
    riskManager.clear();

    this.state = null;
    this.strategy = null;
    this.isInitialized = false;
    this.barQueue = [];
    this.listeners.clear();
  }
}

// Export singleton
export const liveStrategyRunner = new LiveStrategyRunner();

// Export class for testing
export { LiveStrategyRunner };
