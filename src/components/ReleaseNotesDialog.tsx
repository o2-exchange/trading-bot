import { useTranslation } from 'react-i18next'
import { RELEASE_NOTES, CURRENT_VERSION } from '../constants/releaseNotes'
import './ReleaseNotesDialog.css'

interface ReleaseNotesDialogProps {
  isOpen: boolean
  onClose: () => void
}

export default function ReleaseNotesDialog({ isOpen, onClose }: ReleaseNotesDialogProps) {
  const { t } = useTranslation()

  if (!isOpen) return null

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="release-notes-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="release-notes-header">
          <h2>{t('release_notes.title')}</h2>
          <div className="header-right">
            <span className="current-version">v{CURRENT_VERSION}</span>
            <button className="close-button" onClick={onClose} aria-label={t('common.close')}>
              &times;
            </button>
          </div>
        </div>

        <div className="release-notes-body">
          {RELEASE_NOTES.map((release, releaseIndex) => (
            <div key={releaseIndex} className="release-entry">
              <div className="release-date-badge">
                <span className="release-version">v{release.version}</span>
                <span className="release-date-separator">•</span>
                <span>{formatDate(release.date)}</span>
              </div>

              <div className="release-features">
                {release.features.map((feature, featureIndex) => (
                  <div key={featureIndex} className="feature-item">
                    <h3 className="feature-title">{t(feature.title)}</h3>
                    <p className="feature-description">{t(feature.description)}</p>
                    {feature.details && feature.details.length > 0 && (
                      <ul className="feature-details">
                        {feature.details.map((detail, detailIndex) => (
                          <li key={detailIndex}>{t(detail)}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="auto-update-note">
            <svg className="info-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            <span>{t('release_notes.auto_update_note')}</span>
          </div>
        </div>

        <div className="release-notes-footer">
          <button className="btn-primary" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
