# Add Translations: $ARGUMENTS

Add i18n translations for the `$ARGUMENTS` feature across all 5 supported languages.

## Steps

1. **Read existing locale files** to understand the key structure:
   - `src/locales/en.json` (source of truth)
   - `src/locales/ja.json` (Japanese)
   - `src/locales/ko.json` (Korean)
   - `src/locales/zh-cn.json` (Simplified Chinese)
   - `src/locales/zh-hk.json` (Traditional Chinese / Hong Kong)

2. **Define English keys** in `src/locales/en.json`:
   - Use nested key structure matching the feature area
   - Example: `"$ARGUMENTS": { "title": "...", "description": "...", "button": "..." }`

3. **Add translations** to all other locale files:
   - `ja.json` -- Japanese translations
   - `ko.json` -- Korean translations
   - `zh-cn.json` -- Simplified Chinese translations
   - `zh-hk.json` -- Traditional Chinese translations

4. **Use in components** via the `useTranslation()` hook:
   ```typescript
   import { useTranslation } from 'react-i18next'

   const { t } = useTranslation()
   return <span>{t('$ARGUMENTS.title')}</span>
   ```

## Key Conventions

- **English is the source of truth** -- define all keys in `en.json` first
- **Nested structure** -- group related keys under feature namespaces
- **No hardcoded strings** -- all user-visible text must use `t()` function
- **Consistent key naming** -- use camelCase for key names
- **Pluralization** -- use `_one` / `_other` suffixes for countable items if needed
- All 5 locale files must have the same key structure

## Supported Languages

| File | Language | Code |
|------|----------|------|
| `en.json` | English | en |
| `ja.json` | Japanese | ja |
| `ko.json` | Korean | ko |
| `zh-cn.json` | Simplified Chinese | zh-CN |
| `zh-hk.json` | Traditional Chinese (HK) | zh-HK |

## Checklist

- [ ] Keys added to `en.json` with correct English text
- [ ] Keys added to `ja.json` with Japanese translations
- [ ] Keys added to `ko.json` with Korean translations
- [ ] Keys added to `zh-cn.json` with Simplified Chinese translations
- [ ] Keys added to `zh-hk.json` with Traditional Chinese translations
- [ ] All 5 files have identical key structure
- [ ] Components use `t()` function to access the new keys
- [ ] No hardcoded user-visible strings remain
