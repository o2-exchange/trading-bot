import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { authFlowService } from '../services/authFlowService'
import { useToast } from './ToastProvider'
import './AccessQueueDialog.css'

interface AccessQueueDialogProps {
  isOpen: boolean
  queuePosition: number | null
  email: string | null
  telegram: string | null
  onClose: () => void
}

export default function AccessQueueDialog({
  isOpen,
  queuePosition,
  email,
  telegram,
  onClose,
}: AccessQueueDialogProps) {
  const { t } = useTranslation()
  const [localEmail, setLocalEmail] = useState(email || '')
  const [localTelegram, setLocalTelegram] = useState(telegram || '')
  const [isEditing, setIsEditing] = useState(!email && !telegram)
  const { addToast } = useToast()

  if (!isOpen) return null

  const handleSave = async () => {
    // In a real implementation, this would save email/telegram to the access queue
    // For now, we'll just show a message
    addToast(t('access_queue.contact_saved'), 'info')
    setIsEditing(false)
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-content" onClick={(e) => e.stopPropagation()}>
        <h2>{t('access_queue.title')}</h2>
        {queuePosition !== null ? (
          <div className="queue-info">
            <p className="queue-position">
              {t('access_queue.position_label')} <strong>#{queuePosition}</strong>
            </p>
            <p className="queue-message">
              {t('access_queue.waitlist_message')}
            </p>
          </div>
        ) : (
          <div className="queue-info">
            <p className="queue-message">
              {t('access_queue.not_eligible_message')}
            </p>
          </div>
        )}

        <div className="contact-info">
          <h3>{t('access_queue.contact_title')}</h3>
          {isEditing ? (
            <div className="contact-form">
              <div className="form-group">
                <label>{t('access_queue.email_label')}</label>
                <input
                  type="email"
                  value={localEmail}
                  onChange={(e) => setLocalEmail(e.target.value)}
                  placeholder={t('access_queue.email_placeholder')}
                />
              </div>
              <div className="form-group">
                <label>{t('access_queue.telegram_label')}</label>
                <input
                  type="text"
                  value={localTelegram}
                  onChange={(e) => setLocalTelegram(e.target.value)}
                  placeholder={t('access_queue.telegram_placeholder')}
                />
              </div>
              <button className="save-button" onClick={handleSave}>
                {t('common.save')}
              </button>
            </div>
          ) : (
            <div className="contact-display">
              {email && <p>{t('access_queue.email_display', { email })}</p>}
              {telegram && <p>{t('access_queue.telegram_display', { telegram })}</p>}
              {!email && !telegram && <p className="no-contact">{t('access_queue.no_contact')}</p>}
              <button className="edit-button" onClick={() => setIsEditing(true)}>
                {t('common.edit')}
              </button>
            </div>
          )}
        </div>

        <div className="dialog-actions">
          <button className="close-button" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
