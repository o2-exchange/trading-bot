# Review Code

Perform a code review on the current staged/unstaged changes with O2-specific checks.

## Steps

1. **Get the diff** -- review all staged and unstaged changes:
   ```bash
   git diff
   git diff --cached
   ```

2. **Review each changed file** against the checklist below.

3. **Report findings** organized by severity: critical, warning, suggestion.

## Review Checklist

### Critical Issues

- **Decimal.js usage**: Are prices, quantities, and balances using `Decimal.js`? Never `number` or `parseFloat` for financial math.
  ```typescript
  // BAD
  const total = price * quantity
  // GOOD
  const total = new Decimal(price).mul(quantity)
  ```

- **Private key exposure**: Are any private keys, session keys, or secrets logged, stored in plain text, or exposed in UI?

- **B256 address format**: Is `O2-Owner-Id` header using B256 format (64-char hex, 0x-prefixed) for all O2 API calls?

- **Nonce management**: Are order operations fetching fresh nonces before submission? No cached/stale nonces for transactions.

### Warning Issues

- **Error handling**: Do try-catch blocks have descriptive error messages with service name prefix?
  ```typescript
  console.error('[ServiceName] Failed to do thing:', error)
  ```

- **Cache invalidation**: Are caches cleared after state-changing operations (order placement, deposits, session creation)?

- **Rate limit safety**: Are API calls going through `o2ApiService` (which has the 429 retry interceptor)? No direct axios/fetch calls.

- **Address normalization**: Are addresses lowercased and typed as `` `0x${string}` ``?

### Suggestions

- **i18n**: Are all new user-visible strings using `t()` from `useTranslation()`? Check all 5 locale files updated.

- **Store pattern**: Do new stores follow the triple middleware pattern (immer + persist + subscribeWithSelector)?

- **Service pattern**: Are new services exported as singleton instances at module level?

- **Type safety**: Are new types properly defined and exported from `src/types/`?

- **Import aliases**: Using `@/` instead of relative paths where appropriate?

## Output Format

```
## Code Review: [files reviewed]

### Critical
- [file:line] Description of critical issue

### Warnings
- [file:line] Description of warning

### Suggestions
- [file:line] Description of suggestion

### Summary
X critical, Y warnings, Z suggestions
```
