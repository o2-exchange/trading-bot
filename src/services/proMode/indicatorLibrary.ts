/**
 * Indicator Library Service
 * JavaScript implementations of technical indicators for backtesting
 * These run in the main thread for fast calculation outside Pyodide
 */

import { BarData } from '../../types/proMode';

// ============================================
// HELPER FUNCTIONS
// ============================================

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

function mean(arr: number[]): number {
  return arr.length > 0 ? sum(arr) / arr.length : 0;
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const avg = mean(arr);
  const squaredDiffs = arr.map(v => Math.pow(v - avg, 2));
  return Math.sqrt(sum(squaredDiffs) / (arr.length - 1));
}

function getSource(bar: BarData, source: string = 'close'): number {
  switch (source) {
    case 'open': return bar.open;
    case 'high': return bar.high;
    case 'low': return bar.low;
    case 'close': return bar.close;
    case 'hl2': return (bar.high + bar.low) / 2;
    case 'hlc3': return (bar.high + bar.low + bar.close) / 3;
    case 'ohlc4': return (bar.open + bar.high + bar.low + bar.close) / 4;
    default: return bar.close;
  }
}

// ============================================
// TREND INDICATORS
// ============================================

/**
 * Simple Moving Average (SMA)
 */
export function SMA(data: number[], period: number): number[] {
  const result: number[] = [];

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else {
      const slice = data.slice(i - period + 1, i + 1);
      result.push(mean(slice));
    }
  }

  return result;
}

/**
 * Exponential Moving Average (EMA)
 */
export function EMA(data: number[], period: number): number[] {
  const result: number[] = [];
  const multiplier = 2 / (period + 1);

  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      result.push(data[0]);
    } else if (i < period) {
      // Use SMA for initial values
      const slice = data.slice(0, i + 1);
      result.push(mean(slice));
    } else {
      const ema = (data[i] - result[i - 1]) * multiplier + result[i - 1];
      result.push(ema);
    }
  }

  return result;
}

/**
 * Weighted Moving Average (WMA)
 */
export function WMA(data: number[], period: number): number[] {
  const result: number[] = [];
  const denominator = (period * (period + 1)) / 2;

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else {
      let weightedSum = 0;
      for (let j = 0; j < period; j++) {
        weightedSum += data[i - period + 1 + j] * (j + 1);
      }
      result.push(weightedSum / denominator);
    }
  }

  return result;
}

/**
 * Volume Weighted Moving Average (VWMA)
 */
export function VWMA(bars: BarData[], period: number): number[] {
  const result: number[] = [];

  for (let i = 0; i < bars.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else {
      let sumPriceVolume = 0;
      let sumVolume = 0;

      for (let j = i - period + 1; j <= i; j++) {
        sumPriceVolume += bars[j].close * bars[j].volume;
        sumVolume += bars[j].volume;
      }

      result.push(sumVolume > 0 ? sumPriceVolume / sumVolume : bars[i].close);
    }
  }

  return result;
}

// ============================================
// MOMENTUM INDICATORS
// ============================================

/**
 * Relative Strength Index (RSI)
 */
export function RSI(data: number[], period: number = 14): number[] {
  const result: number[] = [];
  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      gains.push(0);
      losses.push(0);
      result.push(50);
      continue;
    }

    const change = data[i] - data[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);

    if (i < period) {
      result.push(50);
      continue;
    }

    // Calculate average gains and losses
    let avgGain: number;
    let avgLoss: number;

    if (i === period) {
      avgGain = mean(gains.slice(1, period + 1));
      avgLoss = mean(losses.slice(1, period + 1));
    } else {
      const prevAvgGain = (result[i - 1] === 100 ? Infinity : result[i - 1] / (100 - result[i - 1])) * 1;
      avgGain = (prevAvgGain * (period - 1) + gains[i]) / period;
      avgLoss = (prevAvgGain * (period - 1) + losses[i]) / period;
    }

    if (avgLoss === 0) {
      result.push(100);
    } else {
      const rs = avgGain / avgLoss;
      result.push(100 - (100 / (1 + rs)));
    }
  }

  // Recalculate with Wilder's smoothing
  const rsiResult: number[] = new Array(data.length).fill(NaN);
  let avgGain = 0;
  let avgLoss = 0;

  // First RSI value
  for (let i = 1; i <= period; i++) {
    const change = data[i] - data[i - 1];
    avgGain += change > 0 ? change : 0;
    avgLoss += change < 0 ? -change : 0;
  }
  avgGain /= period;
  avgLoss /= period;

  if (avgLoss === 0) {
    rsiResult[period] = 100;
  } else {
    rsiResult[period] = 100 - (100 / (1 + avgGain / avgLoss));
  }

  // Subsequent values
  for (let i = period + 1; i < data.length; i++) {
    const change = data[i] - data[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) {
      rsiResult[i] = 100;
    } else {
      rsiResult[i] = 100 - (100 / (1 + avgGain / avgLoss));
    }
  }

  return rsiResult;
}

