# Add Analytics Event: $ARGUMENTS

Add PostHog analytics tracking for the `$ARGUMENTS` event.

## Steps

1. **Read existing analytics patterns**:
   - `src/types/analytics.ts` -- Event type definitions
   - `src/services/analyticsService.ts` -- Analytics service with tracking methods
   - `src/hooks/useAnalytics.ts` -- React hook for analytics
   - `POSTHOG_ANALYTICS_GUIDE.md` -- Comprehensive analytics guide

2. **Define the event** in `src/types/analytics.ts`:
   - Follow existing event naming convention (snake_case)
   - Define event properties interface
   ```typescript
   export interface ${ARGUMENTS}Event {
     event: '$ARGUMENTS'
     properties: {
       // Event-specific properties
       market_id?: string
       amount?: string
       // ... relevant context
     }
   }
   ```

3. **Add tracking call** in the relevant service or component:
   ```typescript
   import { analyticsService } from '@/services/analyticsService'

   analyticsService.track('$ARGUMENTS', {
     market_id: marketId,
     // ... properties
   })
   ```

4. **Or use the React hook** in components:
   ```typescript
   import { useAnalytics } from '@/hooks/useAnalytics'

   const { track } = useAnalytics()
   track('$ARGUMENTS', { /* properties */ })
   ```

## Event Naming Conventions

- Use **snake_case** for event names: `order_placed`, `trading_started`, `deposit_initiated`
- Use **snake_case** for property names: `market_id`, `order_type`, `session_id`
- Include relevant context: market, amount, account, session info
- Keep property values as strings or numbers (no nested objects)

## Common Event Properties

| Property | Type | Description |
|----------|------|-------------|
| `market_id` | string | Market identifier |
| `trading_account_id` | string | Trading account ID |
| `session_id` | string | Session identifier |
| `order_type` | string | 'Market' or 'Spot' |
| `side` | string | 'Buy' or 'Sell' |
| `amount` | string | USD amount |
| `strategy_preset` | string | Strategy preset name |

## Checklist

- [ ] Event type defined in `src/types/analytics.ts`
- [ ] Event name follows snake_case convention
- [ ] Properties interface includes relevant context
- [ ] Tracking call added in the appropriate service/component
- [ ] Event fires at the correct moment in the user flow
- [ ] No PII (personally identifiable information) in event properties
- [ ] No private keys, secrets, or sensitive data in properties
