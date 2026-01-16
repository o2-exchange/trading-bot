/**
 * Live Order Executor
 * Executes real orders on O2 exchange for Pro Mode strategies
 */

import Decimal from 'decimal.js';
import { orderService } from '../orderService';
import { marketService } from '../marketService';
import { sessionService } from '../sessionService';
import { useWalletStore } from '../../stores/useWalletStore';
import { Market } from '../../types/market';
import { Order, OrderSide, OrderType, OrderStatus } from '../../types/order';
import { StrategySignal } from '../../types/proMode/customStrategy';
import { LivePosition, LiveOrder } from '../../types/proMode/liveTrading';

// ============================================
// TYPES
// ============================================

export interface ExecutionResult {
  success: boolean;
  order?: LiveOrder;
  error?: string;
}

// Re-export for convenience
export type { LivePosition, LiveOrder };

type OrderExecutorListener = (positions: LivePosition[], orders: LiveOrder[]) => void;

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Round down to 3 decimal places
 */
function roundDownTo3Decimals(quantity: Decimal): Decimal {
  const multiplier = new Decimal(1000);
  return quantity.mul(multiplier).floor().div(multiplier);
}

/**
 * Scale up a Decimal by decimals and truncate to precision
 */
function scaleUpAndTruncateToInt(
  amount: Decimal,
  decimals: number,
  maxPrecision: number
): Decimal {
  const priceInt = amount.mul(new Decimal(10).pow(decimals));
  const truncateFactor = new Decimal(10).pow(decimals - maxPrecision);
  return priceInt.div(truncateFactor).floor().mul(truncateFactor);
}

// ============================================
// LIVE ORDER EXECUTOR
// ============================================

class LiveOrderExecutor {
  private positions: Map<string, LivePosition> = new Map();
  private orders: LiveOrder[] = [];
  private listeners: Set<OrderExecutorListener> = new Set();
  private marketCache: Map<string, Market> = new Map();

  /**
   * Subscribe to position/order updates
   */
  subscribe(listener: OrderExecutorListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    const positions = Array.from(this.positions.values());
    this.listeners.forEach((listener) => listener(positions, this.orders));
  }

  /**
   * Get connected wallet address
   */
  private getOwnerAddress(): string | null {
    const wallet = useWalletStore.getState().connectedWallet;
    return wallet?.address || null;
  }

  /**
   * Check if user has an active trading session
   */
  async hasActiveSession(): Promise<boolean> {
    const ownerAddress = this.getOwnerAddress();
    if (!ownerAddress) return false;

    const session = await sessionService.getActiveSession(ownerAddress);
    return !!session;
  }

  /**
   * Get market info (cached)
   */
  private async getMarket(marketId: string): Promise<Market> {
    const cached = this.marketCache.get(marketId);
    if (cached) {
      return cached;
    }
    const market = await marketService.getMarket(marketId);
    if (!market) {
      throw new Error(`Market ${marketId} not found`);
    }
    this.marketCache.set(marketId, market);
    return market;
  }

