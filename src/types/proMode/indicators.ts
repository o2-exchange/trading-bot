/**
 * Pro Mode Indicator Types
 * Types for technical indicators and custom indicator definitions
 */

// ============================================
// INDICATOR CATEGORIES
// ============================================

export type IndicatorCategory =
  | 'trend'
  | 'momentum'
  | 'volatility'
  | 'volume'
  | 'oscillator'
  | 'support-resistance'
  | 'pattern'
  | 'custom';

export const INDICATOR_CATEGORY_LABELS: Record<IndicatorCategory, string> = {
  'trend': 'Trend',
  'momentum': 'Momentum',
  'volatility': 'Volatility',
  'volume': 'Volume',
  'oscillator': 'Oscillator',
  'support-resistance': 'Support/Resistance',
  'pattern': 'Pattern Recognition',
  'custom': 'Custom',
};

// ============================================
// INDICATOR PARAMETERS
// ============================================

export type IndicatorParameterType = 'number' | 'string' | 'boolean' | 'select';

export interface IndicatorParameter {
  name: string;
  type: IndicatorParameterType;
  default: number | string | boolean;
  description: string;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: string | number; label: string }>;  // For 'select' type
}

// ============================================
// INDICATOR OUTPUT
// ============================================

export type IndicatorOutputType = 'line' | 'histogram' | 'band' | 'signal' | 'area' | 'scatter';

export interface IndicatorOutput {
  name: string;
  type: IndicatorOutputType;
  color?: string;
  lineWidth?: number;
  visible?: boolean;
}

// ============================================
// INDICATOR DEFINITION
// ============================================

export interface Indicator {
  id: string;
  name: string;
  shortName: string;                  // e.g., "SMA", "RSI"
  category: IndicatorCategory;
  description: string;

  // Parameters
  parameters: IndicatorParameter[];

  // Output
  outputs: IndicatorOutput[];

  // Implementation
  pythonFunction: string;             // Name of function in indicator library

  // Metadata
  isBuiltIn: boolean;
  author?: string;
  documentation?: string;
}

// ============================================
// CUSTOM INDICATOR
// ============================================

export interface CustomIndicator extends Indicator {
  pythonCode: string;                 // Full Python implementation
  isBuiltIn: false;
  createdAt: number;
  updatedAt: number;
}

// ============================================
// INDICATOR RESULT
// ============================================

export interface IndicatorResult {
  indicatorId: string;
  values: Record<string, number[]>;   // output name -> values array
  timestamps: number[];
}

// ============================================
// BUILT-IN INDICATORS
// ============================================

