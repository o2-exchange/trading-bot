/**
 * Pyodide Web Worker (Classic - non-module)
 * Sandboxed Python execution environment for Pro Mode strategies
 */

// Pyodide instance
let pyodide = null;
let isInitialized = false;

// Security configuration
const FORBIDDEN_PATTERNS = [
  'import os', 'import sys', 'import subprocess', 'import shutil', 'import pathlib',
  '__import__', 'eval(', 'exec(', 'compile(', 'globals(', 'locals(', 'vars(', 'dir(',
  'getattr(', 'setattr(', 'delattr(', 'hasattr(', 'open(', 'file(',
  'import socket', 'import urllib', 'import requests', 'import http', 'import ftplib', 'import smtplib',
  'import multiprocessing', 'import threading', 'import signal',
  '__builtins__', '__loader__', '__spec__',
];

const ALLOWED_IMPORTS = [
  'numpy', 'pandas', 'math', 'statistics', 'decimal', 'datetime', 'json', 're',
  'collections', 'itertools', 'functools', 'typing', 'dataclasses', 'enum', 'copy', 'operator', 'random',
];

// Initialize Pyodide
async function initializePyodide() {
  if (isInitialized) return;

  try {
    console.log('[Pyodide Worker] Starting initialization...');

    // Load Pyodide from CDN
    console.log('[Pyodide Worker] Loading Pyodide script from CDN...');
    importScripts('https://cdn.jsdelivr.net/pyodide/v0.26.0/full/pyodide.js');
    console.log('[Pyodide Worker] Pyodide script loaded');

    console.log('[Pyodide Worker] Initializing Pyodide runtime...');
    pyodide = await loadPyodide({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.0/full/',
    });
    console.log('[Pyodide Worker] Pyodide runtime initialized');

    // Load required packages
    console.log('[Pyodide Worker] Loading numpy and pandas packages...');
    await pyodide.loadPackage(['numpy', 'pandas']);
    console.log('[Pyodide Worker] Packages loaded');

    // Set up the indicator library in Python
    console.log('[Pyodide Worker] Setting up indicator library...');
    await pyodide.runPythonAsync(INDICATOR_LIBRARY_CODE);

    // Set up the strategy execution context
    console.log('[Pyodide Worker] Setting up strategy context...');
    await pyodide.runPythonAsync(STRATEGY_CONTEXT_CODE);

    isInitialized = true;
    console.log('[Pyodide Worker] Initialization complete!');
  } catch (error) {
    console.error('[Pyodide Worker] Initialization failed:', error);
    throw new Error(`Failed to initialize Pyodide: ${error}`);
  }
}

// Validate code for security
function validateCode(code) {
  const errors = [];

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (code.includes(pattern)) {
      errors.push(`Security violation: "${pattern}" is not allowed`);
    }
  }

  const importRegex = /import\s+(\w+)|from\s+(\w+)\s+import/g;
  let match;
  while ((match = importRegex.exec(code)) !== null) {
    const moduleName = match[1] || match[2];
    if (!ALLOWED_IMPORTS.includes(moduleName)) {
      errors.push(`Import not allowed: "${moduleName}". Allowed imports: ${ALLOWED_IMPORTS.join(', ')}`);
    }
  }

  return { isValid: errors.length === 0, errors };
}

