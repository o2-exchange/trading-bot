import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { tradingEngine } from '../services/tradingEngine'

interface TradingStatusProps {
  isTrading: boolean
}

interface StatusMessage {
  message: string
  type: string
  timestamp: number
}

export default function TradingStatus({ isTrading }: TradingStatusProps) {
  const { t } = useTranslation()
  const [statusMessages, setStatusMessages] = useState<StatusMessage[]>([])
  const [tradeCycles, setTradeCycles] = useState(0)

  useEffect(() => {
    if (!isTrading) {
      setStatusMessages([])
      setTradeCycles(0)
      return
    }

    // Subscribe to status updates
    const unsubscribeStatus = tradingEngine.onStatus((message, type) => {
      setStatusMessages((prev) => {
        const newMessages = [...prev, { message, type, timestamp: Date.now() }]
        // Keep only last 10 messages
        return newMessages.slice(-10)
      })
    })

    // Poll for trade cycles
    const interval = setInterval(() => {
      setTradeCycles(tradingEngine.getSessionTradeCycles())
    }, 1000)

    return () => {
      unsubscribeStatus()
      clearInterval(interval)
    }
  }, [isTrading])

  if (!isTrading) {
    return null
  }

  return (
    <div className="trading-status">
      <h3>{t('trading_status.title')}</h3>
      <div className="status-info">
        <p>
          {t('trading_status.status')}: <span className="status-active">{t('trading_status.active')}</span>
        </p>
        <p>{t('trading_status.trade_cycles')}: {tradeCycles}</p>
      </div>
      {statusMessages.length > 0 && (
        <div className="status-messages">
          <h4>{t('trading_status.recent_activity')}</h4>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {statusMessages.map((msg, idx) => (
              <li
                key={idx}
                className={`status-${msg.type}`}
                style={{
                  padding: '4px 0',
                  fontSize: '13px',
                  color: msg.type === 'error' ? 'var(--destructive)' : 
                         msg.type === 'success' ? 'var(--success)' :
                         msg.type === 'warning' ? 'var(--warning)' : 'var(--foreground)'
                }}
              >
                {new Date(msg.timestamp).toLocaleTimeString()} - {msg.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

