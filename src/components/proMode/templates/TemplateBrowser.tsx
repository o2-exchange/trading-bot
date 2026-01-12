/**
 * Template Browser Component
 * Browse and select strategy templates
 */

import { useState } from 'react';
import {
  CustomStrategy,
  TemplateCategory,
  TEMPLATE_CATEGORY_LABELS,
  DEFAULT_SANDBOX_CONFIG,
} from '../../../types/proMode';

interface TemplateBrowserProps {
  onSelectTemplate: (template: CustomStrategy) => void;
}

// Strategy templates
const STRATEGY_TEMPLATES: Array<{
  name: string;
  description: string;
  category: TemplateCategory;
  pythonCode: string;
}> = [
  {
    name: 'SMA Crossover',
    description: 'Classic moving average crossover strategy. Buy when fast SMA crosses above slow SMA, sell when it crosses below.',
    category: 'trend-following',
    pythonCode: `"""
SMA Crossover Strategy
Buy when fast SMA crosses above slow SMA
Sell when fast SMA crosses below slow SMA
"""

class Strategy:
    def __init__(self, context):
        self.context = context
        self.fast_period = context.params.get('fast_period', 10)
        self.slow_period = context.params.get('slow_period', 30)
        self.prices = []

    def calculate_sma(self, period):
        if len(self.prices) < period:
            return None
        return sum(self.prices[-period:]) / period

    def on_bar(self, bar, position, orders):
        signals = []
        self.prices.append(bar.close)

        if len(self.prices) < self.slow_period + 1:
            return signals

        fast_sma = self.calculate_sma(self.fast_period)
        slow_sma = self.calculate_sma(self.slow_period)
        prev_fast = sum(self.prices[-self.fast_period-1:-1]) / self.fast_period
        prev_slow = sum(self.prices[-self.slow_period-1:-1]) / self.slow_period

        # Bullish crossover - buy
        if prev_fast <= prev_slow and fast_sma > slow_sma:
            if not position:
                signals.append({
                    'type': 'buy',
                    'quantity': 1.0,
                    'order_type': 'market',
                    'reason': 'SMA bullish crossover'
                })

        # Bearish crossover - sell
        elif prev_fast >= prev_slow and fast_sma < slow_sma:
            if position:
                signals.append({
                    'type': 'sell',
                    'quantity': position.quantity,
                    'order_type': 'market',
                    'reason': 'SMA bearish crossover'
                })

        return signals
`,
  },
  {
    name: 'RSI Overbought/Oversold',
    description: 'Buy when RSI indicates oversold conditions, sell when overbought. Great for mean reversion in ranging markets.',
    category: 'oscillator',
    pythonCode: `"""
RSI Overbought/Oversold Strategy
Buy when RSI < oversold threshold (default 30)
Sell when RSI > overbought threshold (default 70)
"""

class Strategy:
    def __init__(self, context):
        self.context = context
        self.period = context.params.get('rsi_period', 14)
        self.overbought = context.params.get('overbought', 70)
        self.oversold = context.params.get('oversold', 30)
        self.prices = []

    def calculate_rsi(self):
        if len(self.prices) < self.period + 1:
            return None

        gains = []
        losses = []

        for i in range(-self.period, 0):
            change = self.prices[i] - self.prices[i-1]
            if change > 0:
                gains.append(change)
                losses.append(0)
            else:
                gains.append(0)
                losses.append(abs(change))

        avg_gain = sum(gains) / self.period
        avg_loss = sum(losses) / self.period

        if avg_loss == 0:
            return 100

        rs = avg_gain / avg_loss
        return 100 - (100 / (1 + rs))

    def on_bar(self, bar, position, orders):
        signals = []
        self.prices.append(bar.close)

        rsi = self.calculate_rsi()
        if rsi is None:
            return signals

        # Oversold - buy signal
        if rsi < self.oversold:
            if not position:
                signals.append({
                    'type': 'buy',
                    'quantity': 1.0,
                    'order_type': 'market',
                    'reason': f'RSI oversold ({rsi:.1f})'
                })

        # Overbought - sell signal
        elif rsi > self.overbought:
            if position:
                signals.append({
                    'type': 'sell',
                    'quantity': position.quantity,
                    'order_type': 'market',
                    'reason': f'RSI overbought ({rsi:.1f})'
                })

        return signals
`,
  },
  {
    name: 'Bollinger Band Bounce',
    description: 'Mean reversion strategy using Bollinger Bands. Buy at lower band, sell at upper band or middle.',
    category: 'mean-reversion',
    pythonCode: `"""
Bollinger Band Bounce Strategy
Buy when price touches lower band
Sell when price reaches middle band or upper band
"""

class Strategy:
    def __init__(self, context):
        self.context = context
        self.period = context.params.get('bb_period', 20)
        self.std_dev = context.params.get('std_dev', 2.0)
        self.prices = []

    def calculate_bollinger(self):
        if len(self.prices) < self.period:
            return None, None, None

        recent = self.prices[-self.period:]
        middle = sum(recent) / self.period

        variance = sum((p - middle) ** 2 for p in recent) / self.period
        std = variance ** 0.5

        upper = middle + (self.std_dev * std)
        lower = middle - (self.std_dev * std)

        return upper, middle, lower

    def on_bar(self, bar, position, orders):
        signals = []
        self.prices.append(bar.close)

        upper, middle, lower = self.calculate_bollinger()
        if upper is None:
            return signals

        # Price at or below lower band - buy
        if bar.close <= lower:
            if not position:
                signals.append({
                    'type': 'buy',
                    'quantity': 1.0,
                    'order_type': 'market',
                    'reason': 'Price at lower Bollinger Band'
                })

        # Price at or above middle band - sell (conservative)
        elif bar.close >= middle:
            if position:
                signals.append({
                    'type': 'sell',
                    'quantity': position.quantity,
                    'order_type': 'market',
                    'reason': 'Price at middle Bollinger Band'
                })

        return signals
`,
  },
  {
    name: 'MACD Signal',
    description: 'Trade MACD crossovers with the signal line. A popular momentum-based strategy.',
    category: 'momentum',
    pythonCode: `"""
MACD Signal Strategy
Buy when MACD crosses above signal line
Sell when MACD crosses below signal line
"""

class Strategy:
    def __init__(self, context):
        self.context = context
        self.fast_period = context.params.get('fast_period', 12)
        self.slow_period = context.params.get('slow_period', 26)
        self.signal_period = context.params.get('signal_period', 9)
        self.prices = []
        self.prev_macd = None
        self.prev_signal = None

    def ema(self, data, period):
        if len(data) < period:
            return None
        multiplier = 2 / (period + 1)
        ema = sum(data[:period]) / period
        for price in data[period:]:
            ema = (price * multiplier) + (ema * (1 - multiplier))
        return ema

    def on_bar(self, bar, position, orders):
        signals = []
        self.prices.append(bar.close)

        if len(self.prices) < self.slow_period + self.signal_period:
            return signals

        fast_ema = self.ema(self.prices, self.fast_period)
        slow_ema = self.ema(self.prices, self.slow_period)

        if fast_ema is None or slow_ema is None:
            return signals

        macd = fast_ema - slow_ema

        # Calculate signal line (EMA of MACD)
        # For simplicity, we use a rolling average approach
        macd_values = []
        for i in range(self.signal_period):
            if len(self.prices) >= self.slow_period + i:
                f = self.ema(self.prices[:-(self.signal_period-i-1) or None], self.fast_period)
                s = self.ema(self.prices[:-(self.signal_period-i-1) or None], self.slow_period)
                if f and s:
                    macd_values.append(f - s)

        if len(macd_values) < self.signal_period:
            return signals

        signal_line = sum(macd_values) / len(macd_values)

        if self.prev_macd is not None and self.prev_signal is not None:
            # Bullish crossover
            if self.prev_macd <= self.prev_signal and macd > signal_line:
                if not position:
                    signals.append({
                        'type': 'buy',
                        'quantity': 1.0,
                        'order_type': 'market',
                        'reason': 'MACD bullish crossover'
                    })

            # Bearish crossover
            elif self.prev_macd >= self.prev_signal and macd < signal_line:
                if position:
                    signals.append({
                        'type': 'sell',
                        'quantity': position.quantity,
                        'order_type': 'market',
                        'reason': 'MACD bearish crossover'
                    })

        self.prev_macd = macd
        self.prev_signal = signal_line

        return signals
`,
  },
  {
    name: 'Breakout Strategy',
    description: 'Trade breakouts above resistance or below support using recent highs/lows.',
    category: 'breakout',
    pythonCode: `"""
Breakout Strategy
Buy when price breaks above recent high
Sell when price breaks below recent low
"""

class Strategy:
    def __init__(self, context):
        self.context = context
        self.lookback = context.params.get('lookback', 20)
        self.highs = []
        self.lows = []

    def on_bar(self, bar, position, orders):
        signals = []

        self.highs.append(bar.high)
        self.lows.append(bar.low)

        if len(self.highs) < self.lookback + 1:
            return signals

        # Get recent high/low (excluding current bar)
        recent_high = max(self.highs[-self.lookback-1:-1])
        recent_low = min(self.lows[-self.lookback-1:-1])

        # Breakout above resistance - buy
        if bar.close > recent_high:
            if not position:
                signals.append({
                    'type': 'buy',
                    'quantity': 1.0,
                    'order_type': 'market',
                    'reason': f'Breakout above {recent_high:.2f}'
                })

        # Breakdown below support - sell
        elif bar.close < recent_low:
            if position:
                signals.append({
                    'type': 'sell',
                    'quantity': position.quantity,
                    'order_type': 'market',
                    'reason': f'Breakdown below {recent_low:.2f}'
                })

        return signals
`,
  },
  {
    name: 'Mean Reversion',
    description: 'Statistical mean reversion strategy. Buy when price deviates significantly below average.',
    category: 'mean-reversion',
    pythonCode: `"""
Mean Reversion Strategy
Buy when price is significantly below moving average
Sell when price returns to mean
"""

class Strategy:
    def __init__(self, context):
        self.context = context
        self.period = context.params.get('period', 20)
        self.entry_threshold = context.params.get('entry_threshold', 2.0)  # Std devs
        self.exit_threshold = context.params.get('exit_threshold', 0.5)
        self.prices = []

    def on_bar(self, bar, position, orders):
        signals = []
        self.prices.append(bar.close)

        if len(self.prices) < self.period:
            return signals

        recent = self.prices[-self.period:]
        mean = sum(recent) / self.period
        variance = sum((p - mean) ** 2 for p in recent) / self.period
        std = variance ** 0.5

        if std == 0:
            return signals

        z_score = (bar.close - mean) / std

        # Price significantly below mean - buy
        if z_score < -self.entry_threshold:
            if not position:
                signals.append({
                    'type': 'buy',
                    'quantity': 1.0,
                    'order_type': 'market',
                    'reason': f'Mean reversion entry (z={z_score:.2f})'
                })

        # Price returned to mean - sell
        elif abs(z_score) < self.exit_threshold:
            if position:
                signals.append({
                    'type': 'sell',
                    'quantity': position.quantity,
                    'order_type': 'market',
                    'reason': 'Price returned to mean'
                })

        return signals
`,
  },
  {
    name: 'Momentum Strategy',
    description: 'Trade in the direction of price momentum using rate of change.',
    category: 'momentum',
    pythonCode: `"""
Momentum Strategy
Buy when momentum is strong and positive
Sell when momentum turns negative
"""

class Strategy:
    def __init__(self, context):
        self.context = context
        self.lookback = context.params.get('lookback', 10)
        self.threshold = context.params.get('threshold', 2.0)  # Percent
        self.prices = []

    def on_bar(self, bar, position, orders):
        signals = []
        self.prices.append(bar.close)

        if len(self.prices) < self.lookback + 1:
            return signals

        # Calculate rate of change
        past_price = self.prices[-self.lookback - 1]
        roc = ((bar.close - past_price) / past_price) * 100

        # Strong positive momentum - buy
        if roc > self.threshold:
            if not position:
                signals.append({
                    'type': 'buy',
                    'quantity': 1.0,
                    'order_type': 'market',
                    'reason': f'Strong momentum ({roc:.2f}%)'
                })

        # Negative momentum - sell
        elif roc < 0:
            if position:
                signals.append({
                    'type': 'sell',
                    'quantity': position.quantity,
                    'order_type': 'market',
                    'reason': f'Momentum turned negative ({roc:.2f}%)'
                })

        return signals
`,
  },
  {
    name: 'DCA (Dollar Cost Average)',
    description: 'Systematic buying at regular intervals regardless of price. Good for long-term accumulation.',
    category: 'statistical',
    pythonCode: `"""
Dollar Cost Averaging (DCA) Strategy
Buy fixed amount at regular intervals
Optionally sell when profit target is reached
"""

class Strategy:
    def __init__(self, context):
        self.context = context
        self.buy_interval = context.params.get('buy_interval', 24)  # Bars
        self.profit_target = context.params.get('profit_target', 10.0)  # Percent
        self.bars_since_buy = 0

    def on_bar(self, bar, position, orders):
        signals = []
        self.bars_since_buy += 1

        # Regular buy
        if self.bars_since_buy >= self.buy_interval:
            signals.append({
                'type': 'buy',
                'quantity': 0.1,  # Fixed quantity
                'order_type': 'market',
                'reason': 'DCA scheduled buy'
            })
            self.bars_since_buy = 0

        # Optional profit taking
        if position and self.profit_target > 0:
            profit_pct = position.unrealized_pnl_percent if hasattr(position, 'unrealized_pnl_percent') else 0
            if profit_pct >= self.profit_target:
                signals.append({
                    'type': 'sell',
                    'quantity': position.quantity * 0.5,  # Sell half
                    'order_type': 'market',
                    'reason': f'Profit target reached ({profit_pct:.1f}%)'
                })

        return signals
`,
  },
  {
    name: 'Grid Trading',
    description: 'Place buy and sell orders at fixed price intervals. Profits from price oscillation.',
    category: 'market-making',
    pythonCode: `"""
Grid Trading Strategy
Place orders at fixed price intervals
Profits from price oscillation within a range
"""

class Strategy:
    def __init__(self, context):
        self.context = context
        self.grid_size = context.params.get('grid_size', 1.0)  # Percent
        self.last_trade_price = None

    def on_bar(self, bar, position, orders):
        signals = []

        if self.last_trade_price is None:
            # Initialize with first buy
            self.last_trade_price = bar.close
            signals.append({
                'type': 'buy',
                'quantity': 0.5,
                'order_type': 'market',
                'reason': 'Grid initialization'
            })
            return signals

        price_change_pct = ((bar.close - self.last_trade_price) / self.last_trade_price) * 100

        # Price dropped by grid size - buy more
        if price_change_pct <= -self.grid_size:
            signals.append({
                'type': 'buy',
                'quantity': 0.5,
                'order_type': 'market',
                'reason': f'Grid buy (price down {abs(price_change_pct):.1f}%)'
            })
            self.last_trade_price = bar.close

        # Price rose by grid size - sell some
        elif price_change_pct >= self.grid_size:
            if position and position.quantity > 0.1:
                signals.append({
                    'type': 'sell',
                    'quantity': min(0.5, position.quantity),
                    'order_type': 'market',
                    'reason': f'Grid sell (price up {price_change_pct:.1f}%)'
                })
                self.last_trade_price = bar.close

        return signals
`,
  },
  {
    name: 'Custom Blank Template',
    description: 'Start from scratch with a clean template. Full control over your strategy logic.',
    category: 'custom',
    pythonCode: `"""
Custom Strategy Template
Build your own trading logic from scratch
"""

class Strategy:
    def __init__(self, context):
        """
        Initialize your strategy here.

        Available via context:
        - context.params: Your custom parameters
        - context.indicators: Indicator library
        """
        self.context = context
        # Add your initialization code here

    def on_bar(self, bar, position, orders):
        """
        Called on each new bar.

        Args:
            bar: { open, high, low, close, volume, timestamp }
            position: Current position or None
            orders: List of open orders

        Returns:
            List of signals
        """
        signals = []

        # Add your trading logic here
        # Example:
        # if some_condition:
        #     signals.append({
        #         'type': 'buy',
        #         'quantity': 1.0,
        #         'order_type': 'market',
        #         'reason': 'My reason'
        #     })

        return signals
`,
  },
];