// Execute strategy
async function executeStrategy(code, bars, params, timeoutMs = 30000) {
  const validation = validateCode(code);
  if (!validation.isValid) {
    return { signals: [], error: validation.errors.join('\n') };
  }

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Execution timeout exceeded')), timeoutMs);
  });

  try {
    const barsJson = JSON.stringify(bars);
    const paramsJson = JSON.stringify(params || {});

    console.log(`[Pyodide Worker] Executing strategy on ${bars.length} bars...`);

    const executionPromise = pyodide.runPythonAsync(`
import json

# Parse input data
bars_data = json.loads('''${barsJson}''')
params_data = json.loads('''${paramsJson}''')

print(f"[Python] Processing {len(bars_data)} bars with params: {params_data}")

# Create execution context
context = StrategyContext(params_data, indicator_library)

# Load user strategy
${code}

# Instantiate strategy
strategy = Strategy(context)

# Track position state during simulation
# This class supports both attribute access (position.quantity) and dict access (position['quantity'])
class Position:
    def __init__(self):
        self.side = None  # 'long', 'short', or None
        self.quantity = 0
        self.avg_price = 0
        self.unrealized_pnl = 0
        self.entry_timestamp = 0

    def __bool__(self):
        return self.side is not None and self.quantity > 0

    def to_obj(self):
        """Return a position object that supports both attribute and dict access"""
        if not self:
            return None
        # Create a class that acts like both a dict and an object
        class PositionDict(dict):
            def __getattr__(self, name):
                try:
                    return self[name]
                except KeyError:
                    raise AttributeError(f"'PositionDict' object has no attribute '{name}'")
            def __setattr__(self, name, value):
                self[name] = value

        return PositionDict({
            'side': self.side,
            'quantity': self.quantity,
            'avg_price': self.avg_price,
            'unrealized_pnl': self.unrealized_pnl
        })

# Run strategy on bars with position tracking
all_signals = []
position = Position()
orders = []

for i, bar in enumerate(bars_data):
    bar_obj = type('Bar', (), bar)()

    # Update unrealized PnL
    if position:
        if position.side == 'long':
            position.unrealized_pnl = (bar['close'] - position.avg_price) * position.quantity
        elif position.side == 'short':
            position.unrealized_pnl = (position.avg_price - bar['close']) * position.quantity

    # Call strategy - pass position as object that supports both attribute and dict access
    try:
        signals = strategy.on_bar(bar_obj, position.to_obj(), orders)
    except Exception as e:
        print(f"[Python] Error at bar {i}: {e}")
        signals = []

    if signals:
        for signal in signals:
            signal['timestamp'] = bar['timestamp']
            all_signals.append(signal)

            # Update position based on signal
            sig_type = signal.get('type', '')
            sig_qty = signal.get('quantity', 0)
            sig_price = signal.get('price', bar['close'])

            if sig_type == 'buy':
                if position.side == 'short':
                    # Close short position
                    position.side = None
                    position.quantity = 0
                    position.avg_price = 0

                if position.side is None:
                    position.side = 'long'
                    position.quantity = sig_qty
                    position.avg_price = sig_price
                    position.entry_timestamp = bar['timestamp']
                else:
                    # Add to position
                    total_qty = position.quantity + sig_qty
                    position.avg_price = (position.quantity * position.avg_price + sig_qty * sig_price) / total_qty
                    position.quantity = total_qty

            elif sig_type == 'sell':
                if position.side == 'long':
                    position.quantity -= sig_qty
                    if position.quantity <= 0:
                        position.side = None
                        position.quantity = 0
                        position.avg_price = 0
                elif position.side is None:
                    # Open short position
                    position.side = 'short'
                    position.quantity = sig_qty
                    position.avg_price = sig_price
                    position.entry_timestamp = bar['timestamp']

            elif sig_type == 'close':
                position.side = None
                position.quantity = 0
                position.avg_price = 0

print(f"[Python] Strategy generated {len(all_signals)} signals")

# Return signals as JSON
json.dumps(all_signals)
    `);

    const result = await Promise.race([executionPromise, timeoutPromise]);
    const signals = JSON.parse(result);
    console.log(`[Pyodide Worker] Strategy returned ${signals.length} signals`);
    return { signals };
  } catch (error) {
    console.error(`[Pyodide Worker] Execution error:`, error);
    return { signals: [], error: error.message || String(error) };
  }
}

// Calculate indicator
async function calculateIndicator(indicatorName, data, params) {
  try {
    const dataJson = JSON.stringify(data);
    const paramsJson = JSON.stringify(params);

    const result = await pyodide.runPythonAsync(`
import json
import numpy as np

data = json.loads('''${dataJson}''')
params = json.loads('''${paramsJson}''')

# Calculate indicator
result = indicator_library.calculate('${indicatorName}', np.array(data), **params)

# Return as JSON
json.dumps(result.tolist() if hasattr(result, 'tolist') else list(result))
    `);

    const values = JSON.parse(result);
    return { values };
  } catch (error) {
    return { values: [], error: error.message || String(error) };
  }
}

// Message handler
self.onmessage = async (event) => {
  const { id, type, payload } = event.data;

  try {
    switch (type) {
      case 'init': {
        await initializePyodide();
        postResponse(id, 'success', { initialized: true });
        break;
      }

      case 'validate': {
        const { code } = payload;
        const result = validateCode(code);
        postResponse(id, 'success', result);
        break;
      }

      case 'execute': {
        if (!isInitialized) {
          await initializePyodide();
        }
        const { code, bars, params, timeout } = payload;
        const result = await executeStrategy(code, bars, params, timeout);
        postResponse(id, result.error ? 'error' : 'success', result);
        break;
      }

      case 'calculate_indicator': {
        if (!isInitialized) {
          await initializePyodide();
        }
        const { indicator, data, params } = payload;
        const result = await calculateIndicator(indicator, data, params);
        postResponse(id, result.error ? 'error' : 'success', result);
        break;
      }

      case 'terminate': {
        self.close();
        break;
      }

      default:
        postResponse(id, 'error', { error: `Unknown message type: ${type}` });
    }
  } catch (error) {
    postResponse(id, 'error', { error: error.message || String(error) });
  }
};

