# Debug Trading: $ARGUMENTS

Debug a trading engine issue: `$ARGUMENTS`

## Investigation Steps

### 1. Trace the Execution Flow

Read these files in order to trace the issue through the trading pipeline:

1. **`src/services/tradingEngine.ts`** -- Entry point. Check:
   - Is the engine running? Check `isRunning` state
   - Is the trading cycle being triggered?
   - Are callbacks registered correctly?
   - Any errors caught at the top level?

2. **`src/services/unifiedStrategyExecutor.ts`** -- Strategy logic. Check:
   - Spread calculation: Is `maxSpreadPercent` being exceeded?
   - Price mode: Is the reference price correct (mid, bestBid, bestAsk)?
   - Position sizing: Are balances sufficient for the order size?
   - Side filtering: Is `onlySellAboveBuyPrice` blocking sells?
   - Skip reasons in `StrategyExecutionResult.skipReason`

3. **`src/services/orderService.ts`** -- Order submission. Check:
   - **Nonce management**: Is the nonce fresh? Stale nonces cause failures
   - Order validation before submission
   - Error handling for API failures

4. **`src/services/o2ApiService.ts`** -- API calls. Check:
   - Is `O2-Owner-Id` header in B256 format?
   - Are request bodies correctly structured?
   - HTTP status codes (429 = rate limited, 400 = bad request)

5. **`src/services/orderFulfillmentService.ts`** + **`orderFulfillmentPolling.ts`** -- Fill tracking. Check:
   - Is polling running?
   - Are fill callbacks firing?
   - Order status transitions

### 2. Check Caches and State

| Service | Cache | TTL | Issue if stale |
|---------|-------|-----|----------------|
| `balanceService.ts` | Balance cache | 3s | Orders sized on outdated balance |
| `sessionService.ts` | Session validation | 30s | Session expired but cached as valid |
| `marketService.ts` | Market data | In-memory | Stale prices, wrong spread calc |

### 3. Check Strategy Configuration

Read `src/types/strategy.ts` and the active strategy config:
- `orderConfig.orderType` -- Market vs Spot
- `orderConfig.maxSpreadPercent` -- May be too tight
- `riskManagement.takeProfitPercent` -- May block trades (min 0.02% for fees)
- `riskManagement.maxSessionLossEnabled` -- May have paused trading
- `timing.cycleIntervalMinMs` -- May be too fast, causing rate limits

### 4. Check P&L and Risk Limits

- `dbService.ts` -- IndexedDB trade records
- Session P&L tracking -- check if `maxSessionLossUsd` threshold was hit
- Average buy/sell price calculation

### 5. Common Issues

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Orders fail silently | Nonce desync | Fetch fresh nonce from API |
| No orders placed | Spread too wide | Check `maxSpreadPercent` vs current spread |
| Sells never happen | `onlySellAboveBuyPrice` blocking | Check average buy price vs current price |
| Rate limit errors | Cycle too fast | Increase `cycleIntervalMinMs` |
| Session invalid | Session expired | Check session expiry, re-create session |
| Wrong order size | Stale balance | Clear balance cache, check `balanceService` |
| P&L incorrect | Fee not accounted | Check 0.01% fee per trade in calculations |

## Checklist

- [ ] Identified which stage of the pipeline the issue occurs
- [ ] Checked nonce state in `orderService`
- [ ] Verified cache freshness (balance 3s, session 30s)
- [ ] Reviewed strategy config for restrictive settings
- [ ] Checked API response for error details
- [ ] Verified session validity
- [ ] Checked P&L / risk limits haven't paused trading
