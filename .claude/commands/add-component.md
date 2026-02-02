# Add Component: $ARGUMENTS

Create a new React component named `$ARGUMENTS` following O2 project patterns.

## Steps

1. **Read existing component examples** for patterns:
   - `src/components/Balances.tsx` (simple data display)
   - `src/components/MarketSelector.tsx` (interactive component)
   - `src/components/StrategyConfig.tsx` (form-based component)

2. **Create the component file** at `src/components/$ARGUMENTS.tsx`:
   - TypeScript functional component with explicit props interface
   - Use `useTranslation()` hook from `react-i18next` for all user-visible text
   - Use CSS classes from `src/styles/o2-theme.css` patterns
   - Import path alias `@` for src-relative imports

3. **Create the CSS file** at `src/components/$ARGUMENTS.css`:
   - Follow BEM-like naming from existing component CSS files
   - Use CSS custom properties from `o2-theme.css` where applicable

4. **Add i18n keys** to all 5 locale files in `src/locales/`:
   - `en.json`, `ja.json`, `ko.json`, `zh-cn.json`, `zh-hk.json`
   - Use nested key structure matching the component area

5. **Add integration point** in `src/components/Dashboard.tsx` or the appropriate parent component.

## Component Template

```typescript
import { useTranslation } from 'react-i18next'
import './$ARGUMENTS.css'

interface ${ARGUMENTS}Props {
  // Define props here
}

export function $ARGUMENTS({ }: ${ARGUMENTS}Props) {
  const { t } = useTranslation()

  return (
    <div className="$ARGUMENTS-container">
      {/* Component content */}
    </div>
  )
}
```

## Checklist

- [ ] Props interface exported and documented
- [ ] All user-visible strings use `t()` function
- [ ] CSS file created with scoped class names
- [ ] i18n keys added to all 5 locale files
- [ ] Component imported and rendered in parent
- [ ] No hardcoded strings in JSX
