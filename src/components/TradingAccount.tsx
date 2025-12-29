import { useState } from 'react'
import { TradingAccount as TradingAccountType } from '../types/tradingAccount'
import { useToast } from './ToastProvider'
import './TradingAccount.css'

interface TradingAccountProps {
  account: TradingAccountType | null
}

export default function TradingAccount({ account }: TradingAccountProps) {
  const { addToast } = useToast()
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      addToast('Copied to clipboard', 'success')
      setTimeout(() => setCopiedField(null), 2000)
    } catch (error) {
      addToast('Failed to copy', 'error')
    }
  }

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  if (!account) {
    return (
      <div className="trading-account">
        <h2>Trading Panel</h2>
        <p className="loading-text">Loading...</p>
      </div>
    )
  }

  return (
    <div className="trading-account">
      <div className="account-header">
        <h2>Trading Panel</h2>
        <div className="account-ids">
          <div className="account-id-item">
            <span className="account-id-label">o2 Account:</span>
            <span
              className="account-id-text clickable"
              onClick={() => copyToClipboard(account.id, 'account')}
              title="Click to copy o2 Account ID"
            >
              {formatAddress(account.id)}
              <svg className="copy-icon-inline" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {copiedField === 'account' ? (
                  <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round"/>
                ) : (
                  <>
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </>
                )}
              </svg>
            </span>
          </div>
          <div className="account-id-item">
            <span className="account-id-label">Wallet:</span>
            <span
              className="account-id-text clickable"
              onClick={() => copyToClipboard(account.ownerAddress, 'owner')}
              title="Click to copy Connected Wallet"
            >
              {formatAddress(account.ownerAddress)}
              <svg className="copy-icon-inline" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {copiedField === 'owner' ? (
                  <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round"/>
                ) : (
                  <>
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </>
                )}
              </svg>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