/**
 * Stochastic Oscillator
 */
export function STOCHASTIC(
  bars: BarData[],
  kPeriod: number = 14,
  dPeriod: number = 3,
  smoothK: number = 3
): { k: number[]; d: number[] } {
  const rawK: number[] = [];

  for (let i = 0; i < bars.length; i++) {
    if (i < kPeriod - 1) {
      rawK.push(NaN);
      continue;
    }

    const slice = bars.slice(i - kPeriod + 1, i + 1);
    const highestHigh = Math.max(...slice.map(b => b.high));
    const lowestLow = Math.min(...slice.map(b => b.low));
    const close = bars[i].close;

    if (highestHigh === lowestLow) {
      rawK.push(50);
    } else {
      rawK.push(((close - lowestLow) / (highestHigh - lowestLow)) * 100);
    }
  }

  // Smooth %K
  const k = SMA(rawK.map(v => isNaN(v) ? 50 : v), smoothK);

  // %D is SMA of %K
  const d = SMA(k.map(v => isNaN(v) ? 50 : v), dPeriod);

  return { k, d };
}

/**
 * MACD - Moving Average Convergence Divergence
 */
export function MACD(
  data: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): { macd: number[]; signal: number[]; histogram: number[] } {
  const fastEMA = EMA(data, fastPeriod);
  const slowEMA = EMA(data, slowPeriod);

  const macd: number[] = [];
  for (let i = 0; i < data.length; i++) {
    macd.push(fastEMA[i] - slowEMA[i]);
  }

  const signal = EMA(macd, signalPeriod);

  const histogram: number[] = [];
  for (let i = 0; i < data.length; i++) {
    histogram.push(macd[i] - signal[i]);
  }

  return { macd, signal, histogram };
}

/**
 * Rate of Change (ROC)
 */
export function ROC(data: number[], period: number = 10): number[] {
  const result: number[] = [];

  for (let i = 0; i < data.length; i++) {
    if (i < period) {
      result.push(NaN);
    } else {
      const prev = data[i - period];
      result.push(prev !== 0 ? ((data[i] - prev) / prev) * 100 : 0);
    }
  }

  return result;
}

// ============================================
// VOLATILITY INDICATORS
// ============================================

/**
 * Average True Range (ATR)
 */
export function ATR(bars: BarData[], period: number = 14): number[] {
  const trueRanges: number[] = [];

  for (let i = 0; i < bars.length; i++) {
    if (i === 0) {
      trueRanges.push(bars[i].high - bars[i].low);
    } else {
      const tr = Math.max(
        bars[i].high - bars[i].low,
        Math.abs(bars[i].high - bars[i - 1].close),
        Math.abs(bars[i].low - bars[i - 1].close)
      );
      trueRanges.push(tr);
    }
  }

  // Use Wilder's smoothing (similar to EMA)
  const result: number[] = [];
  let atr = 0;

  for (let i = 0; i < bars.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else if (i === period - 1) {
      atr = mean(trueRanges.slice(0, period));
      result.push(atr);
    } else {
      atr = (atr * (period - 1) + trueRanges[i]) / period;
      result.push(atr);
    }
  }

  return result;
}

/**
 * Bollinger Bands
 */
