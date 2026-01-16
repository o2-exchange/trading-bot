/**
 * Risk Manager Service
 * Enforces risk controls and monitors trading activity
 */

import {
  RiskLimits,
  RiskStatus,
  RiskViolation,
  RiskViolationType,
  createEmptyRiskStatus,
  DEFAULT_RISK_LIMITS,
  PaperPosition,
  PaperOrder,
} from '../../types/proMode/liveTrading';

// ============================================
// RISK MANAGER SERVICE
// ============================================

interface OrderCheckParams {
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  marketId: string;
}

interface RiskCheckResult {
  allowed: boolean;
  violations: RiskViolation[];
}

class RiskManager {
  private limits: RiskLimits = { ...DEFAULT_RISK_LIMITS };
  private status: RiskStatus;
  private initialCapital: number = 10000;
  private dailyStartEquity: number = 10000;
  private dailyStartTime: number = 0;
  private orderTimestamps: number[] = [];
  private listeners: Set<(status: RiskStatus) => void> = new Set();
  private violations: RiskViolation[] = [];

  constructor() {
    this.status = createEmptyRiskStatus(this.initialCapital);
  }

  /**
   * Initialize risk manager with capital and limits
   */
  initialize(initialCapital: number, limits?: Partial<RiskLimits>): void {
    this.initialCapital = initialCapital;
    this.limits = { ...DEFAULT_RISK_LIMITS, ...limits };
    this.status = createEmptyRiskStatus(initialCapital);
    this.dailyStartEquity = initialCapital;
    this.dailyStartTime = this.getStartOfDay();
    this.orderTimestamps = [];
    this.violations = [];

    console.log('[RiskManager] Initialized with capital:', initialCapital);
    console.log('[RiskManager] Limits:', this.limits);
    this.notifyListeners();
  }

  /**
   * Get current risk status
   */
  getStatus(): RiskStatus {
    return { ...this.status };
  }

  /**
   * Get current limits
   */
  getLimits(): RiskLimits {
    return { ...this.limits };
  }

  /**
   * Update risk limits
   */
  updateLimits(limits: Partial<RiskLimits>): void {
    this.limits = { ...this.limits, ...limits };
    console.log('[RiskManager] Limits updated:', this.limits);
    this.checkAllLimits();
  }

