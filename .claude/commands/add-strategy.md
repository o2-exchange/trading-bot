# Add Strategy: $ARGUMENTS

Add a new trading strategy preset named `$ARGUMENTS` to the O2 trading bot.

## Steps

1. **Read the strategy types and presets**:
   - `src/types/strategy.ts` -- `StrategyPreset` type, `STRATEGY_PRESET_LABELS`, `STRATEGY_PRESET_DESCRIPTIONS`, `getPresetStrategyConfig()`

2. **Update `StrategyPreset` union type** in `src/types/strategy.ts`:
   ```typescript
   export type StrategyPreset = 'simple' | 'volumeMaximizing' | 'profitTaking' | '$ARGUMENTS' | 'custom'
   ```
   Keep `custom` as the last option.

3. **Add label** to `STRATEGY_PRESET_LABELS`:
   ```typescript
   $ARGUMENTS: 'Display Name',
   ```

4. **Add description** to `STRATEGY_PRESET_DESCRIPTIONS`:
   ```typescript
   $ARGUMENTS: 'Brief description of the strategy behavior',
   ```

5. **Add case** to `getPresetStrategyConfig()` switch statement:
   ```typescript
   case '$ARGUMENTS':
     return {
       ...base,
       name: 'Strategy Display Name',
       orderConfig: { ...base.orderConfig, /* customize */ },
       positionSizing: { ...base.positionSizing, /* customize */ },
       orderManagement: { ...base.orderManagement, /* customize */ },
       riskManagement: { ...base.riskManagement, /* customize */ },
       timing: { ...base.timing, /* customize */ },
     }
   ```

6. **Update UI** in `src/components/StrategyConfig.tsx`:
   - Add the new preset option to the preset selector

7. **Add i18n keys** to all 5 locale files (`src/locales/{en,ja,ko,zh-cn,zh-hk}.json`):
   - Strategy name and description translation keys

## Strategy Config Reference

Key parameters to configure for the new preset:
- `orderConfig.orderType`: `'Market'` or `'Spot'` (limit)
- `orderConfig.priceMode`: `'offsetFromMid'` | `'offsetFromBestBid'` | `'offsetFromBestAsk'` | `'market'`
- `orderConfig.priceOffsetPercent`: % offset from reference price
- `orderConfig.maxSpreadPercent`: Max spread to trade at
- `orderConfig.side`: `'Buy'` | `'Sell'` | `'Both'`
- `positionSizing.baseBalancePercentage` / `quoteBalancePercentage`: % of balance to use
- `orderManagement.onlySellAboveBuyPrice`: Profit protection toggle
- `riskManagement.takeProfitPercent`: Min profit margin (0.02% covers fees)
- `timing.cycleIntervalMinMs` / `cycleIntervalMaxMs`: Cycle speed

## Checklist

- [ ] `StrategyPreset` type updated (keep `custom` last)
- [ ] Label added to `STRATEGY_PRESET_LABELS`
- [ ] Description added to `STRATEGY_PRESET_DESCRIPTIONS`
- [ ] Case added to `getPresetStrategyConfig()` with all config sections
- [ ] UI updated in `StrategyConfig.tsx`
- [ ] i18n keys added to all 5 locale files
- [ ] Strategy config values make logical sense (e.g., profitTaking >= 0.02% to cover fees)
