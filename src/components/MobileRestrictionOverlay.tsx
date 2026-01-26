import './MobileRestrictionOverlay.css'
import { useTranslation } from 'react-i18next'

export function MobileRestrictionOverlay() {
  const { t } = useTranslation()

  return (
    <div className="mobile-restriction-overlay">
      <div className="mobile-restriction-content">
        <div className="mobile-restriction-icon">
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        </div>
        <h2>{t('mobile_restriction.title')}</h2>
        <p>{t('mobile_restriction.message')}</p>
      </div>
    </div>
  )
}
