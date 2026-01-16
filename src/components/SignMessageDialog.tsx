import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { authFlowService } from '../services/authFlowService'
import { useToast } from './ToastProvider'
import './SignMessageDialog.css'

interface SignMessageDialogProps {
  isOpen: boolean
  onClose: () => void
}

export default function SignMessageDialog({ isOpen, onClose }: SignMessageDialogProps) {
  const { t } = useTranslation()
  const [isLoading, setIsLoading] = useState(false)
  const { addToast } = useToast()

  // Reset loading state when dialog opens (e.g., after retry)
  useEffect(() => {
    if (isOpen) {
      setIsLoading(false)
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleSign = async () => {
    setIsLoading(true)
    try {
      await authFlowService.confirmSignature()
      onClose()
    } catch (error: any) {
      addToast(t('sign_message.failed', { message: error.message }), 'error')
      setIsLoading(false)
    }
  }

  const handleCancel = () => {
    authFlowService.declineSignature()
    onClose()
  }

  return (
    <div className="dialog-overlay" onClick={handleCancel}>
      <div
        className="dialog-content sign-message-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{t('sign_message.title')}</h2>
        <div className="sign-message-content">
          <p>
            {t('sign_message.description')}
          </p>
          <p className="sign-message-note">
            {t('sign_message.note')}
          </p>
        </div>
        <div className="dialog-actions">
          <button
            className="cancel-button"
            onClick={handleCancel}
            disabled={isLoading}
          >
            {t('common.cancel')}
          </button>
          <button
            className="sign-button"
            onClick={handleSign}
            disabled={isLoading}
          >
            {isLoading ? t('sign_message.waiting') : t('sign_message.sign_button')}
          </button>
        </div>
      </div>
    </div>
  );
}
