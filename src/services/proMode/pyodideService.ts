/**
 * Pyodide Service
 * High-level interface for Python execution in Pro Mode
 * Manages Web Worker lifecycle and provides async API
 */

import {
  CustomStrategy,
  StrategySignal,
  ValidationResult,
  ValidationError,
  BarData,
} from '../../types/proMode';

// Worker message types (must match worker)
interface WorkerMessage {
  id: string;
  type: 'init' | 'execute' | 'validate' | 'calculate_indicator' | 'terminate';
  payload: unknown;
}

interface WorkerResponse {
  id: string;
  type: 'success' | 'error' | 'progress';
  payload: unknown;
}

// ============================================
// PYODIDE SERVICE
// ============================================

class PyodideService {
  private worker: Worker | null = null;
  private isInitialized = false;
  private isInitializing = false;
  private pendingRequests = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize Pyodide runtime
   * This is called automatically when needed, but can be called
   * explicitly for faster first execution
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    if (this.isInitializing && this.initPromise) {
      return this.initPromise;
    }

    this.isInitializing = true;

    this.initPromise = new Promise<void>((resolve, reject) => {
      try {
        // Create worker
        this.worker = new Worker(
          new URL('../../workers/pyodide.worker.ts', import.meta.url),
          { type: 'module' }
        );

        // Set up message handler
        this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
          const { id, type, payload } = event.data;
          const pending = this.pendingRequests.get(id);

          if (pending) {
            this.pendingRequests.delete(id);
            if (type === 'error') {
              pending.reject(new Error((payload as any).error || 'Unknown error'));
            } else {
              pending.resolve(payload);
            }
          }
        };

        this.worker.onerror = (error) => {
          console.error('[PyodideService] Worker error:', error);
          reject(error);
        };

        // Initialize Pyodide in worker
        this.sendMessage('init', {})
          .then(() => {
            this.isInitialized = true;
            this.isInitializing = false;
            resolve();
          })
          .catch(reject);
      } catch (error) {
        this.isInitializing = false;
        reject(error);
      }
    });

    return this.initPromise;
  }

  /**
   * Terminate worker and clean up
   */
  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.isInitialized = false;
    this.isInitializing = false;
    this.initPromise = null;
    this.pendingRequests.clear();
  }

  /**
   * Validate Python code for syntax and security
   */
  async validateCode(code: string): Promise<ValidationResult> {
    await this.ensureInitialized();

    try {
      const result = await this.sendMessage('validate', { code }) as {
        isValid: boolean;
        errors: string[];
      };

      // Convert to ValidationResult format
      const errors: ValidationError[] = result.errors.map(msg => ({
        type: this.categorizeError(msg),
        message: msg,
      }));

      return {
        isValid: result.isValid,
        errors,
        warnings: [],
        syntaxCheckPassed: !errors.some(e => e.type === 'syntax'),
        securityCheckPassed: !errors.some(e => e.type === 'security'),
        interfaceCheckPassed: !errors.some(e => e.type === 'interface'),
      };
    } catch (error: any) {
      return {
        isValid: false,
        errors: [{
          type: 'runtime',
          message: error.message || 'Validation failed',
        }],
        warnings: [],
        syntaxCheckPassed: false,
        securityCheckPassed: false,
        interfaceCheckPassed: false,
      };
    }
  }

  /**
   * Execute strategy on historical bars
   */
  async executeStrategy(
    strategy: CustomStrategy,
    bars: BarData[],
    timeoutMs: number = 30000
  ): Promise<{ signals: StrategySignal[]; error?: string }> {
    await this.ensureInitialized();

    try {
      const result = await this.sendMessage('execute', {
        code: strategy.pythonCode,
        bars: bars.map(bar => ({
          timestamp: bar.timestamp,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
        })),
        params: strategy.configValues,
        timeout: timeoutMs,
      }) as { signals: any[]; error?: string };

      if (result.error) {
        return { signals: [], error: result.error };
      }

      // Convert raw signals to typed StrategySignals
      const signals: StrategySignal[] = result.signals.map(s => ({
        type: s.type,
        quantity: s.quantity,
        price: s.price,
        orderType: s.order_type || 'market',
        reason: s.reason,
        indicatorValues: s.indicator_values,
        timestamp: s.timestamp,
      }));

      return { signals };
    } catch (error: any) {
      return { signals: [], error: error.message || 'Execution failed' };
    }
  }

  /**
   * Calculate a single indicator on data
   */
  async calculateIndicator(
    indicatorName: string,
    data: number[],
    params: Record<string, unknown> = {}
  ): Promise<{ values: number[]; error?: string }> {
    await this.ensureInitialized();

    try {
      const result = await this.sendMessage('calculate_indicator', {
        indicator: indicatorName,
        data,
        params,
      }) as { values: number[]; error?: string };

      return result;
    } catch (error: any) {
      return { values: [], error: error.message || 'Calculation failed' };
    }
  }

  /**
   * Check if Pyodide is initialized
   */
  get initialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Get initialization status
   */
  get status(): 'idle' | 'initializing' | 'ready' | 'error' {
    if (this.isInitialized) return 'ready';
    if (this.isInitializing) return 'initializing';
    return 'idle';
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  private sendMessage(type: WorkerMessage['type'], payload: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker not initialized'));
        return;
      }

      const id = crypto.randomUUID();
      this.pendingRequests.set(id, { resolve, reject });

      this.worker.postMessage({ id, type, payload } as WorkerMessage);

      // Timeout after 60 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Worker request timeout'));
        }
      }, 60000);
    });
  }

  private categorizeError(message: string): ValidationError['type'] {
    if (message.includes('Security violation') || message.includes('not allowed')) {
      return 'security';
    }
    if (message.includes('syntax') || message.includes('SyntaxError')) {
      return 'syntax';
    }
    if (message.includes('interface') || message.includes('on_bar') || message.includes('Strategy')) {
      return 'interface';
    }
    return 'runtime';
  }
}

// Export singleton instance
export const pyodideService = new PyodideService();

// Export class for testing
export { PyodideService };
