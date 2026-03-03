import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { competitionService } from '../services/competitionService'
import { marketService } from '../services/marketService'
import { Competition, LeaderboardResponse, UserStreak, UserStreakPeriod } from '../types/competition'
import { Market } from '../types/market'
import LeaderboardModal from './LeaderboardModal'
import './CompetitionPanel.css'

interface CompetitionPanelProps {
  walletAddress: string | null
}

function isSameHex(a: string, b: string): boolean {
  return a.replace(/^0x/i, '').toLowerCase() === b.replace(/^0x/i, '').toLowerCase()
}

export default function CompetitionPanel({ walletAddress }: CompetitionPanelProps) {
  const { t } = useTranslation()
  const [activeCompetition, setActiveCompetition] = useState<Competition | null>(null)
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timeRemaining, setTimeRemaining] = useState<string>('')
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false)
  const [streakTimeRemaining, setStreakTimeRemaining] = useState<string>('')
  const [markets, setMarkets] = useState<Market[]>([])

  const formatTimeRemaining = useCallback((endDate: string | null): string => {
    if (!endDate) return t('competition.no_end_date')
    const now = new Date().getTime()
    const end = new Date(endDate).getTime()
    const diff = end - now
    if (diff <= 0) return t('competition.ended')

    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    const seconds = Math.floor((diff % (1000 * 60)) / 1000)

    if (days > 0) return `${days}d ${hours}h ${minutes}m`
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
    if (minutes > 0) return `${minutes}m ${seconds}s`
    return `${seconds}s`
  }, [])

  const formatCountdown = useCallback((endTime: string): string => {
    const now = new Date().getTime()
    const end = new Date(endTime).getTime()
    const diff = end - now
    if (diff <= 0) return '00:00:00'
    const h = Math.floor(diff / (1000 * 60 * 60))
    const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    const s = Math.floor((diff % (1000 * 60)) / 1000)
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }, [])

  const fetchCompetitionData = useCallback(async () => {
    if (!walletAddress) { setLoading(false); return }
    try {
      setError(null)
      const fetchedMarkets = await marketService.fetchMarkets()
      setMarkets(fetchedMarkets)
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
    const interval = setInterval(() => fetchCompetitionData(), 60000)
    return () => clearInterval(interval)
  }, [fetchCompetitionData])

  useEffect(() => {
    if (!activeCompetition) return
    const updateTimer = () => {
      setTimeRemaining(formatTimeRemaining(activeCompetition.endDate))
      const sc = leaderboardData?.streakConfig || activeCompetition.streakConfig
      if (sc?.enabled && sc.periods?.length > 0) {
        const cp = sc.periods[sc.currentPeriodIndex]
        if (cp?.endTime) setStreakTimeRemaining(formatCountdown(cp.endTime))
      }
    }
    updateTimer()
    const timerInterval = setInterval(updateTimer, 1000)
    return () => clearInterval(timerInterval)
  }, [activeCompetition, leaderboardData, formatTimeRemaining, formatCountdown])

  // Market name resolution
  const marketNameMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of markets) {
      if (m.contract_id) {
        map.set(m.contract_id.replace(/^0x/i, '').toLowerCase(), `${m.base.symbol}/${m.quote.symbol}`)
      }
    }
    return map
  }, [markets])

  const resolveMarketName = useCallback((contractId: string): string => {
    const clean = contractId.replace(/^0x/i, '').toLowerCase()
    const name = marketNameMap.get(clean)
    if (name) return name
    for (const m of markets) {
      if (isSameHex(m.contract_id, contractId)) return `${m.base.symbol}/${m.quote.symbol}`
    }
    return `${contractId.slice(0, 6)}...${contractId.slice(-4)}`
  }, [marketNameMap, markets])

  const formatBoostMultiplier = (bp: number): string => `x${(bp / 10000).toFixed(2)}`

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
    } catch { return '0' }
  }

  const formatVolume = (volume: string): string => formatNumber(volume, 9)

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
    } catch { return '$0' }
  }

  if (loading) {
    return <div className="cp-panel"><div className="cp-status">{t('competition.loading')}</div></div>
  }
  if (error) {
    return <div className="cp-panel"><div className="cp-status cp-error">{error}</div></div>
  }
  if (!activeCompetition) {
    return <div className="cp-panel"><div className="cp-status">{t('competition.no_active')}</div></div>
  }

  const renderHighlightedText = (text: string) => {
    const parts = text.split(/(<highlight>.*?<\/highlight>)/g)
    return parts.map((part, i) => {
      const match = part.match(/^<highlight>(.*)<\/highlight>$/)
      if (match) return <span key={i} className="cp-highlight">{match[1]}</span>
      return part
    })
  }

  const currentUser = leaderboardData?.currentUser
  const userStreak = currentUser?.streak as UserStreak | undefined
  const hasStreakPeriods = userStreak && 'periods' in userStreak && Array.isArray(userStreak.periods)
  const streakConfig = leaderboardData?.streakConfig || activeCompetition.streakConfig
  const marketBoosts = leaderboardData?.marketBoosts
  const hasMarketBoosts = marketBoosts && Object.keys(marketBoosts).length > 0
  // A rank is valid if it's a positive number (not '-', '', 0, or undefined)
  const isValidRank = (rank: string | number | undefined): boolean => {
    if (rank == null) return false
    const n = typeof rank === 'string' ? parseInt(rank, 10) : rank
    return !isNaN(n) && n > 0
  }

  const hasTakerRank = leaderboardData?.currentUserSubRankingTaker && isValidRank(leaderboardData.currentUserSubRankingTaker.rank)
  const hasMakerRank = leaderboardData?.currentUserSubRankingMaker && isValidRank(leaderboardData.currentUserSubRankingMaker.rank)
  const hasPnlRank = leaderboardData?.currentUserSubRankingPnl && isValidRank(leaderboardData.currentUserSubRankingPnl.rank)
  const hasLotteryRank = leaderboardData?.currentUserDailyRace && isValidRank(leaderboardData.currentUserDailyRace.rank)
  const hasSubRankings = hasTakerRank || hasMakerRank || hasPnlRank || hasLotteryRank

  // Streak progress
  let streakProgress: { volume: string; target: string; percent: number; met: boolean } | null = null
  if (hasStreakPeriods && streakConfig?.enabled) {
    const cpd = userStreak.periods.find((p: UserStreakPeriod) => p.periodIndex === userStreak.currentPeriodIndex)
    if (cpd) {
      let percent = 0
      try {
        const v = BigInt(cpd.volume || '0')
        const tgt = BigInt(cpd.targetVolume || '0')
        if (tgt > 0n) percent = Math.min(100, Number((v * 10000n) / tgt) / 100)
      } catch { percent = 0 }
      streakProgress = { volume: formatVolume(cpd.volume), target: formatVolume(cpd.targetVolume), percent, met: cpd.targetMet }
    }
  }

  let currentBoostBp = 0
  if (streakConfig?.enabled && streakConfig.periods?.length > 0) {
    const period = streakConfig.periods[streakConfig.currentPeriodIndex]
    if (period) {
      currentBoostBp = period.boostBp
      if (userStreak?.superBoostStatus === 'active' && period.superBoostBp) currentBoostBp = period.superBoostBp
    }
  }

  // Super boost info
  const superBoostNeeded = streakConfig?.enabled ? streakConfig.periods[streakConfig.currentPeriodIndex]?.superBoostStreakNeeded : undefined
  const streaksRemaining = superBoostNeeded && userStreak ? Math.max(0, superBoostNeeded - userStreak.streakCount) : undefined

  // Determine which cards to show
  const showBoostsCard = hasMarketBoosts
  const showDailyCard = streakConfig?.enabled && streakProgress
  const showStreakCard = (hasStreakPeriods && userStreak.periods.length > 0) || currentUser?.lottery
  const hasCards = showBoostsCard || showDailyCard || showStreakCard
  const cardCount = [showBoostsCard, showDailyCard, showStreakCard].filter(Boolean).length

  return (
    <div className="cp-panel">
      {/* Header: Left (title) | Center (ranks + stats) | Right (timer) */}
      <div className="cp-header">
        <div className="cp-header-left">
          <h2 className="cp-title">{renderHighlightedText(activeCompetition.title)}</h2>
          <span className="cp-active-badge">{t('competition.active')}</span>
          <button className="cp-leaderboard-link" onClick={() => setIsLeaderboardOpen(true)}>
            {t('competition.view_leaderboard')}
          </button>
        </div>

        {currentUser && (
          <div className="cp-header-center">
            {/* Ranks */}
            {hasSubRankings ? (
              <>
                {hasTakerRank && (
                  <div className="cp-metric-item">
                    <span className="cp-metric-label">{t('competition.taker_rank')}</span>
                    <span className="cp-metric-value">#{leaderboardData!.currentUserSubRankingTaker!.rank}</span>
                  </div>
                )}
                {hasMakerRank && (
                  <div className="cp-metric-item">
                    <span className="cp-metric-label">{t('competition.maker_rank')}</span>
                    <span className="cp-metric-value">#{leaderboardData!.currentUserSubRankingMaker!.rank}</span>
                  </div>
                )}
                {hasPnlRank && (
                  <div className="cp-metric-item">
                    <span className="cp-metric-label">{t('competition.pnl_rank')}</span>
                    <span className="cp-metric-value">#{leaderboardData!.currentUserSubRankingPnl!.rank}</span>
                  </div>
                )}
                {hasLotteryRank && (
                  <div className="cp-metric-item">
                    <span className="cp-metric-label">{t('competition.lottery_rank')}</span>
                    <span className="cp-metric-value">#{leaderboardData!.currentUserDailyRace!.rank}</span>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="cp-metric-item">
                  <span className="cp-metric-label">{t('competition.rank')}</span>
                  <span className="cp-metric-value">#{currentUser.rank}</span>
                </div>
                <div className="cp-metric-item">
                  <span className="cp-metric-label">{t('competition.score')}</span>
                  <span className="cp-metric-value">{currentUser.score}</span>
                </div>
              </>
            )}

            <div className="cp-metric-divider" />

            {/* Stats */}
            <div className="cp-metric-item">
              <span className="cp-metric-label">{t('competition.volume')}</span>
              <span className="cp-metric-value">${formatVolume(currentUser.volume)}</span>
            </div>
            {currentUser.boostedVolume && currentUser.boostedVolume !== currentUser.volume && (
              <div className="cp-metric-item">
                <span className="cp-metric-label">{t('competition.boosted_volume')}</span>
                <span className="cp-metric-value boosted">${formatVolume(currentUser.boostedVolume)}</span>
              </div>
            )}
            <div className="cp-metric-item">
              <span className="cp-metric-label">{t('competition.pnl')}</span>
              <span className={`cp-metric-value ${BigInt(currentUser.pnl || '0') >= 0n ? 'positive' : 'negative'}`}>
                {formatPnL(currentUser.pnl)}
              </span>
            </div>
            {leaderboardData?.prizePool?.rewards?.[currentUser.rank] && (
              <div className="cp-metric-item">
                <span className="cp-metric-label">{t('competition.potential_reward')}</span>
                <span className="cp-metric-value reward">${leaderboardData.prizePool.rewards[currentUser.rank]}</span>
              </div>
            )}
          </div>
        )}

        <div className="cp-header-right">
          <div className="cp-timer">
            <span className="cp-timer-label">{t('competition.ends_in')}</span>
            <span className="cp-timer-value">{timeRemaining}</span>
          </div>
          {(activeCompetition.rewardPool || (leaderboardData?.prizePool?.milestones && leaderboardData.prizePool.milestones.length > 0)) && (
            <div className="cp-reward">
              ${activeCompetition.rewardPool || leaderboardData?.prizePool?.milestones[leaderboardData?.prizePool?.milestoneIndex >= 0 ? leaderboardData.prizePool.milestoneIndex : 0]?.rewardPool || '0'}
            </div>
          )}
        </div>
      </div>

      {/* Cards section */}
      {hasCards && (
        <div className="cp-cards" data-cols={cardCount}>
          {/* Card 1: Market Boosts — 2-up compact chips */}
          {showBoostsCard && (
            <div className="cp-card cp-boosts-card">
              <div className="cp-card-title">{t('competition.market_boosts')}</div>
              <div className="cp-boosts-chips">
                {Object.entries(marketBoosts!).map(([contractId, bp], idx) => (
                  <div key={contractId} className={`cp-boost-chip ${idx === 0 ? 'first' : ''}`}>
                    <span className="cp-boost-chip-pair">{resolveMarketName(contractId)}</span>
                    <span className="cp-boost-chip-mult">{formatBoostMultiplier(bp)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Card 2: Daily Booster */}
          {showDailyCard && streakProgress && (
            <div className="cp-card cp-daily-card">
              <div className="cp-daily-top">
                <span className="cp-card-title" style={{ marginBottom: 0 }}>{t('competition.daily_target')}</span>
                {currentBoostBp > 0 && (
                  <span className="cp-boost-pct">+{(currentBoostBp / 100).toFixed(0)}%</span>
                )}
                {streakTimeRemaining && (
                  <span className="cp-resets">{t('competition.resets_in')} {streakTimeRemaining}</span>
                )}
              </div>
              <div className="cp-daily-progress-row">
                {streakProgress.met ? (
                  <span className="cp-target-met">{t('competition.target_met')}</span>
                ) : (
                  <span className="cp-daily-vol-inline">
                    <span className="cp-vol-current">${streakProgress.volume}</span>
                    <span className="cp-vol-separator">/</span>
                    <span className="cp-vol-target">${streakProgress.target}</span>
                  </span>
                )}
                <div className="cp-progress-track">
                  <div className={`cp-progress-fill ${streakProgress.met ? 'met' : ''}`} style={{ width: `${streakProgress.percent}%` }} />
                </div>
                <span className="cp-progress-pct">{streakProgress.percent.toFixed(0)}%</span>
              </div>
            </div>
          )}

          {/* Card 3: Streak & Info — day boxes grid */}
          {showStreakCard && (
            <div className="cp-card cp-streak-card">
              <div className="cp-streak-header">
                <span className="cp-card-title" style={{ marginBottom: 0 }}>{t('competition.streak')}</span>
                {hasStreakPeriods && (() => {
                  // Count consecutive met days ending at or before current period
                  let count = 0
                  for (let i = userStreak.currentPeriodIndex; i >= 0; i--) {
                    const p = userStreak.periods[i]
                    if (p?.targetMet) count++
                    else if (p?.isComplete) break  // completed but not met = streak broken
                    else break  // current day not complete yet, don't count
                  }
                  // Also check if current day target is met (even if period not complete)
                  const currentPeriod = userStreak.periods[userStreak.currentPeriodIndex]
                  if (currentPeriod && currentPeriod.targetMet && !currentPeriod.isComplete) {
                    count = 0
                    for (let i = userStreak.currentPeriodIndex; i >= 0; i--) {
                      if (userStreak.periods[i]?.targetMet) count++
                      else break
                    }
                  }
                  return <span className="cp-streak-count">x{Math.max(count, userStreak.streakCount)}</span>
                })()}
                {hasStreakPeriods && (
                  <span className="cp-streak-day">D{userStreak.currentPeriodIndex + 1}/{userStreak.periods.length}</span>
                )}
                {userStreak?.superBoostStatus && (
                  <span className={`cp-sb-badge ${userStreak.superBoostStatus}`}>
                    {userStreak.superBoostStatus === 'active' && t('competition.super_boost_active')}
                    {userStreak.superBoostStatus === 'lost' && t('competition.super_boost_lost')}
                    {userStreak.superBoostStatus === 'eligible' && (
                      streaksRemaining != null && streaksRemaining > 0
                        ? t('competition.super_boost_in_days', { days: streaksRemaining.toString() })
                        : t('competition.super_boost')
                    )}
                  </span>
                )}
                {currentUser?.lottery && (
                  <span className="cp-lottery-inline">
                    {currentUser.lottery.ticketsThisPeriod}t · {currentUser.lottery.ticketsTotal} total · {currentUser.lottery.winsCount}w
                  </span>
                )}
              </div>
              {hasStreakPeriods && userStreak.periods.length > 0 && (
                <div className="cp-day-boxes">
                  {userStreak.periods.map((period: UserStreakPeriod, idx: number) => {
                    let cls = 'cp-day-box'
                    if (period.isComplete) cls += period.targetMet ? ' met' : ' failed'
                    else if (period.periodIndex === userStreak.currentPeriodIndex) cls += ' current'
                    else cls += ' future'
                    return (
                      <div key={idx} className={cls} title={`Day ${idx + 1}`}>
                        <span className="cp-day-num">{idx + 1}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <LeaderboardModal
        isOpen={isLeaderboardOpen}
        onClose={() => setIsLeaderboardOpen(false)}
        leaderboardData={leaderboardData}
      />
    </div>
  )
}
