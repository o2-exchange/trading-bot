export interface Language {
  code: string
  name: string
  nativeName: string
  emoji: string
}

export const LANGUAGES: Language[] = [
  { code: 'en', name: 'English', nativeName: 'English', emoji: '🇺🇸' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', emoji: '🇯🇵' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', emoji: '🇰🇷' },
  { code: 'zh-CN', name: 'Chinese (Simplified)', nativeName: '简体中文', emoji: '🇨🇳' },
  { code: 'zh-HK', name: 'Chinese (Traditional)', nativeName: '繁體中文', emoji: '🇭🇰' },
]

export const getLanguageByCode = (code: string): Language | undefined => {
  return LANGUAGES.find((lang) => lang.code === code)
}
