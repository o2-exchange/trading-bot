/**
 * Paper Trading Service
 * Simulates order execution and position management for paper trading mode
 */

import {
  PaperTradingState,
  PaperPosition,
  PaperOrder,
  PaperTrade,
  createEmptyPaperTradingState,
} from '../../types/proMode/liveTrading';
import { StrategySignal } from '../../types/proMode/customStrategy';
import { paperTradingStateOperations, SerializedPaperTradingState } from './proModeDbService';

// ============================================
// PAPER TRADING SERVICE
// ============================================

class PaperTradingService {
  private state: PaperTradingState | null = null;
  private feeRate: number = 0.001;
  private slippagePercent: number = 0.05;
  private listeners: Set<(state: PaperTradingState) => void> = new Set();
  private strategyId: string | undefined;
  private autoSaveEnabled: boolean = true;
  private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Initialize paper trading with starting capital
   */
  initialize(initialCapital: number, feeRate: number = 0.001, slippagePercent: number = 0.05, strategyId?: string): void {
    this.state = createEmptyPaperTradingState(initialCapital);
    this.feeRate = feeRate;
    this.slippagePercent = slippagePercent / 100; // Convert from percent to decimal
    this.strategyId = strategyId;
    console.log(`[PaperTradingService] Initialized with $${initialCapital} capital, ${feeRate * 100}% fee, ${slippagePercent}% slippage`);
    this.notifyListeners();
    this.saveStateDebounced();
  }

  /**
   * Load saved state from IndexedDB
   * Returns true if state was restored, false if starting fresh
   */
  async loadSavedState(): Promise<boolean> {
    try {
      const savedState = await paperTradingStateOperations.get('current');
      if (savedState) {
        this.restoreFromSerialized(savedState);
        console.log('[PaperTradingService] Restored saved state from IndexedDB');
        return true;
      }
    } catch (error) {
      console.warn('[PaperTradingService] Failed to load saved state:', error);
    }
    return false;
  }

  /**
   * Save current state to IndexedDB
   */
  async saveState(): Promise<void> {
    if (!this.state) return;

    try {
      const serialized = this.serializeState();
      await paperTradingStateOperations.save(serialized);
      console.log('[PaperTradingService] State saved to IndexedDB');
    } catch (error) {
      console.error('[PaperTradingService] Failed to save state:', error);
    }
  }

  /**
   * Debounced save to avoid too many writes
   */
  private saveStateDebounced(): void {
    if (!this.autoSaveEnabled) return;

    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }

    this.saveDebounceTimer = setTimeout(() => {
      this.saveState();
      this.saveDebounceTimer = null;
    }, 1000); // Save after 1 second of inactivity
  }

  /**
   * Serialize state for storage (convert Map to array)
   */
  private serializeState(): SerializedPaperTradingState {
    if (!this.state) throw new Error('No state to serialize');

    return {
      id: 'current',
      strategyId: this.strategyId,
      initialCapital: this.state.initialCapital,
      currentCapital: this.state.currentCapital,
      cash: this.state.cash,
      positions: Array.from(this.state.positions.values()),
      openOrders: this.state.openOrders,
      orderHistory: this.state.orderHistory,
      tradeHistory: this.state.tradeHistory,
      totalPnl: this.state.totalPnl,
      totalPnlPercent: this.state.totalPnlPercent,
      totalFees: this.state.totalFees,
      feeRate: this.feeRate,
      slippagePercent: this.slippagePercent * 100, // Convert back to percent
      startedAt: this.state.startedAt,
      lastUpdatedAt: this.state.lastUpdatedAt,
    };
  }

  /**
   * Restore state from serialized data
   */
  private restoreFromSerialized(saved: SerializedPaperTradingState): void {
    // Convert positions array back to Map
    const positionsMap = new Map<string, PaperPosition>();
    for (const position of saved.positions) {
      positionsMap.set(position.marketId, position);
    }

    this.state = {
      mode: 'paper',
      initialCapital: saved.initialCapital,
      currentCapital: saved.currentCapital,
      cash: saved.cash,
      positions: positionsMap,
      openOrders: saved.openOrders,
      orderHistory: saved.orderHistory,
      tradeHistory: saved.tradeHistory,
      totalPnl: saved.totalPnl,
      totalPnlPercent: saved.totalPnlPercent,
      totalFees: saved.totalFees,
      startedAt: saved.startedAt,
      lastUpdatedAt: saved.lastUpdatedAt,
    };

    this.feeRate = saved.feeRate;
    this.slippagePercent = saved.slippagePercent / 100; // Convert from percent to decimal
    this.strategyId = saved.strategyId;

    this.notifyListeners();
  }

  /**
   * Clear saved state from IndexedDB
   */
  async clearSavedState(): Promise<void> {
    try {
      await paperTradingStateOperations.delete('current');
      console.log('[PaperTradingService] Cleared saved state from IndexedDB');
    } catch (error) {
      console.error('[PaperTradingService] Failed to clear saved state:', error);
    }
  }

  /**
   * Enable or disable auto-save
   */
  setAutoSave(enabled: boolean): void {
    this.autoSaveEnabled = enabled;
    if (!enabled && this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
  }

  /**
   * Get current state
   */
  getState(): PaperTradingState | null {
    return this.state;
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: (state: PaperTradingState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    if (this.state) {
      this.listeners.forEach(listener => listener(this.state!));
      // Auto-save on state changes
      this.saveStateDebounced();
    }
  }

  /**
   * Process a strategy signal and create/fill orders
   */
  processSignal(
    signal: StrategySignal,
    marketId: string,
    currentPrice: number,
    strategyId: string
  ): PaperOrder | null {
    if (!this.state) {
      console.error('[PaperTradingService] Not initialized');
      return null;
    }

    console.log(`[PaperTradingService] Processing signal: ${signal.type} ${signal.quantity} @ ${currentPrice}`);

    // Create order from signal
    const order: PaperOrder = {
      id: crypto.randomUUID(),
      strategyId,
      marketId,
      side: signal.type === 'buy' ? 'buy' : 'sell',
      orderType: signal.orderType,
      price: signal.price,
      stopPrice: signal.stopPrice,
      quantity: signal.quantity,
      filledQuantity: 0,
      status: 'pending',
      createdAt: Date.now(),
      reason: signal.reason,
    };

    // For market orders, fill immediately
    if (order.orderType === 'market') {
      return this.fillOrder(order, currentPrice);
    }

    // For limit/stop orders, add to open orders
    order.status = 'open';
    this.state.openOrders.push(order);
    this.state.lastUpdatedAt = Date.now();
    this.notifyListeners();

    return order;
  }

  /**
   * Fill an order at a given price
   */
  private fillOrder(order: PaperOrder, fillPrice: number): PaperOrder {
    if (!this.state) return order;

    // Apply slippage
    const slippageAmount = fillPrice * this.slippagePercent;
    const actualFillPrice = order.side === 'buy'
      ? fillPrice + slippageAmount  // Buying higher due to slippage
      : fillPrice - slippageAmount; // Selling lower due to slippage

    const orderValue = actualFillPrice * order.quantity;
    const fee = orderValue * this.feeRate;

    // Check if we have enough cash for buy orders
    if (order.side === 'buy' && (orderValue + fee) > this.state.cash) {
      console.warn(`[PaperTradingService] Insufficient funds: need $${orderValue + fee}, have $${this.state.cash}`);
      order.status = 'rejected';
      order.reason = 'Insufficient funds';
      this.state.orderHistory.push(order);
      this.notifyListeners();
      return order;
    }

    // Update order
    order.filledQuantity = order.quantity;
    order.fillPrice = actualFillPrice;
    order.filledAt = Date.now();
    order.status = 'filled';

    // Create trade record
    const trade = this.createTrade(order, actualFillPrice, fee, slippageAmount);

    // Update position
    this.updatePosition(order.marketId, order.side, order.quantity, actualFillPrice, trade);

    // Update cash
    if (order.side === 'buy') {
      this.state.cash -= (orderValue + fee);
    } else {
      this.state.cash += (orderValue - fee);
    }

    // Update totals
    this.state.totalFees += fee;
    this.state.lastUpdatedAt = Date.now();

    // Move to order history
    this.state.orderHistory.push(order);

    // Remove from open orders if it was there
    const openIndex = this.state.openOrders.findIndex(o => o.id === order.id);
    if (openIndex >= 0) {
      this.state.openOrders.splice(openIndex, 1);
    }

    console.log(`[PaperTradingService] Order filled: ${order.side} ${order.quantity} @ $${actualFillPrice.toFixed(2)} (fee: $${fee.toFixed(2)})`);

    this.recalculateTotals();
    this.notifyListeners();

    return order;
  }

  /**
   * Create a trade record from a filled order
   */
  private createTrade(
    order: PaperOrder,
    fillPrice: number,
    fee: number,
    slippage: number
  ): PaperTrade {
    const trade: PaperTrade = {
      id: crypto.randomUUID(),
      strategyId: order.strategyId,
      orderId: order.id,
      marketId: order.marketId,
      side: order.side,
      price: fillPrice,
      quantity: order.quantity,
      fee,
      slippage: Math.abs(slippage * order.quantity),
      timestamp: Date.now(),
    };

    this.state!.tradeHistory.push(trade);

    return trade;
  }

  /**
   * Update position based on trade
   */
  private updatePosition(
    marketId: string,
    side: 'buy' | 'sell',
    quantity: number,
    price: number,
    trade: PaperTrade
  ): void {
    if (!this.state) return;

    const existingPosition = this.state.positions.get(marketId);

    if (!existingPosition) {
      // Opening new position
      if (side === 'buy') {
        const newPosition: PaperPosition = {
          id: crypto.randomUUID(),
          marketId,
          side: 'long',
          quantity,
          averageEntryPrice: price,
          currentPrice: price,
          unrealizedPnl: 0,
          unrealizedPnlPercent: 0,
          openedAt: Date.now(),
        };
        this.state.positions.set(marketId, newPosition);
        console.log(`[PaperTradingService] Opened long position: ${quantity} @ $${price.toFixed(2)}`);
      } else {
        // Short selling (opening short position)
        const newPosition: PaperPosition = {
          id: crypto.randomUUID(),
          marketId,
          side: 'short',
          quantity,
          averageEntryPrice: price,
          currentPrice: price,
          unrealizedPnl: 0,
          unrealizedPnlPercent: 0,
          openedAt: Date.now(),
        };
        this.state.positions.set(marketId, newPosition);
        console.log(`[PaperTradingService] Opened short position: ${quantity} @ $${price.toFixed(2)}`);
      }
    } else {
      // Modifying existing position
      if (existingPosition.side === 'long') {
        if (side === 'buy') {
          // Adding to long position
          const totalCost = existingPosition.averageEntryPrice * existingPosition.quantity + price * quantity;
          const totalQuantity = existingPosition.quantity + quantity;
          existingPosition.averageEntryPrice = totalCost / totalQuantity;
          existingPosition.quantity = totalQuantity;
          console.log(`[PaperTradingService] Added to long: now ${totalQuantity} @ avg $${existingPosition.averageEntryPrice.toFixed(2)}`);
        } else {
          // Closing long position (selling)
          const pnl = (price - existingPosition.averageEntryPrice) * quantity;
          trade.pnl = pnl;
          trade.pnlPercent = (pnl / (existingPosition.averageEntryPrice * quantity)) * 100;

          if (quantity >= existingPosition.quantity) {
            // Fully closing
            this.state.positions.delete(marketId);
            console.log(`[PaperTradingService] Closed long position: PnL $${pnl.toFixed(2)}`);
          } else {
            // Partially closing
            existingPosition.quantity -= quantity;
            console.log(`[PaperTradingService] Partially closed long: remaining ${existingPosition.quantity}, PnL $${pnl.toFixed(2)}`);
          }
        }
      } else {
        // Short position
        if (side === 'sell') {
          // Adding to short position
          const totalValue = existingPosition.averageEntryPrice * existingPosition.quantity + price * quantity;
          const totalQuantity = existingPosition.quantity + quantity;
          existingPosition.averageEntryPrice = totalValue / totalQuantity;
          existingPosition.quantity = totalQuantity;
          console.log(`[PaperTradingService] Added to short: now ${totalQuantity} @ avg $${existingPosition.averageEntryPrice.toFixed(2)}`);
        } else {
          // Closing short position (buying to cover)
          const pnl = (existingPosition.averageEntryPrice - price) * quantity;
          trade.pnl = pnl;
          trade.pnlPercent = (pnl / (existingPosition.averageEntryPrice * quantity)) * 100;

          if (quantity >= existingPosition.quantity) {
            // Fully closing
            this.state.positions.delete(marketId);
            console.log(`[PaperTradingService] Closed short position: PnL $${pnl.toFixed(2)}`);
          } else {
            // Partially closing
            existingPosition.quantity -= quantity;
            console.log(`[PaperTradingService] Partially closed short: remaining ${existingPosition.quantity}, PnL $${pnl.toFixed(2)}`);
          }
        }
      }
    }
  }

  /**
   * Update current prices for all positions
   */
  updatePrices(priceMap: Map<string, number>): void {
    if (!this.state) return;

    let positionsUpdated = false;

    for (const [marketId, position] of this.state.positions) {
      const currentPrice = priceMap.get(marketId);
      if (currentPrice !== undefined) {
        position.currentPrice = currentPrice;

        if (position.side === 'long') {
          position.unrealizedPnl = (currentPrice - position.averageEntryPrice) * position.quantity;
        } else {
          position.unrealizedPnl = (position.averageEntryPrice - currentPrice) * position.quantity;
        }

        position.unrealizedPnlPercent = (position.unrealizedPnl / (position.averageEntryPrice * position.quantity)) * 100;
        positionsUpdated = true;
      }
    }

    if (positionsUpdated) {
      this.recalculateTotals();
      this.notifyListeners();
    }
  }

  /**
   * Update price for a single market
   */
  updatePrice(marketId: string, currentPrice: number): void {
    this.updatePrices(new Map([[marketId, currentPrice]]));
  }

  /**
   * Check and fill limit/stop orders
   */
  checkOpenOrders(marketId: string, currentPrice: number, highPrice: number, lowPrice: number): void {
    if (!this.state) return;

    const ordersToFill: { order: PaperOrder; fillPrice: number }[] = [];

    for (const order of this.state.openOrders) {
      if (order.marketId !== marketId || order.status !== 'open') continue;

      if (order.orderType === 'limit') {
        // Limit buy: fill if price drops to or below limit
        if (order.side === 'buy' && order.price && lowPrice <= order.price) {
          ordersToFill.push({ order, fillPrice: order.price });
        }
        // Limit sell: fill if price rises to or above limit
        if (order.side === 'sell' && order.price && highPrice >= order.price) {
          ordersToFill.push({ order, fillPrice: order.price });
        }
      } else if (order.orderType === 'stop') {
        // Stop buy: trigger when price rises to stop price
        if (order.side === 'buy' && order.stopPrice && highPrice >= order.stopPrice) {
          ordersToFill.push({ order, fillPrice: currentPrice });
        }
        // Stop sell: trigger when price drops to stop price
        if (order.side === 'sell' && order.stopPrice && lowPrice <= order.stopPrice) {
          ordersToFill.push({ order, fillPrice: currentPrice });
        }
      }
    }

    // Fill triggered orders
    for (const { order, fillPrice } of ordersToFill) {
      this.fillOrder(order, fillPrice);
    }
  }

  /**
   * Cancel an open order
   */
  cancelOrder(orderId: string): boolean {
    if (!this.state) return false;

    const index = this.state.openOrders.findIndex(o => o.id === orderId);
    if (index < 0) return false;

    const order = this.state.openOrders[index];
    order.status = 'cancelled';

    this.state.openOrders.splice(index, 1);
    this.state.orderHistory.push(order);
    this.state.lastUpdatedAt = Date.now();

    console.log(`[PaperTradingService] Cancelled order ${orderId}`);
    this.notifyListeners();

    return true;
  }

  /**
   * Cancel all open orders for a market
   */
  cancelAllOrders(marketId?: string): number {
    if (!this.state) return 0;

    let cancelledCount = 0;
    const ordersToCancel = marketId
      ? this.state.openOrders.filter(o => o.marketId === marketId)
      : [...this.state.openOrders];

    for (const order of ordersToCancel) {
      if (this.cancelOrder(order.id)) {
        cancelledCount++;
      }
    }

    return cancelledCount;
  }

  /**
   * Close all positions at current prices
   */
  closeAllPositions(priceMap: Map<string, number>): void {
    if (!this.state) return;

    for (const [marketId, position] of this.state.positions) {
      const currentPrice = priceMap.get(marketId);
      if (!currentPrice) {
        console.warn(`[PaperTradingService] No price for ${marketId}, skipping close`);
        continue;
      }

      // Create closing signal
      const signal: StrategySignal = {
        type: position.side === 'long' ? 'sell' : 'buy',
        quantity: position.quantity,
        orderType: 'market',
        reason: 'Emergency close all positions',
        timestamp: Date.now(),
      };

      this.processSignal(signal, marketId, currentPrice, 'system');
    }
  }

  /**
   * Recalculate total PnL and current capital
   */
  private recalculateTotals(): void {
    if (!this.state) return;

    // Calculate realized PnL from trade history
    let realizedPnl = 0;
    for (const trade of this.state.tradeHistory) {
      if (trade.pnl !== undefined) {
        realizedPnl += trade.pnl;
      }
    }

    // Calculate unrealized PnL from open positions
    let unrealizedPnl = 0;
    let positionValue = 0;
    for (const position of this.state.positions.values()) {
      unrealizedPnl += position.unrealizedPnl;
      positionValue += position.currentPrice * position.quantity;
    }

    this.state.totalPnl = realizedPnl + unrealizedPnl;
    this.state.totalPnlPercent = (this.state.totalPnl / this.state.initialCapital) * 100;
    this.state.currentCapital = this.state.cash + positionValue;
  }

  /**
   * Get position for a market
   */
  getPosition(marketId: string): PaperPosition | null {
    return this.state?.positions.get(marketId) || null;
  }

  /**
   * Get all positions
   */
  getAllPositions(): PaperPosition[] {
    if (!this.state) return [];
    return Array.from(this.state.positions.values());
  }

  /**
   * Get trade history
   */
  getTradeHistory(): PaperTrade[] {
    return this.state?.tradeHistory || [];
  }

  /**
   * Get order history
   */
  getOrderHistory(): PaperOrder[] {
    return this.state?.orderHistory || [];
  }

  /**
   * Reset paper trading state
   */
  reset(): void {
    if (this.state) {
      const initialCapital = this.state.initialCapital;
      this.state = createEmptyPaperTradingState(initialCapital);
      console.log('[PaperTradingService] Reset to initial state');
      this.notifyListeners();
    }
  }

  /**
   * Clear all state (including saved state)
   */
  clear(): void {
    this.state = null;
    this.strategyId = undefined;
    this.listeners.clear();
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
    // Clear saved state asynchronously
    this.clearSavedState().catch(() => {});
    console.log('[PaperTradingService] Cleared');
  }

  /**
   * Check if there is saved state available
   */
  async hasSavedState(): Promise<boolean> {
    try {
      const saved = await paperTradingStateOperations.get('current');
      return saved !== undefined;
    } catch {
      return false;
    }
  }
}

// Export singleton
export const paperTradingService = new PaperTradingService();

// Export class for testing
export { PaperTradingService };