export function BOLLINGER(
  data: number[],
  period: number = 20,
  stdDevMultiplier: number = 2
): { upper: number[]; middle: number[]; lower: number[] } {
  const middle = SMA(data, period);
  const upper: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      upper.push(NaN);
      lower.push(NaN);
    } else {
      const slice = data.slice(i - period + 1, i + 1);
      const std = stdDev(slice);
      upper.push(middle[i] + stdDevMultiplier * std);
      lower.push(middle[i] - stdDevMultiplier * std);
    }
  }

  return { upper, middle, lower };
}

/**
 * Keltner Channels
 */
export function KELTNER(
  bars: BarData[],
  emaPeriod: number = 20,
  atrPeriod: number = 10,
  multiplier: number = 2
): { upper: number[]; middle: number[]; lower: number[] } {
  const closes = bars.map(b => b.close);
  const middle = EMA(closes, emaPeriod);
  const atr = ATR(bars, atrPeriod);

  const upper: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < bars.length; i++) {
    if (isNaN(middle[i]) || isNaN(atr[i])) {
      upper.push(NaN);
      lower.push(NaN);
    } else {
      upper.push(middle[i] + multiplier * atr[i]);
      lower.push(middle[i] - multiplier * atr[i]);
    }
  }

  return { upper, middle, lower };
}

// ============================================
// VOLUME INDICATORS
// ============================================

/**
 * On-Balance Volume (OBV)
 */
export function OBV(bars: BarData[]): number[] {
  const result: number[] = [];

  for (let i = 0; i < bars.length; i++) {
    if (i === 0) {
      result.push(bars[i].volume);
    } else {
      if (bars[i].close > bars[i - 1].close) {
        result.push(result[i - 1] + bars[i].volume);
      } else if (bars[i].close < bars[i - 1].close) {
        result.push(result[i - 1] - bars[i].volume);
      } else {
        result.push(result[i - 1]);
      }
    }
  }

  return result;
}

/**
 * Volume Weighted Average Price (VWAP)
 */
export function VWAP(bars: BarData[]): number[] {
  const result: number[] = [];
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;

  for (let i = 0; i < bars.length; i++) {
    const typicalPrice = (bars[i].high + bars[i].low + bars[i].close) / 3;
    cumulativeTPV += typicalPrice * bars[i].volume;
    cumulativeVolume += bars[i].volume;

    result.push(cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : typicalPrice);
  }

  return result;
}

/**
 * Money Flow Index (MFI)
 */
export function MFI(bars: BarData[], period: number = 14): number[] {
  const result: number[] = [];
  const typicalPrices: number[] = [];
  const moneyFlows: number[] = [];

  for (let i = 0; i < bars.length; i++) {
    const tp = (bars[i].high + bars[i].low + bars[i].close) / 3;
    typicalPrices.push(tp);

    if (i === 0) {
      moneyFlows.push(0);
      result.push(50);
      continue;
    }

    const rawMoneyFlow = tp * bars[i].volume;
    const direction = tp > typicalPrices[i - 1] ? 1 : tp < typicalPrices[i - 1] ? -1 : 0;
    moneyFlows.push(rawMoneyFlow * direction);

    if (i < period) {
      result.push(50);
      continue;
    }

    const slice = moneyFlows.slice(i - period + 1, i + 1);
    const positiveFlow = sum(slice.filter(f => f > 0));
    const negativeFlow = Math.abs(sum(slice.filter(f => f < 0)));

    if (negativeFlow === 0) {
      result.push(100);
    } else {
      const moneyRatio = positiveFlow / negativeFlow;
      result.push(100 - (100 / (1 + moneyRatio)));
    }
  }

  return result;
}

// ============================================
// OSCILLATORS
// ============================================

/**
 * Average Directional Index (ADX)
 */
