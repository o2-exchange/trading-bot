import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { authFlowService } from '../services/authFlowService'
import { eligibilityService } from '../services/eligibilityService'
import { useToast } from './ToastProvider'
import './InvitationCodeDialog.css'

interface InvitationCodeDialogProps {
  isOpen: boolean
  onClose: () => void
}

export default function InvitationCodeDialog({ isOpen, onClose }: InvitationCodeDialogProps) {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { addToast } = useToast()

  useEffect(() => {
    // Check for invitation code in URL
    const urlCode = eligibilityService.getInviteCodeFromUrl()
    if (urlCode) {
      setCode(urlCode)
    }
  }, [])

  if (!isOpen) return null

  const handleSubmit = async () => {
    if (!code.trim()) {
      addToast(t('invitation.please_enter'), 'warning')
      return
    }

    setIsSubmitting(true)
    try {
      await authFlowService.assignInvitationCode(code.trim())
      addToast(t('invitation.accepted'), 'success')
      onClose()
    } catch (error: any) {
      addToast(t('invitation.failed', { message: error.message }), 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSkip = () => {
    onClose()
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-content" onClick={(e) => e.stopPropagation()}>
        <h2>{t('invitation.title')}</h2>
        <p className="dialog-description">
          {t('invitation.description')}
        </p>
        <div className="code-input-group">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder={t('invitation.placeholder')}
            className="code-input"
            disabled={isSubmitting}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleSubmit()
              }
            }}
          />
        </div>
        <div className="dialog-actions">
          <button className="skip-button" onClick={handleSkip} disabled={isSubmitting}>
            {t('common.skip')}
          </button>
          <button
            className="submit-button"
            onClick={handleSubmit}
            disabled={!code.trim() || isSubmitting}
          >
            {isSubmitting ? t('invitation.submitting') : t('common.submit')}
          </button>
        </div>
      </div>
    </div>
  )
}