function postResponse(id, type, payload) {
  self.postMessage({ id, type, payload });
}

// Python code templates
const INDICATOR_LIBRARY_CODE = `
import numpy as np
import pandas as pd

class IndicatorLibrary:
    """Built-in technical indicator library"""

    def __init__(self):
        self._cache = {}

    def calculate(self, name, data, **params):
        """Calculate indicator by name"""
        method = getattr(self, name.upper(), None)
        if method is None:
            raise ValueError(f"Unknown indicator: {name}")
        return method(data, **params)

    # ========== TREND INDICATORS ==========

    def SMA(self, data, period=20, **kwargs):
        """Simple Moving Average"""
        return pd.Series(data).rolling(window=period).mean().values

    def EMA(self, data, period=20, **kwargs):
        """Exponential Moving Average"""
        return pd.Series(data).ewm(span=period, adjust=False).mean().values

    def WMA(self, data, period=20, **kwargs):
        """Weighted Moving Average"""
        weights = np.arange(1, period + 1)
        return pd.Series(data).rolling(window=period).apply(
            lambda x: np.dot(x, weights) / weights.sum(), raw=True
        ).values

    def VWMA(self, close, volume, period=20, **kwargs):
        """Volume Weighted Moving Average"""
        pv = close * volume
        return pd.Series(pv).rolling(window=period).sum().values / \\
               pd.Series(volume).rolling(window=period).sum().values

    # ========== MOMENTUM INDICATORS ==========

    def RSI(self, data, period=14, **kwargs):
        """Relative Strength Index"""
        delta = pd.Series(data).diff()
        gain = delta.where(delta > 0, 0).rolling(window=period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
        rs = gain / loss
        return (100 - (100 / (1 + rs))).values

    def STOCHASTIC(self, high, low, close, k_period=14, d_period=3, **kwargs):
        """Stochastic Oscillator"""
        lowest_low = pd.Series(low).rolling(window=k_period).min()
        highest_high = pd.Series(high).rolling(window=k_period).max()
        k = 100 * (pd.Series(close) - lowest_low) / (highest_high - lowest_low)
        d = k.rolling(window=d_period).mean()
        return {'k': k.values, 'd': d.values}

    def MACD(self, data, fast_period=12, slow_period=26, signal_period=9, **kwargs):
        """MACD Indicator"""
        fast_ema = pd.Series(data).ewm(span=fast_period, adjust=False).mean()
        slow_ema = pd.Series(data).ewm(span=slow_period, adjust=False).mean()
        macd = fast_ema - slow_ema
        signal = macd.ewm(span=signal_period, adjust=False).mean()
        histogram = macd - signal
        return {
            'macd': macd.values,
            'signal': signal.values,
            'histogram': histogram.values
        }

    def ROC(self, data, period=10, **kwargs):
        """Rate of Change"""
        return ((pd.Series(data) - pd.Series(data).shift(period)) / \\
                pd.Series(data).shift(period) * 100).values

    # ========== VOLATILITY INDICATORS ==========

    def ATR(self, high, low, close, period=14, **kwargs):
        """Average True Range"""
        high_s = pd.Series(high)
        low_s = pd.Series(low)
        close_s = pd.Series(close)

        tr1 = high_s - low_s
        tr2 = abs(high_s - close_s.shift())
        tr3 = abs(low_s - close_s.shift())
        tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)

        return tr.rolling(window=period).mean().values

    def BOLLINGER(self, data, period=20, std_dev=2, **kwargs):
        """Bollinger Bands"""
        sma = pd.Series(data).rolling(window=period).mean()
        std = pd.Series(data).rolling(window=period).std()
        return {
            'upper': (sma + std_dev * std).values,
            'middle': sma.values,
            'lower': (sma - std_dev * std).values
        }

    def KELTNER(self, high, low, close, ema_period=20, atr_period=10, multiplier=2, **kwargs):
        """Keltner Channels"""
        ema = pd.Series(close).ewm(span=ema_period, adjust=False).mean()
        atr = self.ATR(high, low, close, atr_period)
        return {
            'upper': (ema + multiplier * atr).values,
            'middle': ema.values,
            'lower': (ema - multiplier * atr).values
        }

    # ========== VOLUME INDICATORS ==========

    def OBV(self, close, volume, **kwargs):
        """On-Balance Volume"""
        obv = np.zeros(len(close))
        for i in range(1, len(close)):
            if close[i] > close[i-1]:
                obv[i] = obv[i-1] + volume[i]
            elif close[i] < close[i-1]:
                obv[i] = obv[i-1] - volume[i]
            else:
                obv[i] = obv[i-1]
        return obv

    def VWAP(self, high, low, close, volume, **kwargs):
        """Volume Weighted Average Price"""
        typical_price = (np.array(high) + np.array(low) + np.array(close)) / 3
        cumulative_tp_vol = np.cumsum(typical_price * np.array(volume))
        cumulative_vol = np.cumsum(volume)
        return cumulative_tp_vol / cumulative_vol

    def MFI(self, high, low, close, volume, period=14, **kwargs):
        """Money Flow Index"""
        typical_price = (np.array(high) + np.array(low) + np.array(close)) / 3
        money_flow = typical_price * np.array(volume)

        positive_flow = np.zeros(len(close))
        negative_flow = np.zeros(len(close))

        for i in range(1, len(close)):
            if typical_price[i] > typical_price[i-1]:
                positive_flow[i] = money_flow[i]
            else:
                negative_flow[i] = money_flow[i]

        pos_mf = pd.Series(positive_flow).rolling(window=period).sum()
        neg_mf = pd.Series(negative_flow).rolling(window=period).sum()

        mfi = 100 - (100 / (1 + pos_mf / neg_mf))
        return mfi.values

    # ========== OSCILLATORS ==========

    def ADX(self, high, low, close, period=14, **kwargs):
        """Average Directional Index"""
        high_s = pd.Series(high)
        low_s = pd.Series(low)
        close_s = pd.Series(close)

        plus_dm = high_s.diff()
        minus_dm = low_s.diff().abs()

        plus_dm = plus_dm.where((plus_dm > minus_dm) & (plus_dm > 0), 0)
        minus_dm = minus_dm.where((minus_dm > plus_dm) & (minus_dm > 0), 0)

        atr = pd.Series(self.ATR(high, low, close, period))

        plus_di = 100 * (plus_dm.rolling(window=period).sum() / atr)
        minus_di = 100 * (minus_dm.rolling(window=period).sum() / atr)

        dx = 100 * abs(plus_di - minus_di) / (plus_di + minus_di)
        adx = dx.rolling(window=period).mean()

        return {
            'adx': adx.values,
            'di_plus': plus_di.values,
            'di_minus': minus_di.values
        }

    def AROON(self, high, low, period=25, **kwargs):
        """Aroon Indicator"""
        high_s = pd.Series(high)
        low_s = pd.Series(low)

        aroon_up = high_s.rolling(window=period+1).apply(
            lambda x: (period - (period - x.argmax())) / period * 100, raw=True
        )
        aroon_down = low_s.rolling(window=period+1).apply(
            lambda x: (period - (period - x.argmin())) / period * 100, raw=True
        )

        return {
            'aroon_up': aroon_up.values,
            'aroon_down': aroon_down.values
        }

    def CCI(self, high, low, close, period=20, **kwargs):
        """Commodity Channel Index"""
        typical_price = (np.array(high) + np.array(low) + np.array(close)) / 3
        tp_series = pd.Series(typical_price)

        sma = tp_series.rolling(window=period).mean()
        mad = tp_series.rolling(window=period).apply(
            lambda x: np.abs(x - x.mean()).mean(), raw=True
        )

        cci = (tp_series - sma) / (0.015 * mad)
        return cci.values


# Create global indicator library instance
indicator_library = IndicatorLibrary()
`;