export default function TemplateBrowser({ onSelectTemplate }: TemplateBrowserProps) {
  const [selectedCategory, setSelectedCategory] = useState<TemplateCategory | 'all'>('all');

  const categories: Array<TemplateCategory | 'all'> = [
    'all',
    'trend-following',
    'momentum',
    'mean-reversion',
    'oscillator',
    'breakout',
    'market-making',
    'statistical',
    'custom',
  ];

  const filteredTemplates = selectedCategory === 'all'
    ? STRATEGY_TEMPLATES
    : STRATEGY_TEMPLATES.filter(t => t.category === selectedCategory);

  const handleSelectTemplate = (template: typeof STRATEGY_TEMPLATES[0]) => {
    const customStrategy: CustomStrategy = {
      id: crypto.randomUUID(),
      name: template.name,
      description: template.description,
      pythonCode: template.pythonCode,
      configValues: {},
      version: '1.0.0',
      versionHistory: [],
      tags: [template.category],
      status: 'draft',
      isTemplate: false,
      templateCategory: template.category,
      sandboxConfig: { ...DEFAULT_SANDBOX_CONFIG },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    onSelectTemplate(customStrategy);
  };

  return (
    <div className="template-browser">
      <h2>Strategy Templates</h2>
      <p className="template-browser-subtitle">
        Choose a template to get started quickly. You can customize the code after importing.
      </p>

      {/* Category Filter */}
      <div className="template-categories">
        {categories.map((category) => (
          <button
            key={category}
            className={`category-btn ${selectedCategory === category ? 'active' : ''}`}
            onClick={() => setSelectedCategory(category)}
          >
            {category === 'all' ? 'All' : TEMPLATE_CATEGORY_LABELS[category]}
          </button>
        ))}
      </div>

      {/* Template Grid */}
      <div className="template-grid">
        {filteredTemplates.map((template, index) => (
          <div key={index} className="template-card" onClick={() => handleSelectTemplate(template)}>
            <div className="template-card-header">
              <h3>{template.name}</h3>
              <span className="template-category-badge">
                {TEMPLATE_CATEGORY_LABELS[template.category]}
              </span>
            </div>
            <p>{template.description}</p>
            <div className="template-card-footer">
              <button className="use-template-btn">
                Use Template
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
