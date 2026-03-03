import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LeaderboardResponse, LeaderboardItem, SubRankingEntry, DailyRaceItem, DisqualifiedTraderEntry, SpecialPosition } from '../types/competition'
import './LeaderboardModal.css'

interface LeaderboardModalProps {
  isOpen: boolean
  onClose: () => void
  leaderboardData: LeaderboardResponse | null
}

type TabId = 'leaderboard' | 'taker' | 'maker' | 'pnl' | 'lottery'

interface TabConfig {
  id: TabId
  label: string
}

export default function LeaderboardModal({ isOpen, onClose, leaderboardData }: LeaderboardModalProps) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<TabId>('leaderboard')
  const [showDisqualified, setShowDisqualified] = useState(false)

  if (!isOpen) return null

  const renderHighlightedText = (text: string) => {
    const parts = text.split(/(<highlight>.*?<\/highlight>)/g)
    return parts.map((part, i) => {
      const match = part.match(/^<highlight>(.*)<\/highlight>$/)
      if (match) return <span key={i} style={{ color: 'var(--primary)' }}>{match[1]}</span>
      return part
    })
  }

  // Determine available tabs
  const configuredTabs = leaderboardData?.assets?.tabs
  const tabs: TabConfig[] = [{ id: 'leaderboard', label: t('leaderboard.tab_leaderboard') }]

  const hasTab = (name: string) => {
    if (configuredTabs) return configuredTabs.includes(name)
    return false
  }

  if (hasTab('taker') || leaderboardData?.subRankingsTaker?.length) {
    tabs.push({ id: 'taker', label: t('leaderboard.tab_taker_sprint') })
  }
  if (hasTab('maker') || leaderboardData?.subRankingsMaker?.length) {
    tabs.push({ id: 'maker', label: t('leaderboard.tab_maker_arena') })
  }
  if (hasTab('pnl') || leaderboardData?.subRankingsPnl?.length) {
    tabs.push({ id: 'pnl', label: t('leaderboard.tab_pnl') })
  }
  if (hasTab('lottery') || hasTab('daily_race') || leaderboardData?.dailyRaceItems?.length) {
    tabs.push({ id: 'lottery', label: t('leaderboard.tab_lottery') })
  }

  const showTabs = tabs.length > 1

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

  const getSpecialClass = (rank: string): string => {
    const special = leaderboardData?.specialPositions?.[rank]
    if (special) return `special-${special.color}`
    return ''
  }

  const getSpecialPosition = (rank: string): SpecialPosition | undefined => {
    return leaderboardData?.specialPositions?.[rank]
  }

  const renderMainLeaderboard = () => (
    <>
      <table className="leaderboard-table main-leaderboard-table">
        <thead>
          <tr>
            <th>{t('leaderboard.rank')}</th>
            <th>{t('leaderboard.prize')}</th>
            <th>{t('leaderboard.trader')}</th>
            <th>{t('leaderboard.score')}</th>
            <th>{t('leaderboard.volume')}</th>
            <th>{t('leaderboard.volume_24h')}</th>
            <th>{t('leaderboard.pnl')}</th>
          </tr>
        </thead>
        <tbody>
          {leaderboardData?.items.map((item: LeaderboardItem) => {
            const isCurrentUser = item.traderId?.toLowerCase() === currentUserTraderId
            const specialPosition = getSpecialPosition(item.rank)
            return (
              <tr
                key={item.traderId}
                className={`${isCurrentUser ? 'current-user-row' : ''} ${getSpecialClass(item.rank)}`}
              >
                <td className="rank-cell">
                  #{item.rank}
                  {specialPosition && (
                    <span className="special-label">
                      {specialPosition.label}
                    </span>
                  )}
                </td>
                <td className="prize-cell">
                  {leaderboardData?.prizePool?.rewards?.[item.rank]
                    ? `$${leaderboardData.prizePool.rewards[item.rank]}`
                    : '-'}
                </td>
                <td className="address-cell" title={item.traderId}>
                  {formatAddress(item.traderId)}
                  {item.superBoostStatus === 'active' && (
                    <span className="super-boost-icon" title="Super Boost Active">SB</span>
                  )}
                </td>
                <td className="numeric-cell">{item.score}</td>
                <td className="numeric-cell">${formatVolume(item.volume)}</td>
                <td className="numeric-cell volume-24h">${formatVolume(item.volume24h)}</td>
                <td className={`numeric-cell ${parseFloat(item.pnl) >= 0 ? 'positive' : 'negative'}`}>
                  {formatPnL(item.pnl)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Disqualified traders section */}
      {leaderboardData?.disqualifiedTraders && leaderboardData.disqualifiedTraders.length > 0 && (
        <div className="disqualified-section">
          <button
            className="disqualified-toggle"
            onClick={() => setShowDisqualified(!showDisqualified)}
          >
            {t('leaderboard.disqualified')} ({leaderboardData.disqualifiedTraders.length})
            <span className={`disqualified-arrow ${showDisqualified ? 'open' : ''}`}>&#9660;</span>
          </button>
          {showDisqualified && (
            <table className="leaderboard-table disqualified-table">
              <thead>
                <tr>
                  <th>{t('leaderboard.trader')}</th>
                  <th>{t('leaderboard.volume')}</th>
                  <th>{t('leaderboard.score')}</th>
                  <th>{t('leaderboard.disqualified_reason')}</th>
                </tr>
              </thead>
              <tbody>
                {leaderboardData.disqualifiedTraders.map((trader: DisqualifiedTraderEntry) => (
                  <tr key={trader.traderId} className="disqualified-row">
                    <td className="address-cell" title={trader.traderId}>
                      {formatAddress(trader.traderId)}
                    </td>
                    <td className="numeric-cell">${formatVolume(trader.volume)}</td>
                    <td className="numeric-cell">{trader.score}</td>
                    <td className="reason-cell">{trader.adjustmentReason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  )

  const renderTakerTab = () => {
    const items = leaderboardData?.subRankingsTaker
    if (!items?.length) return <div className="no-data">{t('leaderboard.no_data')}</div>
    return (
      <table className="leaderboard-table sub-ranking-table">
        <thead>
          <tr>
            <th>{t('leaderboard.rank')}</th>
            <th>{t('leaderboard.trader')}</th>
            <th>{t('leaderboard.taker_volume')}</th>
            <th>{t('leaderboard.score')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item: SubRankingEntry) => {
            const isCurrentUser = item.traderId?.toLowerCase() === currentUserTraderId
            return (
              <tr key={item.traderId} className={isCurrentUser ? 'current-user-row' : ''}>
                <td className="rank-cell">#{item.rank}</td>
                <td className="address-cell" title={item.traderId}>{formatAddress(item.traderId)}</td>
                <td className="numeric-cell">${item.takerVolume ? formatVolume(item.takerVolume) : formatVolume(item.volume)}</td>
                <td className="numeric-cell">{item.score}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    )
  }

  const renderMakerTab = () => {
    const items = leaderboardData?.subRankingsMaker
    if (!items?.length) return <div className="no-data">{t('leaderboard.no_data')}</div>
    return (
      <table className="leaderboard-table sub-ranking-table">
        <thead>
          <tr>
            <th>{t('leaderboard.rank')}</th>
            <th>{t('leaderboard.trader')}</th>
            <th>{t('leaderboard.maker_volume')}</th>
            <th>{t('leaderboard.maker_share')}</th>
            <th>{t('leaderboard.score')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item: SubRankingEntry) => {
            const isCurrentUser = item.traderId?.toLowerCase() === currentUserTraderId
            return (
              <tr key={item.traderId} className={isCurrentUser ? 'current-user-row' : ''}>
                <td className="rank-cell">#{item.rank}</td>
                <td className="address-cell" title={item.traderId}>{formatAddress(item.traderId)}</td>
                <td className="numeric-cell">${item.makerVolume ? formatVolume(item.makerVolume) : formatVolume(item.volume)}</td>
                <td className="numeric-cell">{item.makerShare != null ? `${(item.makerShare * 100).toFixed(1)}%` : '-'}</td>
                <td className="numeric-cell">{item.score}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    )
  }

  const renderPnlTab = () => {
    const items = leaderboardData?.subRankingsPnl
    if (!items?.length) return <div className="no-data">{t('leaderboard.no_data')}</div>
    return (
      <table className="leaderboard-table sub-ranking-table">
        <thead>
          <tr>
            <th>{t('leaderboard.rank')}</th>
            <th>{t('leaderboard.trader')}</th>
            <th>{t('leaderboard.realized_pnl')}</th>
            <th>{t('leaderboard.volume')}</th>
            <th>{t('leaderboard.score')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item: SubRankingEntry) => {
            const isCurrentUser = item.traderId?.toLowerCase() === currentUserTraderId
            return (
              <tr key={item.traderId} className={isCurrentUser ? 'current-user-row' : ''}>
                <td className="rank-cell">#{item.rank}</td>
                <td className="address-cell" title={item.traderId}>{formatAddress(item.traderId)}</td>
                <td className={`numeric-cell ${item.realizedPnl && parseFloat(item.realizedPnl) >= 0 ? 'positive' : 'negative'}`}>
                  {item.realizedPnl ? formatPnL(item.realizedPnl) : '-'}
                </td>
                <td className="numeric-cell">${formatVolume(item.volume)}</td>
                <td className="numeric-cell">{item.score}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    )
  }

  const renderLotteryTab = () => {
    const items = leaderboardData?.dailyRaceItems
    if (!items?.length) return <div className="no-data">{t('leaderboard.no_data')}</div>
    return (
      <table className="leaderboard-table sub-ranking-table">
        <thead>
          <tr>
            <th>{t('leaderboard.rank')}</th>
            <th>{t('leaderboard.trader')}</th>
            <th>{t('leaderboard.tickets_earned')}</th>
            <th>{t('leaderboard.daily_volume')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item: DailyRaceItem) => {
            const isCurrentUser = item.traderId?.toLowerCase() === currentUserTraderId
            return (
              <tr key={item.traderId} className={isCurrentUser ? 'current-user-row' : ''}>
                <td className="rank-cell">#{item.rank}</td>
                <td className="address-cell" title={item.traderId}>{formatAddress(item.traderId)}</td>
                <td className="numeric-cell">{item.dailyTicketsEarned}</td>
                <td className="numeric-cell">${formatVolume(item.dailyVolume)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    )
  }

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'leaderboard': return renderMainLeaderboard()
      case 'taker': return renderTakerTab()
      case 'maker': return renderMakerTab()
      case 'pnl': return renderPnlTab()
      case 'lottery': return renderLotteryTab()
      default: return renderMainLeaderboard()
    }
  }

  return (
    <div className="leaderboard-modal-overlay" onClick={onClose}>
      <div className="leaderboard-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="leaderboard-modal-header">
          <h2>{leaderboardData?.title ? renderHighlightedText(leaderboardData.title) : t('leaderboard.title')}</h2>
          <button className="leaderboard-modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        {(leaderboardData?.rewardPool || (leaderboardData?.prizePool?.milestones && leaderboardData.prizePool.milestones.length > 0)) && (
          <div className="leaderboard-reward-info">
            <span className="reward-label">{t('leaderboard.reward_pool')}</span>
            <span className="reward-value">
              ${leaderboardData?.rewardPool || leaderboardData?.prizePool?.milestones[leaderboardData?.prizePool?.milestoneIndex >= 0 ? leaderboardData.prizePool.milestoneIndex : 0]?.rewardPool || '0'}
            </span>
            {leaderboardData?.prizePool?.activeMilestone && (
              <span className="active-milestone-info">
                (${formatVolume(leaderboardData.prizePool.activeMilestone.targetVolume)} target)
              </span>
            )}
          </div>
        )}

        {leaderboardData?.lottery && (
          <div className="leaderboard-lottery-info">
            <span className="lottery-label">{t('leaderboard.lottery')}</span>
            <span className="lottery-value">${leaderboardData.lottery.potSize}</span>
            <span className="lottery-separator">·</span>
            <span className="lottery-details">
              {leaderboardData.lottery.winners} {t('leaderboard.lottery_winners')} × ${leaderboardData.lottery.prize}
            </span>
            <span className="lottery-separator">·</span>
            <span className="lottery-requirement">
              {t('leaderboard.lottery_eligible')}: #{leaderboardData.lottery.minRank}+ {t('leaderboard.lottery_with')} {leaderboardData.lottery.minScore}+ {t('leaderboard.score').toLowerCase()}
            </span>
          </div>
        )}

        {/* Tab bar */}
        {showTabs && (
          <div className="leaderboard-tab-bar">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={`leaderboard-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        <div className="leaderboard-table-container" key={activeTab}>
          {renderActiveTab()}
        </div>
      </div>
    </div>
  )
}