export function ADX(
  bars: BarData[],
  period: number = 14
): { adx: number[]; diPlus: number[]; diMinus: number[] } {
  const trueRanges: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];

  for (let i = 0; i < bars.length; i++) {
    if (i === 0) {
      trueRanges.push(bars[i].high - bars[i].low);
      plusDM.push(0);
      minusDM.push(0);
      continue;
    }

    // True Range
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close)
    );
    trueRanges.push(tr);

    // Directional Movement
    const upMove = bars[i].high - bars[i - 1].high;
    const downMove = bars[i - 1].low - bars[i].low;

    if (upMove > downMove && upMove > 0) {
      plusDM.push(upMove);
      minusDM.push(0);
    } else if (downMove > upMove && downMove > 0) {
      plusDM.push(0);
      minusDM.push(downMove);
    } else {
      plusDM.push(0);
      minusDM.push(0);
    }
  }

  // Smooth using Wilder's method
  const smoothTR: number[] = [];
  const smoothPlusDM: number[] = [];
  const smoothMinusDM: number[] = [];
  const diPlus: number[] = [];
  const diMinus: number[] = [];
  const dx: number[] = [];

  for (let i = 0; i < bars.length; i++) {
    if (i < period - 1) {
      smoothTR.push(NaN);
      smoothPlusDM.push(NaN);
      smoothMinusDM.push(NaN);
      diPlus.push(NaN);
      diMinus.push(NaN);
      dx.push(NaN);
    } else if (i === period - 1) {
      smoothTR.push(sum(trueRanges.slice(0, period)));
      smoothPlusDM.push(sum(plusDM.slice(0, period)));
      smoothMinusDM.push(sum(minusDM.slice(0, period)));

      const di_plus = (smoothPlusDM[i] / smoothTR[i]) * 100;
      const di_minus = (smoothMinusDM[i] / smoothTR[i]) * 100;
      diPlus.push(di_plus);
      diMinus.push(di_minus);

      const diSum = di_plus + di_minus;
      dx.push(diSum > 0 ? (Math.abs(di_plus - di_minus) / diSum) * 100 : 0);
    } else {
      const prevTR = smoothTR[i - 1];
      const prevPlusDM = smoothPlusDM[i - 1];
      const prevMinusDM = smoothMinusDM[i - 1];

      smoothTR.push(prevTR - prevTR / period + trueRanges[i]);
      smoothPlusDM.push(prevPlusDM - prevPlusDM / period + plusDM[i]);
      smoothMinusDM.push(prevMinusDM - prevMinusDM / period + minusDM[i]);

      const di_plus = smoothTR[i] > 0 ? (smoothPlusDM[i] / smoothTR[i]) * 100 : 0;
      const di_minus = smoothTR[i] > 0 ? (smoothMinusDM[i] / smoothTR[i]) * 100 : 0;
      diPlus.push(di_plus);
      diMinus.push(di_minus);

      const diSum = di_plus + di_minus;
      dx.push(diSum > 0 ? (Math.abs(di_plus - di_minus) / diSum) * 100 : 0);
    }
  }

  // Calculate ADX as smoothed DX
  const adx: number[] = [];
  let adxValue = 0;

  for (let i = 0; i < bars.length; i++) {
    if (i < 2 * period - 2) {
      adx.push(NaN);
    } else if (i === 2 * period - 2) {
      adxValue = mean(dx.slice(period - 1, 2 * period - 1).filter(v => !isNaN(v)));
      adx.push(adxValue);
    } else {
      adxValue = (adxValue * (period - 1) + dx[i]) / period;
      adx.push(adxValue);
    }
  }

  return { adx, diPlus, diMinus };
}

/**
 * Aroon Indicator
 */
export function AROON(
  bars: BarData[],
  period: number = 25
): { aroonUp: number[]; aroonDown: number[] } {
  const aroonUp: number[] = [];
  const aroonDown: number[] = [];

  for (let i = 0; i < bars.length; i++) {
    if (i < period) {
      aroonUp.push(NaN);
      aroonDown.push(NaN);
      continue;
    }

    const slice = bars.slice(i - period, i + 1);
    const highs = slice.map(b => b.high);
    const lows = slice.map(b => b.low);

    const highestIdx = highs.indexOf(Math.max(...highs));
    const lowestIdx = lows.indexOf(Math.min(...lows));

    aroonUp.push(((period - (period - highestIdx)) / period) * 100);
    aroonDown.push(((period - (period - lowestIdx)) / period) * 100);
  }

  return { aroonUp, aroonDown };
}

/**
 * Commodity Channel Index (CCI)
 */
export function CCI(bars: BarData[], period: number = 20): number[] {
  const result: number[] = [];
  const typicalPrices: number[] = bars.map(b => (b.high + b.low + b.close) / 3);

  for (let i = 0; i < bars.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }

    const slice = typicalPrices.slice(i - period + 1, i + 1);
    const smaTP = mean(slice);
    const meanDeviation = mean(slice.map(tp => Math.abs(tp - smaTP)));

    if (meanDeviation === 0) {
      result.push(0);
    } else {
      result.push((typicalPrices[i] - smaTP) / (0.015 * meanDeviation));
    }
  }

  return result;
}