export const BUILT_IN_INDICATORS: Indicator[] = [
  // ========== TREND INDICATORS ==========
  {
    id: 'sma',
    name: 'Simple Moving Average',
    shortName: 'SMA',
    category: 'trend',
    description: 'Average price over a specified period',
    parameters: [
      { name: 'period', type: 'number', default: 20, description: 'Number of periods', min: 1, max: 500 },
      { name: 'source', type: 'select', default: 'close', description: 'Price source', options: [
        { value: 'open', label: 'Open' },
        { value: 'high', label: 'High' },
        { value: 'low', label: 'Low' },
        { value: 'close', label: 'Close' },
        { value: 'hl2', label: 'HL/2' },
        { value: 'hlc3', label: 'HLC/3' },
        { value: 'ohlc4', label: 'OHLC/4' },
      ]},
    ],
    outputs: [{ name: 'sma', type: 'line', color: '#2196F3' }],
    pythonFunction: 'SMA',
    isBuiltIn: true,
  },
  {
    id: 'ema',
    name: 'Exponential Moving Average',
    shortName: 'EMA',
    category: 'trend',
    description: 'Weighted moving average with more weight on recent prices',
    parameters: [
      { name: 'period', type: 'number', default: 20, description: 'Number of periods', min: 1, max: 500 },
      { name: 'source', type: 'select', default: 'close', description: 'Price source', options: [
        { value: 'open', label: 'Open' },
        { value: 'high', label: 'High' },
        { value: 'low', label: 'Low' },
        { value: 'close', label: 'Close' },
      ]},
    ],
    outputs: [{ name: 'ema', type: 'line', color: '#FF9800' }],
    pythonFunction: 'EMA',
    isBuiltIn: true,
  },
  {
    id: 'wma',
    name: 'Weighted Moving Average',
    shortName: 'WMA',
    category: 'trend',
    description: 'Moving average with linearly weighted prices',
    parameters: [
      { name: 'period', type: 'number', default: 20, description: 'Number of periods', min: 1, max: 500 },
    ],
    outputs: [{ name: 'wma', type: 'line', color: '#9C27B0' }],
    pythonFunction: 'WMA',
    isBuiltIn: true,
  },
  {
    id: 'vwma',
    name: 'Volume Weighted Moving Average',
    shortName: 'VWMA',
    category: 'trend',
    description: 'Moving average weighted by volume',
    parameters: [
      { name: 'period', type: 'number', default: 20, description: 'Number of periods', min: 1, max: 500 },
    ],
    outputs: [{ name: 'vwma', type: 'line', color: '#00BCD4' }],
    pythonFunction: 'VWMA',
    isBuiltIn: true,
  },

  // ========== MOMENTUM INDICATORS ==========
  {
    id: 'rsi',
    name: 'Relative Strength Index',
    shortName: 'RSI',
    category: 'momentum',
    description: 'Measures speed and magnitude of price changes',
    parameters: [
      { name: 'period', type: 'number', default: 14, description: 'RSI period', min: 2, max: 100 },
      { name: 'overbought', type: 'number', default: 70, description: 'Overbought level', min: 50, max: 100 },
      { name: 'oversold', type: 'number', default: 30, description: 'Oversold level', min: 0, max: 50 },
    ],
    outputs: [
      { name: 'rsi', type: 'line', color: '#E91E63' },
      { name: 'overbought', type: 'line', color: '#F44336' },
      { name: 'oversold', type: 'line', color: '#4CAF50' },
    ],
    pythonFunction: 'RSI',
    isBuiltIn: true,
  },
  {
    id: 'stochastic',
    name: 'Stochastic Oscillator',
    shortName: 'STOCH',
    category: 'momentum',
    description: 'Compares closing price to price range over time',
    parameters: [
      { name: 'k_period', type: 'number', default: 14, description: '%K period', min: 1, max: 100 },
      { name: 'd_period', type: 'number', default: 3, description: '%D smoothing', min: 1, max: 100 },
      { name: 'smooth_k', type: 'number', default: 3, description: '%K smoothing', min: 1, max: 100 },
    ],
    outputs: [
      { name: 'k', type: 'line', color: '#2196F3' },
      { name: 'd', type: 'line', color: '#FF9800' },
    ],
    pythonFunction: 'STOCHASTIC',
    isBuiltIn: true,
  },
  {
    id: 'macd',
    name: 'MACD',
    shortName: 'MACD',
    category: 'momentum',
    description: 'Moving Average Convergence Divergence',
    parameters: [
      { name: 'fast_period', type: 'number', default: 12, description: 'Fast EMA period', min: 1, max: 100 },
      { name: 'slow_period', type: 'number', default: 26, description: 'Slow EMA period', min: 1, max: 200 },
      { name: 'signal_period', type: 'number', default: 9, description: 'Signal line period', min: 1, max: 100 },
    ],
    outputs: [
      { name: 'macd', type: 'line', color: '#2196F3' },
      { name: 'signal', type: 'line', color: '#FF9800' },
      { name: 'histogram', type: 'histogram', color: '#4CAF50' },
    ],
    pythonFunction: 'MACD',
    isBuiltIn: true,
  },
  {
    id: 'roc',
    name: 'Rate of Change',
    shortName: 'ROC',
    category: 'momentum',
    description: 'Percentage change over specified period',
    parameters: [
      { name: 'period', type: 'number', default: 10, description: 'Number of periods', min: 1, max: 100 },
    ],
    outputs: [{ name: 'roc', type: 'line', color: '#673AB7' }],
    pythonFunction: 'ROC',
    isBuiltIn: true,
  },

  // ========== VOLATILITY INDICATORS ==========
  {
    id: 'atr',
    name: 'Average True Range',
    shortName: 'ATR',
    category: 'volatility',
    description: 'Measures market volatility',
    parameters: [
      { name: 'period', type: 'number', default: 14, description: 'ATR period', min: 1, max: 100 },
    ],
    outputs: [{ name: 'atr', type: 'line', color: '#FF5722' }],
    pythonFunction: 'ATR',
    isBuiltIn: true,
  },
  {
    id: 'bollinger',
    name: 'Bollinger Bands',
    shortName: 'BB',
    category: 'volatility',
    description: 'Bands based on standard deviation from moving average',
    parameters: [
      { name: 'period', type: 'number', default: 20, description: 'MA period', min: 1, max: 200 },
      { name: 'std_dev', type: 'number', default: 2, description: 'Standard deviations', min: 0.5, max: 5, step: 0.1 },
    ],
    outputs: [
      { name: 'upper', type: 'line', color: '#F44336' },
      { name: 'middle', type: 'line', color: '#2196F3' },
      { name: 'lower', type: 'line', color: '#4CAF50' },
    ],
    pythonFunction: 'BOLLINGER',
    isBuiltIn: true,
  },
  {
    id: 'keltner',
    name: 'Keltner Channels',
    shortName: 'KC',
    category: 'volatility',
    description: 'Channels based on ATR from EMA',
    parameters: [
      { name: 'ema_period', type: 'number', default: 20, description: 'EMA period', min: 1, max: 200 },
      { name: 'atr_period', type: 'number', default: 10, description: 'ATR period', min: 1, max: 100 },
      { name: 'multiplier', type: 'number', default: 2, description: 'ATR multiplier', min: 0.5, max: 5, step: 0.1 },
    ],
    outputs: [
      { name: 'upper', type: 'line', color: '#F44336' },
      { name: 'middle', type: 'line', color: '#2196F3' },
      { name: 'lower', type: 'line', color: '#4CAF50' },
    ],
    pythonFunction: 'KELTNER',
    isBuiltIn: true,
  },

  // ========== VOLUME INDICATORS ==========
  {
    id: 'obv',
    name: 'On-Balance Volume',
    shortName: 'OBV',
    category: 'volume',
    description: 'Cumulative volume based on price direction',
    parameters: [],
    outputs: [{ name: 'obv', type: 'line', color: '#795548' }],
    pythonFunction: 'OBV',
    isBuiltIn: true,
  },
  {
    id: 'vwap',
    name: 'Volume Weighted Average Price',
    shortName: 'VWAP',
    category: 'volume',
    description: 'Average price weighted by volume',
    parameters: [],
    outputs: [{ name: 'vwap', type: 'line', color: '#607D8B' }],
    pythonFunction: 'VWAP',
    isBuiltIn: true,
  },
  {
    id: 'mfi',
    name: 'Money Flow Index',
    shortName: 'MFI',
    category: 'volume',
    description: 'Volume-weighted RSI',
    parameters: [
      { name: 'period', type: 'number', default: 14, description: 'MFI period', min: 1, max: 100 },
    ],
    outputs: [{ name: 'mfi', type: 'line', color: '#009688' }],
    pythonFunction: 'MFI',
    isBuiltIn: true,
  },

  // ========== OSCILLATORS ==========
  {
    id: 'adx',
    name: 'Average Directional Index',
    shortName: 'ADX',
    category: 'oscillator',
    description: 'Measures trend strength',
    parameters: [
      { name: 'period', type: 'number', default: 14, description: 'ADX period', min: 1, max: 100 },
    ],
    outputs: [
      { name: 'adx', type: 'line', color: '#3F51B5' },
      { name: 'di_plus', type: 'line', color: '#4CAF50' },
      { name: 'di_minus', type: 'line', color: '#F44336' },
    ],
    pythonFunction: 'ADX',
    isBuiltIn: true,
  },
  {
    id: 'aroon',
    name: 'Aroon Indicator',
    shortName: 'AROON',
    category: 'oscillator',
    description: 'Identifies trend changes and strength',
    parameters: [
      { name: 'period', type: 'number', default: 25, description: 'Aroon period', min: 1, max: 100 },
    ],
    outputs: [
      { name: 'aroon_up', type: 'line', color: '#4CAF50' },
      { name: 'aroon_down', type: 'line', color: '#F44336' },
    ],
    pythonFunction: 'AROON',
    isBuiltIn: true,
  },
  {
    id: 'cci',
    name: 'Commodity Channel Index',
    shortName: 'CCI',
    category: 'oscillator',
    description: 'Identifies cyclical trends',
    parameters: [
      { name: 'period', type: 'number', default: 20, description: 'CCI period', min: 1, max: 100 },
    ],
    outputs: [{ name: 'cci', type: 'line', color: '#FF5722' }],
    pythonFunction: 'CCI',
    isBuiltIn: true,
  },
];

// ============================================
// HELPER FUNCTIONS
// ============================================

export function getIndicatorById(id: string): Indicator | undefined {
  return BUILT_IN_INDICATORS.find(ind => ind.id === id);
}

export function getIndicatorsByCategory(category: IndicatorCategory): Indicator[] {
  return BUILT_IN_INDICATORS.filter(ind => ind.category === category);
}

export function getIndicatorCategories(): IndicatorCategory[] {
  const categories = new Set(BUILT_IN_INDICATORS.map(ind => ind.category));
  return Array.from(categories);
}
