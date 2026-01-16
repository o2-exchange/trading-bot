import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { authFlowService } from '../services/authFlowService'
import { walletService } from '../services/walletService'
import { useToast } from './ToastProvider'
import { analyticsService } from '../services/analyticsService'
import './TermsOfUseDialog.css'

interface TermsOfUseDialogProps {
  isOpen: boolean
  onClose: () => void
}

export default function TermsOfUseDialog({ isOpen, onClose }: TermsOfUseDialogProps) {
  const { t } = useTranslation()
  const [accepted, setAccepted] = useState(false)
  const { addToast } = useToast()
  const dialogOpenTimeRef = useRef<number>(0)

  // Track when dialog opens
  useEffect(() => {
    if (isOpen) {
      dialogOpenTimeRef.current = Date.now()
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleAccept = async () => {
    if (!accepted) {
      addToast(t('terms.accept_to_continue'), 'warning')
      return
    }

    try {
      await authFlowService.acceptTerms()

      // Track message signed
      const wallet = walletService.getConnectedWallet()
      const timeToSign = dialogOpenTimeRef.current ? Date.now() - dialogOpenTimeRef.current : 0
      analyticsService.trackMessageSigned(wallet?.address || '', timeToSign)

      onClose()
    } catch (error: any) {
      addToast(t('terms.accept_failed', { message: error.message }), 'error')
    }
  }

  const handleDecline = () => {
    onClose()
    authFlowService.reset()
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-content" onClick={(e) => e.stopPropagation()}>
        <h2>{t('terms.title')}</h2>
        <div className="terms-content">
          <p>{t('terms.intro')}</p>
          <ul>
            <li>{t('terms.responsibility')}</li>
            <li>{t('terms.risks')}</li>
            <li>{t('terms.legal')}</li>
            <li>{t('terms.loss_risk')}</li>
            <li>{t('terms.bugs')}</li>
            <li>{t('terms.experimental')}</li>
          </ul>
          <p>
            {t('terms.full_terms')}{" "}
            <a
              href="https://o2.app/terms-of-use"
              target="_blank"
              rel="noopener noreferrer"
            >
              o2.app/terms-of-use
            </a>
          </p>
        </div>
        <div className="terms-checkbox">
          <label>
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            <span>{t('terms.checkbox_label')}</span>
          </label>
        </div>
        <div className="dialog-actions">
          <button className="decline-button" onClick={handleDecline}>
            {t('terms.decline')}
          </button>
          <button
            className="accept-button"
            onClick={handleAccept}
            disabled={!accepted}
          >
            {t('terms.accept')}
          </button>
        </div>
      </div>
    </div>
  );
}