// ============================================
// INDICATOR WRAPPER
// ============================================

export interface IndicatorInput {
  bars: BarData[];
  name: string;
  params: Record<string, unknown>;
}

export interface IndicatorOutput {
  values: Record<string, number[]>;
}

/**
 * Calculate any indicator by name
 */
export function calculateIndicator(input: IndicatorInput): IndicatorOutput {
  const { bars, name, params } = input;
  const closes = bars.map(b => b.close);

  switch (name.toUpperCase()) {
    case 'SMA': {
      const period = (params.period as number) || 20;
      return { values: { sma: SMA(closes, period) } };
    }
    case 'EMA': {
      const period = (params.period as number) || 20;
      return { values: { ema: EMA(closes, period) } };
    }
    case 'WMA': {
      const period = (params.period as number) || 20;
      return { values: { wma: WMA(closes, period) } };
    }
    case 'VWMA': {
      const period = (params.period as number) || 20;
      return { values: { vwma: VWMA(bars, period) } };
    }
    case 'RSI': {
      const period = (params.period as number) || 14;
      return { values: { rsi: RSI(closes, period) } };
    }
    case 'STOCHASTIC':
    case 'STOCH': {
      const kPeriod = (params.k_period as number) || 14;
      const dPeriod = (params.d_period as number) || 3;
      const smoothK = (params.smooth_k as number) || 3;
      const result = STOCHASTIC(bars, kPeriod, dPeriod, smoothK);
      return { values: { k: result.k, d: result.d } };
    }
    case 'MACD': {
      const fastPeriod = (params.fast_period as number) || 12;
      const slowPeriod = (params.slow_period as number) || 26;
      const signalPeriod = (params.signal_period as number) || 9;
      const result = MACD(closes, fastPeriod, slowPeriod, signalPeriod);
      return { values: result };
    }
    case 'ROC': {
      const period = (params.period as number) || 10;
      return { values: { roc: ROC(closes, period) } };
    }
    case 'ATR': {
      const period = (params.period as number) || 14;
      return { values: { atr: ATR(bars, period) } };
    }
    case 'BOLLINGER':
    case 'BB': {
      const period = (params.period as number) || 20;
      const stdDev = (params.std_dev as number) || 2;
      const result = BOLLINGER(closes, period, stdDev);
      return { values: result };
    }
    case 'KELTNER':
    case 'KC': {
      const emaPeriod = (params.ema_period as number) || 20;
      const atrPeriod = (params.atr_period as number) || 10;
      const multiplier = (params.multiplier as number) || 2;
      const result = KELTNER(bars, emaPeriod, atrPeriod, multiplier);
      return { values: result };
    }
    case 'OBV': {
      return { values: { obv: OBV(bars) } };
    }
    case 'VWAP': {
      return { values: { vwap: VWAP(bars) } };
    }
    case 'MFI': {
      const period = (params.period as number) || 14;
      return { values: { mfi: MFI(bars, period) } };
    }
    case 'ADX': {
      const period = (params.period as number) || 14;
      const result = ADX(bars, period);
      return { values: { adx: result.adx, di_plus: result.diPlus, di_minus: result.diMinus } };
    }
    case 'AROON': {
      const period = (params.period as number) || 25;
      const result = AROON(bars, period);
      return { values: { aroon_up: result.aroonUp, aroon_down: result.aroonDown } };
    }
    case 'CCI': {
      const period = (params.period as number) || 20;
      return { values: { cci: CCI(bars, period) } };
    }
    default:
      throw new Error(`Unknown indicator: ${name}`);
  }
}

// Export all indicators
export const indicators = {
  SMA,
  EMA,
  WMA,
  VWMA,
  RSI,
  STOCHASTIC,
  MACD,
  ROC,
  ATR,
  BOLLINGER,
  KELTNER,
  OBV,
  VWAP,
  MFI,
  ADX,
  AROON,
  CCI,
  calculateIndicator,
};
