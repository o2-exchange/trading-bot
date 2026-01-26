import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { competitionService } from '../services/competitionService'
import { Competition, LeaderboardResponse } from '../types/competition'
import LeaderboardModal from './LeaderboardModal'
import './CompetitionPanel.css'

interface CompetitionPanelProps {
  walletAddress: string | null
}

export default function CompetitionPanel({ walletAddress }: CompetitionPanelProps) {
  const { t } = useTranslation()
  const [activeCompetition, setActiveCompetition] = useState<Competition | null>(null)
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timeRemaining, setTimeRemaining] = useState<string>('')
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false)

  const formatTimeRemaining = useCallback((endDate: string | null): string => {
    if (!endDate) {
      return t('competition.no_end_date')
    }

    const now = new Date().getTime()
    const end = new Date(endDate).getTime()
    const diff = end - now

    if (diff <= 0) {
      return t('competition.ended')
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    const seconds = Math.floor((diff % (1000 * 60)) / 1000)

    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`
    } else if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`
    } else {
      return `${seconds}s`
    }
  }, [])

  const fetchCompetitionData = useCallback(async () => {
    if (!walletAddress) {
      setLoading(false)
      return
    }

    try {
      setError(null)
      const competitionList = await competitionService.getCompetitionList()
      const active = competitionService.getActiveCompetition(competitionList.competitions)
      
      if (active) {
        setActiveCompetition(active)
        setTimeRemaining(formatTimeRemaining(active.endDate))
        const leaderboard = await competitionService.getLeaderboard(active.competitionId, walletAddress)
        setLeaderboardData(leaderboard)
      } else {
        setActiveCompetition(null)
        setLeaderboardData(null)
        setTimeRemaining('')
      }
    } catch (err: any) {
      console.error('Failed to fetch competition data', err)
      setError(t('competition.load_error'))
    } finally {
      setLoading(false)
    }
  }, [walletAddress, formatTimeRemaining])

  useEffect(() => {
    fetchCompetitionData()

    // Refresh data every 60 seconds
    const interval = setInterval(() => {
      fetchCompetitionData()
    }, 60000)

    return () => clearInterval(interval)
  }, [fetchCompetitionData])

  // Update countdown timer every second
  useEffect(() => {
    if (!activeCompetition) return

    const updateTimer = () => {
      setTimeRemaining(formatTimeRemaining(activeCompetition.endDate))
    }

    updateTimer()
    const timerInterval = setInterval(updateTimer, 1000)

    return () => clearInterval(timerInterval)
  }, [activeCompetition, formatTimeRemaining])

  const formatNumber = (value: string, decimals: number = 9): string => {
    try {
      // Convert to BigInt to handle large numbers safely
      const bigIntValue = BigInt(value || '0')
      const divisor = BigInt(10 ** decimals)
      
      // Divide by 10^decimals to get the actual value
      const integerPart = bigIntValue / divisor
      const fractionalPart = bigIntValue % divisor
      
      // Convert to number for formatting
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

  if (loading) {
    return (
      <div className="competition-panel">
        <div className="competition-loading">{t('competition.loading')}</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="competition-panel">
        <div className="competition-error">{error}</div>
      </div>
    )
  }

  if (!activeCompetition) {
    return (
      <div className="competition-panel">
        <div className="competition-no-active">{t('competition.no_active')}</div>
      </div>
    )
  }

  const currentUser = leaderboardData?.currentUser

  return (
    <div className="competition-panel">
      <div className="competition-row">
        {/* Left: Title, subtitle, leaderboard link */}
        <div className="competition-info">
          <div className="competition-title-row">
            <h2 className="competition-title">{activeCompetition.title}</h2>
            <span className="active-badge">{t('competition.active')}</span>
          </div>
          {activeCompetition.subtitle && (
            <p className="competition-subtitle">{activeCompetition.subtitle}</p>
          )}
          <button
            className="view-leaderboard-link"
            onClick={() => setIsLeaderboardOpen(true)}
          >
            {t('competition.view_leaderboard')}
          </button>
        </div>

        {/* User stats */}
        {currentUser && (
          <div className="competition-user-stats">
            <div className="stat-item">
              <span className="stat-label">{t('competition.rank')}</span>
              <span className="stat-value rank">#{currentUser.rank}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">{t('competition.score')}</span>
              <span className="stat-value">{currentUser.score}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">{t('competition.volume')}</span>
              <span className="stat-value">${formatVolume(currentUser.volume)}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">{t('competition.pnl')}</span>
              <span className={`stat-value ${parseFloat(currentUser.pnl) >= 0 ? 'positive' : 'negative'}`}>
                {formatPnL(currentUser.pnl)}
              </span>
            </div>
            {leaderboardData?.prizePool?.rewards?.[currentUser.rank] && (
              <div className="stat-item reward-stat">
                <span className="stat-label">{t('competition.potential_reward')}</span>
                <span className="stat-value reward">
                  ${leaderboardData.prizePool.rewards[currentUser.rank]}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Right side: Time remaining + Reward pool */}
        <div className="competition-right">
          <div className="competition-time">
            <span className="time-label">{t('competition.ends_in')}</span>
            <span className="time-value">{timeRemaining}</span>
          </div>

          {(activeCompetition.rewardPool || (leaderboardData?.prizePool?.milestones && leaderboardData.prizePool.milestones.length > 0)) && (
            <div className="competition-reward">
              <span className="reward-label">{t('competition.reward')}</span>
              <span className="reward-value">
                ${activeCompetition.rewardPool || leaderboardData?.prizePool?.milestones[leaderboardData?.prizePool?.milestoneIndex >= 0 ? leaderboardData.prizePool.milestoneIndex : 0]?.rewardPool || '0'}
              </span>
            </div>
          )}
        </div>
      </div>

      <LeaderboardModal
        isOpen={isLeaderboardOpen}
        onClose={() => setIsLeaderboardOpen(false)}
        leaderboardData={leaderboardData}
      />
    </div>
  )
}