const STRATEGY_CONTEXT_CODE = `
class StrategyContext:
    """Context object passed to strategy on_init"""

    def __init__(self, params, indicators):
        self.params = params
        self.indicators = indicators
        self._indicator_instances = {}

    def get_param(self, name, default=None):
        return self.params.get(name, default)

    class IndicatorWrapper:
        """Wrapper for creating indicator instances"""

        def __init__(self, library):
            self._library = library

        def SMA(self, period=20):
            return lambda data: self._library.SMA(data, period=period)

        def EMA(self, period=20):
            return lambda data: self._library.EMA(data, period=period)

        def RSI(self, period=14):
            return lambda data: self._library.RSI(data, period=period)

        def MACD(self, fast_period=12, slow_period=26, signal_period=9):
            return lambda data: self._library.MACD(
                data, fast_period=fast_period, slow_period=slow_period, signal_period=signal_period
            )

        def ATR(self, period=14):
            return lambda high, low, close: self._library.ATR(high, low, close, period=period)

        def BOLLINGER(self, period=20, std_dev=2):
            return lambda data: self._library.BOLLINGER(data, period=period, std_dev=std_dev)

    @property
    def indicators(self):
        return self.IndicatorWrapper(indicator_library)

    @indicators.setter
    def indicators(self, value):
        pass  # Read-only, set by IndicatorWrapper
`;
