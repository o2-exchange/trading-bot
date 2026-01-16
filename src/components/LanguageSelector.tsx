import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LANGUAGES } from '../constants/languages'
import './LanguageSelector.css'

export default function LanguageSelector() {
  const { i18n } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleLanguageChange = (code: string) => {
    i18n.changeLanguage(code)
    setIsOpen(false)
  }

  return (
    <div className="language-selector" ref={dropdownRef}>
      <button
        className="language-selector-button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Select language"
        title="Select language"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 8l6 6" />
          <path d="M4 14h6" />
          <path d="M2 5h12" />
          <path d="M7 2v3" />
          <path d="M22 22l-5-10-5 10" />
          <path d="M14 18h6" />
        </svg>
      </button>

      {isOpen && (
        <div className="language-dropdown">
          <div className="language-dropdown-header">Language</div>
          {LANGUAGES.map((language) => (
            <button
              key={language.code}
              className={`language-option ${language.code === i18n.language ? 'active' : ''}`}
              onClick={() => handleLanguageChange(language.code)}
            >
              <span className="language-option-emoji">{language.emoji}</span>
              <span className="language-option-name">{language.nativeName}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