  /**
   * Process a strategy signal and execute order
   */
  async processSignal(
    signal: StrategySignal,
    marketId: string,
    currentPrice: number
  ): Promise<ExecutionResult> {
    // Cancel signals are not supported for live execution
    if (signal.type === 'cancel') {
      console.log('[LiveOrderExecutor] Cancel signals not supported in live mode');
      return { success: false, error: 'Cancel signals not supported' };
    }

    const ownerAddress = this.getOwnerAddress();
    if (!ownerAddress) {
      return { success: false, error: 'No wallet connected' };
    }

    // Verify active session
    const session = await sessionService.getActiveSession(ownerAddress);
    if (!session) {
      return { success: false, error: 'No active trading session' };
    }

    try {
      const market = await this.getMarket(marketId);

      // Determine order side (signal.type is now guaranteed to be 'buy' or 'sell')
      const orderSide: OrderSide =
        signal.type === 'buy' ? OrderSide.Buy : OrderSide.Sell;

      // Determine order type
      const orderType: OrderType =
        signal.orderType === 'limit' ? OrderType.Spot : OrderType.Market;

      // Get execution price
      const price = signal.price || currentPrice;

      // Scale price and quantity for API
      const priceDecimal = new Decimal(price);
      const quantityDecimal = new Decimal(signal.quantity);

      const priceTruncated = scaleUpAndTruncateToInt(
        priceDecimal,
        market.quote.decimals,
        market.quote.max_precision
      );
      const priceScaled = priceTruncated.toFixed(0);

      const quantityRounded = roundDownTo3Decimals(quantityDecimal);
      const quantityScaled = quantityRounded
        .mul(10 ** market.base.decimals)
        .toFixed(0);

      console.log('[LiveOrderExecutor] Placing order:', {
        side: orderSide,
        type: orderType,
        priceHuman: price,
        priceScaled,
        quantityHuman: signal.quantity,
        quantityScaled,
        marketId,
      });

      // Execute order
      const order = await orderService.placeOrder(
        market,
        orderSide,
        orderType,
        priceScaled,
        quantityScaled,
        ownerAddress
      );

      // Create live order record
      const liveOrder: LiveOrder = {
        orderId: order.order_id,
        marketId,
        side: signal.type === 'buy' ? 'buy' : 'sell',
        type: signal.orderType === 'limit' ? 'limit' : 'market',
        price,
        quantity: signal.quantity,
        status: this.mapOrderStatus(order.status),
        createdAt: Date.now(),
        filledAt: order.status === OrderStatus.Filled ? Date.now() : undefined,
      };

      this.orders.push(liveOrder);

      // Update position if order filled
      if (order.status === OrderStatus.Filled) {
        // signal.type is guaranteed to be 'buy' or 'sell' here (cancel was filtered out above)
        this.updatePosition(marketId, signal.type as 'buy' | 'sell', signal.quantity, price);
      }

      this.notifyListeners();

      console.log('[LiveOrderExecutor] Order placed successfully:', order.order_id);
      return { success: true, order: liveOrder };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      console.error('[LiveOrderExecutor] Order failed:', errorMessage);

      // Record failed order
      const failedOrder: LiveOrder = {
        orderId: `failed-${Date.now()}`,
        marketId,
        side: signal.type === 'buy' ? 'buy' : 'sell',
        type: signal.orderType === 'limit' ? 'limit' : 'market',
        price: signal.price || currentPrice,
        quantity: signal.quantity,
        status: 'failed',
        createdAt: Date.now(),
        error: errorMessage,
      };

      this.orders.push(failedOrder);
      this.notifyListeners();

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Map O2 order status to LiveOrder status
   */
  private mapOrderStatus(
    status: OrderStatus
  ): 'pending' | 'filled' | 'cancelled' | 'failed' {
    switch (status) {
      case OrderStatus.Open:
      case OrderStatus.PartiallyFilled:
        return 'pending';
      case OrderStatus.Filled:
        return 'filled';
      case OrderStatus.Cancelled:
        return 'cancelled';
      default:
        return 'pending';
    }
  }

  /**
   * Update position after a fill
   */
  private updatePosition(
    marketId: string,
    side: 'buy' | 'sell',
    quantity: number,
    price: number
  ): void {
    const existing = this.positions.get(marketId);

    if (!existing) {
      // New position
      this.positions.set(marketId, {
        marketId,
        side: side === 'buy' ? 'long' : 'short',
        quantity,
        averageEntryPrice: price,
        currentPrice: price,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        openedAt: Date.now(),
      });
    } else {
      // Update existing position
      if (
        (existing.side === 'long' && side === 'buy') ||
        (existing.side === 'short' && side === 'sell')
      ) {
        // Adding to position
        const totalValue =
          existing.quantity * existing.averageEntryPrice + quantity * price;
        const newQuantity = existing.quantity + quantity;
        existing.averageEntryPrice = totalValue / newQuantity;
        existing.quantity = newQuantity;
      } else {
        // Reducing position
        existing.quantity -= quantity;

        if (existing.quantity <= 0) {
          // Position closed or reversed
          if (existing.quantity < 0) {
            // Position reversed
            existing.side = existing.side === 'long' ? 'short' : 'long';
            existing.quantity = Math.abs(existing.quantity);
            existing.averageEntryPrice = price;
            existing.openedAt = Date.now();
          } else {
            // Position closed
            this.positions.delete(marketId);
            return;
          }
        }
      }

      this.updatePositionPnl(marketId, price);
    }
  }

  /**
   * Update position unrealized P&L
   */
  updatePositionPnl(marketId: string, currentPrice: number): void {
    const position = this.positions.get(marketId);
    if (!position) return;

    position.currentPrice = currentPrice;

    const priceDiff = currentPrice - position.averageEntryPrice;
    const multiplier = position.side === 'long' ? 1 : -1;

    position.unrealizedPnl = priceDiff * position.quantity * multiplier;
    position.unrealizedPnlPercent =
      (priceDiff / position.averageEntryPrice) * 100 * multiplier;

    this.notifyListeners();
  }

  /**
   * Update all position prices
   */
  updatePrices(prices: Map<string, number>): void {
    for (const [marketId, price] of prices) {
      this.updatePositionPnl(marketId, price);
    }
  }

  /**
   * Close all positions with market orders
   */
  async closeAllPositions(
    prices: Map<string, number>
  ): Promise<{ closed: number; failed: number }> {
    const ownerAddress = this.getOwnerAddress();
    if (!ownerAddress) {
      console.error('[LiveOrderExecutor] No wallet connected');
      return { closed: 0, failed: this.positions.size };
    }

    let closed = 0;
    let failed = 0;

    for (const [marketId, position] of this.positions) {
      const currentPrice = prices.get(marketId) || position.currentPrice;

      // Create closing signal
      const signal: StrategySignal = {
        type: position.side === 'long' ? 'sell' : 'buy',
        quantity: position.quantity,
        price: currentPrice,
        orderType: 'market',
        reason: 'Emergency close',
        timestamp: Date.now(),
      };

      const result = await this.processSignal(signal, marketId, currentPrice);

      if (result.success) {
        closed++;
      } else {
        failed++;
        console.error(
          `[LiveOrderExecutor] Failed to close position for ${marketId}:`,
          result.error
        );
      }
    }

    return { closed, failed };
  }

  /**
   * Cancel all open orders
   */
  async cancelAllOrders(): Promise<{ cancelled: number; failed: number }> {
    const ownerAddress = this.getOwnerAddress();
    if (!ownerAddress) {
      return { cancelled: 0, failed: 0 };
    }

    const result = await orderService.cancelAllOpenOrders(ownerAddress);
    return result;
  }

  /**
   * Get all open positions
   */
  getPositions(): LivePosition[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get position for a specific market
   */
  getPosition(marketId: string): LivePosition | null {
    return this.positions.get(marketId) || null;
  }

  /**
   * Get order history
   */
  getOrders(): LiveOrder[] {
    return [...this.orders];
  }

  /**
   * Clear all state
   */
  clear(): void {
    this.positions.clear();
    this.orders = [];
    this.marketCache.clear();
    this.notifyListeners();
  }
}

// Export singleton
export const liveOrderExecutor = new LiveOrderExecutor();

// Export class for testing
export { LiveOrderExecutor };
