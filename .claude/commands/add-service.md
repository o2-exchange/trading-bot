# Add Service: $ARGUMENTS

Create a new service module named `$ARGUMENTS` following O2 project patterns.

## Steps

1. **Read existing service examples** for patterns:
   - `src/services/o2ApiService.ts` (API client, singleton, typed requests/responses)
   - `src/services/marketService.ts` (in-memory caching pattern)
   - `src/services/balanceService.ts` (TTL-based cache, 3s expiry)

2. **Create the service file** at `src/services/${ARGUMENTS}Service.ts`:
   - Singleton class exported as module-level instance
   - Proper error handling with try-catch and descriptive messages
   - TypeScript types for all method signatures
   - In-memory caching where appropriate (follow `marketService.ts` pattern)

3. **Add types** in `src/types/` if the service introduces new data structures.

4. **Wire up** the service in relevant components or other services.

## Service Template

```typescript
import { o2ApiService } from './o2ApiService'

class ${ARGUMENTS}Service {
  private cache: Map<string, { data: any; timestamp: number }> = new Map()
  private readonly CACHE_TTL_MS = 5000 // 5s default

  async getData(id: string): Promise<SomeType> {
    // Check cache
    const cached = this.cache.get(id)
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.data
    }

    try {
      const result = await o2ApiService.someMethod(id)
      this.cache.set(id, { data: result, timestamp: Date.now() })
      return result
    } catch (error) {
      console.error(`[${ARGUMENTS}Service] Failed to get data for ${id}:`, error)
      throw error
    }
  }

  clearCache() {
    this.cache.clear()
  }
}

export const ${ARGUMENTS}Service = new ${ARGUMENTS}Service()
```

## Checklist

- [ ] Class follows singleton pattern with module-level export
- [ ] All methods have proper TypeScript return types
- [ ] Error handling with try-catch and `console.error` with service name prefix
- [ ] In-memory caching with TTL where appropriate
- [ ] Types defined in `src/types/` for any new data structures
- [ ] No floating-point math -- use `Decimal.js` for prices/quantities
- [ ] B256 format used for any O2 API headers (`O2-Owner-Id`)
