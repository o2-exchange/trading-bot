import { useState, useEffect } from 'react'
import { authFlowService } from '../services/authFlowService'
import { useToast } from './ToastProvider'
import './SignMessageDialog.css'

interface SignMessageDialogProps {
  isOpen: boolean
  onClose: () => void
}

export default function SignMessageDialog({ isOpen, onClose }: SignMessageDialogProps) {
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
      addToast(`Failed to sign message: ${error.message}`, 'error')
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
        <h2>Verify Wallet Ownership</h2>
        <div className="sign-message-content">
          <p>
            Sign this message to securely connect your wallet and create a
            trading session.
          </p>
          <p className="sign-message-note">
            This is not a blockchain transaction, does not cost any gas, and
            does not grant permission to move funds from your wallet.
          </p>
        </div>
        <div className="dialog-actions">
          <button
            className="cancel-button"
            onClick={handleCancel}
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            className="sign-button"
            onClick={handleSign}
            disabled={isLoading}
          >
            {isLoading ? "Waiting for signature..." : "Sign & Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
