import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { en, ja, ko, zhCN, zhHK } from './locales/locales'

const STORAGE_KEY = 'o2-trading-bot-language'

// Get saved language or default to English
const getSavedLanguage = (): string => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && ['en', 'ja', 'ko', 'zh-CN', 'zh-HK'].includes(saved)) {
      return saved
    }
  } catch (e) {
    // localStorage not available
  }
  return 'en'
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ja: { translation: ja },
      ko: { translation: ko },
      'zh-CN': { translation: zhCN },
      'zh-HK': { translation: zhHK },
    },
    lng: getSavedLanguage(),
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false, // React already escapes
    },
  })

// Save language preference when changed
i18n.on('languageChanged', (lng) => {
  try {
    localStorage.setItem(STORAGE_KEY, lng)
  } catch (e) {
    // localStorage not available
  }
})

export default i18n
