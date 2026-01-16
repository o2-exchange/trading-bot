import { useTranslation } from 'react-i18next'
import { LeaderboardResponse, LeaderboardItem } from '../types/competition'
import './LeaderboardModal.css'

interface LeaderboardModalProps {
  isOpen: boolean
  onClose: () => void
  leaderboardData: LeaderboardResponse | null
}

export default function LeaderboardModal({ isOpen, onClose, leaderboardData }: LeaderboardModalProps) {
  const { t } = useTranslation()

  if (!isOpen) return null

  const formatNumber = (value: string, decimals: number = 9): string => {
    try {
      const bigIntValue = BigInt(value || '0')
      const divisor = BigInt(10 ** decimals)
      
      const integerPart = bigIntValue / divisor
      const fractionalPart = bigIntValue % divisor
      
      const fractionalStr = fractionalPart.toString().padStart(decimals, '0')
      const fractionalNum = parseFloat(fractionalStr) / (10 ** decimals)
      const num = parseFloat(integerPart.toString()) + fractionalNum
      
      if (isNaN(num)) return '0'
      if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T'
      if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B'
      if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M'
      if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K'
      return num.toFixed(2)
    } catch (error) {
      console.error('Error formatting number:', error, value)
      return '0'
    }
  }

  const formatVolume = (volume: string): string => {
    return formatNumber(volume, 9)
  }

  const formatPnL = (pnl: string): string => {
    try {
      const bigIntValue = BigInt(pnl || '0')
      const divisor = BigInt(10 ** 9)
      
      const integerPart = bigIntValue / divisor
      const fractionalPart = bigIntValue % divisor
      
      const fractionalStr = fractionalPart.toString().padStart(9, '0')
      const fractionalNum = parseFloat(fractionalStr) / (10 ** 9)
      const num = parseFloat(integerPart.toString()) + fractionalNum
      
      const absNum = Math.abs(num)
      let formatted: string
      if (absNum >= 1e12) formatted = (absNum / 1e12).toFixed(2) + 'T'
      else if (absNum >= 1e9) formatted = (absNum / 1e9).toFixed(2) + 'B'
      else if (absNum >= 1e6) formatted = (absNum / 1e6).toFixed(2) + 'M'
      else if (absNum >= 1e3) formatted = (absNum / 1e3).toFixed(2) + 'K'
      else formatted = absNum.toFixed(2)
      
      return num >= 0 ? `+$${formatted}` : `-$${formatted}`
    } catch (error) {
      console.error('Error formatting PnL:', error, pnl)
      return '$0'
    }
  }

  const formatAddress = (address: string): string => {
    return `${address.slice(0, 8)}...${address.slice(-6)}`
  }

  const currentUserTraderId = leaderboardData?.currentUser?.traderId?.toLowerCase()

  return (
    <div className="leaderboard-modal-overlay" onClick={onClose}>
      <div className="leaderboard-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="leaderboard-modal-header">
          <h2>{leaderboardData?.title || t('leaderboard.title')}</h2>
          <button className="leaderboard-modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        {leaderboardData?.rewardPool && (
          <div className="leaderboard-reward-info">
            <span className="reward-label">{t('leaderboard.reward_pool')}</span>
            <span className="reward-value">{leaderboardData.rewardPool}</span>
          </div>
        )}

        <div className="leaderboard-table-container">
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th>{t('leaderboard.rank')}</th>
                <th>{t('leaderboard.trader')}</th>
                <th>{t('leaderboard.score')}</th>
                <th>{t('leaderboard.volume')}</th>
                <th>{t('leaderboard.pnl')}</th>
              </tr>
            </thead>
            <tbody>
              {leaderboardData?.items.map((item: LeaderboardItem) => {
                const isCurrentUser = item.traderId?.toLowerCase() === currentUserTraderId
                return (
                  <tr
                    key={item.traderId}
                    className={isCurrentUser ? 'current-user-row' : ''}
                  >
                    <td className="rank-cell">#{item.rank}</td>
                    <td className="address-cell" title={item.traderId}>
                      {formatAddress(item.traderId)}
                    </td>
                    <td className="numeric-cell">{item.score}</td>
                    <td className="numeric-cell">${formatVolume(item.volume)}</td>
                    <td className={`numeric-cell ${parseFloat(item.pnl) >= 0 ? 'positive' : 'negative'}`}>
                      {formatPnL(item.pnl)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

