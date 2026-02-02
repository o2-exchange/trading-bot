# Add Type: $ARGUMENTS

Add new TypeScript type definitions for `$ARGUMENTS`.

## Steps

1. **Read existing type files** to understand conventions:
   - `src/types/order.ts` -- Enums and interfaces for orders
   - `src/types/market.ts` -- Market data types
   - `src/types/strategy.ts` -- Complex config types
   - `src/types/o2-api-types.ts` -- API response types (snake_case)
   - `src/types/tradingAccount.ts` -- Account types

2. **Determine the correct file** for the new types:
   - If related to an existing domain, add to that file (e.g., order types -> `order.ts`)
   - If a new domain, create a new file at `src/types/$ARGUMENTS.ts`

3. **Define the types** following project conventions:
   - **PascalCase** for interface and type names
   - **snake_case** for API response fields (matching O2 API)
   - **camelCase** for internal/frontend fields
   - Export all types from the file

4. **Add API response mapping** if the type represents external data:
   ```typescript
   // API response type (matches API field names)
   export interface ${ARGUMENTS}ApiResponse {
     field_name: string  // snake_case
   }

   // Internal type (used in app code)
   export interface $ARGUMENTS {
     fieldName: string   // camelCase
   }
   ```

5. **Update imports** in services/components that will use the new types.

## Type Conventions

- **Interfaces** for object shapes: `interface OrderConfig { ... }`
- **Type unions** for string literals: `type OrderSide = 'Buy' | 'Sell'`
- **Enums** for values with runtime representation: `enum OrderStatus { Open, Filled, ... }`
- **Records** for maps: `Record<string, MarketTicker>`
- **Address type**: `` `0x${string}` `` for blockchain addresses
- **Decimal fields**: Use `string` type for price/quantity (parsed with `Decimal.js` at runtime)

## Checklist

- [ ] Types placed in the correct file under `src/types/`
- [ ] PascalCase for type/interface names
- [ ] API types use snake_case field names
- [ ] Internal types use camelCase field names
- [ ] All types exported
- [ ] Price/quantity fields typed as `string` (for Decimal.js usage)
- [ ] Address fields use `` `0x${string}` `` type
- [ ] Mapping function provided if converting between API and internal types
