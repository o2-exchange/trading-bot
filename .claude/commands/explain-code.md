# Explain Code: $ARGUMENTS

Explain the code at `$ARGUMENTS` (file path, module, or concept).

## Steps

1. **Read the target code** -- open the file or find the relevant module:
   - If a file path: read the file
   - If a concept (e.g., "trading engine", "session management"): find the relevant files

2. **Explain the purpose**:
   - What does this code do?
   - What problem does it solve?
   - Why does it exist?

3. **Trace the data flow**:
   - What calls this code? (callers / entry points)
   - What does this code call? (dependencies / downstream)
   - How does data flow through it?

4. **Document key patterns**:
   - What design patterns are used and why?
   - Any non-obvious implementation choices?
   - Caching, retry, or error handling strategies?

5. **Note gotchas and non-obvious behavior**:
   - Edge cases
   - Timing dependencies
   - Cache TTLs that affect behavior
   - State that must be managed carefully

6. **Show the call chain**:
   ```
   caller -> this code -> downstream dependency
   ```

## Key Reference Points

| Area | Files |
|------|-------|
| Trading engine | `src/services/tradingEngine.ts` |
| Strategy execution | `src/services/unifiedStrategyExecutor.ts` |
| Order management | `src/services/orderService.ts` |
| API client | `src/services/o2ApiService.ts` |
| Order fulfillment | `src/services/orderFulfillmentService.ts`, `orderFulfillmentPolling.ts` |
| Balance | `src/services/balanceService.ts` |
| Sessions | `src/services/sessionService.ts`, `sessionManagerService.ts` |
| Wallet | `src/services/walletService.ts` |
| Auth flow | `src/services/authFlowService.ts` |
| Deposits | `src/services/deposit/` |
| Market data | `src/services/marketService.ts` |
| Trade history | `src/services/tradeHistoryService.ts` |
| DB persistence | `src/services/dbService.ts` |
| Analytics | `src/services/analyticsService.ts` |
| Strategy types | `src/types/strategy.ts` |
| Store pattern | `src/stores/useSessionStore.ts` |
| Encryption | `src/utils/encryption.ts` |
| Price formatting | `src/utils/priceFormatter.ts` |

## Output Format

```
## [File/Module Name]

### Purpose
What it does and why.

### Data Flow
What calls it -> This module -> What it calls

### Key Patterns
- Pattern 1: explanation
- Pattern 2: explanation

### Gotchas
- Non-obvious behavior 1
- Non-obvious behavior 2

### Related Files
- file1.ts -- relationship
- file2.ts -- relationship
```