  /**
   * Subscribe to status changes
   */
  subscribe(listener: (status: RiskStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.status));
  }

  /**
   * Update equity and check risk limits
   */
  updateEquity(currentEquity: number, positions: PaperPosition[]): void {
    // Check if new day
    this.checkDayReset();

    // Update peak equity
    if (currentEquity > this.status.peakEquity) {
      this.status.peakEquity = currentEquity;
    }

    this.status.currentEquity = currentEquity;

    // Calculate drawdown
    this.status.currentDrawdown = this.status.peakEquity - currentEquity;
    this.status.currentDrawdownPercent = (this.status.currentDrawdown / this.status.peakEquity) * 100;

    // Calculate daily PnL
    this.status.dailyPnl = currentEquity - this.dailyStartEquity;
    this.status.dailyPnlPercent = (this.status.dailyPnl / this.dailyStartEquity) * 100;

    // Calculate total PnL
    this.status.totalPnl = currentEquity - this.initialCapital;
    this.status.totalPnlPercent = (this.status.totalPnl / this.initialCapital) * 100;

    // Calculate total exposure
    let totalExposure = 0;
    for (const position of positions) {
      totalExposure += position.currentPrice * position.quantity;
    }
    this.status.totalExposure = totalExposure;
    this.status.totalExposurePercent = (totalExposure / currentEquity) * 100;

    this.status.lastCheckedAt = Date.now();

    // Check all limits
    this.checkAllLimits();

    this.notifyListeners();
  }

  /**
   * Check if an order is allowed by risk limits
   */
  checkOrder(params: OrderCheckParams, positions: PaperPosition[]): RiskCheckResult {
    const violations: RiskViolation[] = [];
    const orderValue = params.quantity * params.price;

    // Check if halted
    if (this.status.isHalted) {
      violations.push({
        type: 'max_total_loss',
        message: `Trading halted: ${this.status.haltReason}`,
        currentValue: 0,
        limitValue: 0,
        timestamp: Date.now(),
      });
      return { allowed: false, violations };
    }

    // Check max order value
    if (orderValue > this.limits.maxOrderValue) {
      violations.push({
        type: 'max_order_value',
        message: `Order value $${orderValue.toFixed(2)} exceeds limit $${this.limits.maxOrderValue}`,
        currentValue: orderValue,
        limitValue: this.limits.maxOrderValue,
        timestamp: Date.now(),
      });
    }

    // Check max position size
    const existingPosition = positions.find(p => p.marketId === params.marketId);
    const newQuantity = params.side === 'buy'
      ? (existingPosition?.quantity || 0) + params.quantity
      : params.quantity;

    if (params.side === 'buy' && newQuantity > this.limits.maxPositionSize) {
      violations.push({
        type: 'max_position_size',
        message: `Position size ${newQuantity} would exceed limit ${this.limits.maxPositionSize}`,
        currentValue: newQuantity,
        limitValue: this.limits.maxPositionSize,
        timestamp: Date.now(),
      });
    }

    // Check max position value
    const newPositionValue = newQuantity * params.price;
    if (params.side === 'buy' && newPositionValue > this.limits.maxPositionValue) {
      violations.push({
        type: 'max_position_value',
        message: `Position value $${newPositionValue.toFixed(2)} would exceed limit $${this.limits.maxPositionValue}`,
        currentValue: newPositionValue,
        limitValue: this.limits.maxPositionValue,
        timestamp: Date.now(),
      });
    }

    // Check max total exposure
    if (params.side === 'buy') {
      const newExposure = this.status.totalExposure + orderValue;
      if (newExposure > this.limits.maxTotalExposure) {
        violations.push({
          type: 'max_total_exposure',
          message: `Total exposure $${newExposure.toFixed(2)} would exceed limit $${this.limits.maxTotalExposure}`,
          currentValue: newExposure,
          limitValue: this.limits.maxTotalExposure,
          timestamp: Date.now(),
        });
      }
    }

    // Check order rate limit
    this.cleanupOldOrderTimestamps();
    if (this.orderTimestamps.length >= this.limits.maxOrdersPerMinute) {
      violations.push({
        type: 'max_orders_per_minute',
        message: `Order rate ${this.orderTimestamps.length}/min exceeds limit ${this.limits.maxOrdersPerMinute}/min`,
        currentValue: this.orderTimestamps.length,
        limitValue: this.limits.maxOrdersPerMinute,
        timestamp: Date.now(),
      });
    }

    // Record violations
    if (violations.length > 0) {
      this.violations.push(...violations);
      console.warn('[RiskManager] Order rejected:', violations.map(v => v.message).join(', '));
    }

    return {
      allowed: violations.length === 0,
      violations,
    };
  }

  /**
   * Record that an order was placed
   */
  recordOrder(): void {
    this.orderTimestamps.push(Date.now());
    this.status.ordersThisMinute = this.orderTimestamps.length;
  }

  /**
   * Check all risk limits and halt trading if necessary
   */
  private checkAllLimits(): void {
    const violations: RiskViolation[] = [];

    // Check max daily loss
    if (-this.status.dailyPnl > this.limits.maxDailyLoss) {
      violations.push({
        type: 'max_daily_loss',
        message: `Daily loss $${(-this.status.dailyPnl).toFixed(2)} exceeds limit $${this.limits.maxDailyLoss}`,
        currentValue: -this.status.dailyPnl,
        limitValue: this.limits.maxDailyLoss,
        timestamp: Date.now(),
      });
    }

    // Check max daily loss percent
    if (-this.status.dailyPnlPercent > this.limits.maxDailyLossPercent) {
      violations.push({
        type: 'max_daily_loss',
        message: `Daily loss ${(-this.status.dailyPnlPercent).toFixed(2)}% exceeds limit ${this.limits.maxDailyLossPercent}%`,
        currentValue: -this.status.dailyPnlPercent,
        limitValue: this.limits.maxDailyLossPercent,
        timestamp: Date.now(),
      });
    }

    // Check max total loss
    if (-this.status.totalPnl > this.limits.maxTotalLoss) {
      violations.push({
        type: 'max_total_loss',
        message: `Total loss $${(-this.status.totalPnl).toFixed(2)} exceeds limit $${this.limits.maxTotalLoss}`,
        currentValue: -this.status.totalPnl,
        limitValue: this.limits.maxTotalLoss,
        timestamp: Date.now(),
      });
    }

    // Check max total loss percent
    if (-this.status.totalPnlPercent > this.limits.maxTotalLossPercent) {
      violations.push({
        type: 'max_total_loss',
        message: `Total loss ${(-this.status.totalPnlPercent).toFixed(2)}% exceeds limit ${this.limits.maxTotalLossPercent}%`,
        currentValue: -this.status.totalPnlPercent,
        limitValue: this.limits.maxTotalLossPercent,
        timestamp: Date.now(),
      });
    }

    // Check max drawdown
    if (this.status.currentDrawdownPercent > this.limits.maxDrawdownPercent) {
      violations.push({
        type: 'max_drawdown',
        message: `Drawdown ${this.status.currentDrawdownPercent.toFixed(2)}% exceeds limit ${this.limits.maxDrawdownPercent}%`,
        currentValue: this.status.currentDrawdownPercent,
        limitValue: this.limits.maxDrawdownPercent,
        timestamp: Date.now(),
      });
    }

    // Halt trading if critical violations
    const criticalTypes: RiskViolationType[] = ['max_total_loss', 'max_daily_loss', 'max_drawdown'];
    const criticalViolations = violations.filter(v => criticalTypes.includes(v.type));

    if (criticalViolations.length > 0) {
      this.haltTrading(criticalViolations[0].message);
      this.violations.push(...criticalViolations);
    }
  }

  /**
   * Halt all trading
   */
  haltTrading(reason: string): void {
    this.status.isHalted = true;
    this.status.haltReason = reason;
    console.error('[RiskManager] TRADING HALTED:', reason);
    this.notifyListeners();
  }

  /**
   * Resume trading (manual override)
   */
  resumeTrading(): void {
    if (!this.status.isHalted) return;

    console.log('[RiskManager] Trading resumed manually');
    this.status.isHalted = false;
    this.status.haltReason = undefined;
    this.notifyListeners();
  }

  /**
   * Emergency stop - close all positions and halt
   */
  emergencyStop(): void {
    this.haltTrading('Emergency stop triggered');
    console.error('[RiskManager] EMERGENCY STOP TRIGGERED');
  }

  /**
   * Get recent violations
   */
  getViolations(limit: number = 100): RiskViolation[] {
    return this.violations.slice(-limit);
  }

  /**
   * Check if it's a new day and reset daily tracking
   */
  private checkDayReset(): void {
    const startOfToday = this.getStartOfDay();
    if (startOfToday > this.dailyStartTime) {
      console.log('[RiskManager] New day detected, resetting daily tracking');
      this.dailyStartTime = startOfToday;
      this.dailyStartEquity = this.status.currentEquity;
      this.status.dailyPnl = 0;
      this.status.dailyPnlPercent = 0;

      // Clear violations from previous day
      this.violations = this.violations.filter(v =>
        v.timestamp >= startOfToday
      );
    }
  }

  /**
   * Get start of day timestamp (UTC)
   */
  private getStartOfDay(): number {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }

  /**
   * Clean up order timestamps older than 1 minute
   */
  private cleanupOldOrderTimestamps(): void {
    const oneMinuteAgo = Date.now() - 60000;
    this.orderTimestamps = this.orderTimestamps.filter(ts => ts > oneMinuteAgo);
    this.status.ordersThisMinute = this.orderTimestamps.length;
  }

  /**
   * Reset risk manager state
   */
  reset(): void {
    this.status = createEmptyRiskStatus(this.initialCapital);
    this.dailyStartEquity = this.initialCapital;
    this.dailyStartTime = this.getStartOfDay();
    this.orderTimestamps = [];
    this.violations = [];
    console.log('[RiskManager] Reset');
    this.notifyListeners();
  }

  /**
   * Clear all state
   */
  clear(): void {
    this.reset();
    this.listeners.clear();
  }
}

// Export singleton
export const riskManager = new RiskManager();

// Export class for testing
export { RiskManager };
