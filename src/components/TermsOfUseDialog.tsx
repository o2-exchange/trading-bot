import { useState, useEffect, useRef } from 'react'
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
      addToast('Please accept the terms of use to continue', 'warning')
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
      addToast(`Failed to accept terms: ${error.message}`, 'error')
    }
  }

  const handleDecline = () => {
    onClose()
    authFlowService.reset()
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-content" onClick={(e) => e.stopPropagation()}>
        <h2>Terms of Use</h2>
        <div className="terms-content">
          <p>By using this trading bot, you agree to the following terms:</p>
          <ul>
            <li>You are responsible for all trading activities</li>
            <li>You understand the risks involved in automated trading</li>
            <li>You will not use this bot for illegal activities</li>
            <li>You acknowledge that trading involves risk of loss</li>
            <li>You acknowledge this bot likely has bugs</li>
            <li>You acknowledge this is highly experimental software</li>
          </ul>
          <p>
            Please read the full terms of use at{" "}
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
            <span>I have read and agree to the Terms of Use</span>
          </label>
        </div>
        <div className="dialog-actions">
          <button className="decline-button" onClick={handleDecline}>
            Decline
          </button>
          <button
            className="accept-button"
            onClick={handleAccept}
            disabled={!accepted}
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
