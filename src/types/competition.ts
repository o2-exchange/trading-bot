// --- Competition Layout Types ---

export type CompetitionLayout = 'standard' | 'lottery' | 'dailystreak' | 'dailystreak_v2' | 'dailystreak_v3' | 'halloffame'

export interface DailyStreakPeriod {
  name?: string
  boostBp: number
  superBoostBp?: number
  superBoostStreakNeeded?: number
  thresholdPercent?: number
  startTime: string
  endTime: string
}

export interface StreakConfig {
  enabled: boolean
  currentPeriodIndex: number
  periods: DailyStreakPeriod[]
}

export interface UserStreakPeriod {
  periodIndex: number
  targetMet: boolean
  targetVolume: string
  volume: string
  isComplete: boolean
}

export interface UserStreak {
  currentPeriodIndex: number
  superBoostEligible: boolean
  streakCount: number
  periods: UserStreakPeriod[]
  superBoostStatus?: 'active' | 'lost' | 'eligible'
  superBoostStreakBrokenDay?: number
}

export interface UserLotteryStatus {
  ticketsThisPeriod: number
  ticketsTotal: number
  winsCount: number
}

export interface SubRankingEntry {
  traderId: string
  tradingAccount: string
  rank: number
  score: number
  volume: string
  takerVolume?: string
  takerVolumeBoosted?: string
  makerVolume?: string
  makerVolumeBoosted?: string
  makerShare?: number
  realizedPnl?: string
  superBoostStatus?: string
  isQualifiedPnl?: boolean
}

export interface LotteryWinDetail {
  period?: number
  amount?: string
}

export interface DailyRaceItem {
  rank: string
  traderId: string
  tradingAccount: string
  dailyTicketsEarned: number
  dailyVolume: string
  nextTicketAt?: string
  wins?: LotteryWinDetail[]
}

export interface DisqualifiedTraderEntry {
  traderId: string
  tradingAccount: string
  pnl: string
  volume: string
  score: string
  rank: string
  adjustmentReason: string
  adjustmentType: string
}

export interface ActiveMilestone {
  targetVolume: string
  rewardPool: string
}

// --- Core Competition Types ---

export interface Competition {
  competitionId: string
  title: string
  subtitle: string
  symbols: string[]
  slug?: string
  layout: CompetitionLayout
  assets: {
    light: {
      backgroundImage: string
      color: string
    }
    dark: {
      backgroundImage: string
      color: string
    }
    tabs?: string[]
    layout?: CompetitionLayout
  }
  totalTraders: number
  totalVolume: string
  /** @deprecated Use prizePool.milestones from LeaderboardResponse instead. Kept for backward compatibility. */
  rewardPool?: string
  startDate: string
  endDate: string | null
  marketBoosts?: Record<string, number>
  streakConfig?: StreakConfig
  placeholderVolumeTarget?: string
  prizePool?: {
    milestones: Milestone[]
    activeMilestone?: ActiveMilestone
  }
}

export interface Milestone {
  /** Target volume threshold in string format with 9 decimals */
  targetVolume: string
  /** Reward pool amount for this milestone in string format with no decimals */
  rewardPool: string
  /** Reward multiplier in basis points where 10000 = 1.0x */
  multiplier: string
}

export interface PrizePoolSchema {
  /** Rank-based reward mapping (rank as string -> reward amount as string) */
  rewards: Record<string, string>
  /** Volume milestone configurations ordered by targetVolume ascending */
  milestones: Milestone[]
}

export interface FormattedPrizePool extends PrizePoolSchema {
  /** Index of the currently active milestone based on total volume */
  milestoneIndex: number
  /** Currently active milestone details */
  activeMilestone?: ActiveMilestone
}

export interface CompetitionListResponse {
  competitions: Competition[]
}

/** @deprecated Use UserStreak instead */
export interface StreakInfo {
  current: number
  longest: number
}

export interface LeaderboardItem {
  traderId: string
  tradingAccount: string
  pnl: string
  realizedPnl: string
  unrealizedPnl: string
  volume: string
  volume24h: string
  volumeWithoutSelfTrade: string
  volumeWithoutSelfTrade24h: string
  boostedVolume: string
  rank: string
  score: string
  referralVolume: string
  /** @deprecated Use streak (UserStreak) for detailed streak data */
  streak?: StreakInfo | UserStreak
  takerVolume?: string
  makerVolume?: string
  takerScore?: string
  makerScore?: string
  takerRank?: string
  makerRank?: string
  pnlRank?: string
  superBoostStatus?: string
  superBoostStreakBrokenDay?: number
  lottery?: UserLotteryStatus
}

export interface LotteryInfo {
  potSize: string
  winners: string
  prize: string
  minRank: string
  minScore: string
}

export interface SpecialPosition {
  color: string
  label: string
}

export interface LeaderboardResponse {
  items: LeaderboardItem[]
  totalTraders: string
  totalVolume: string
  prizePool: FormattedPrizePool
  /** @deprecated Use prizePool.milestones instead. Kept for backward compatibility. */
  rewardPool?: string
  currentUser: LeaderboardItem | null
  competitionId: string
  slug?: string
  title: string
  subtitle: string
  symbols: string[]
  assets: {
    light: {
      backgroundImage: string
      color: string
    }
    dark: {
      backgroundImage: string
      color: string
    }
    tabs?: string[]
  }
  ruleType: number
  rules?: string
  markets: string[]
  startDate: string
  endDate: string | null
  lottery?: LotteryInfo
  specialPositions?: Record<string, SpecialPosition>
  marketBoosts?: Record<string, number>
  streakConfig?: StreakConfig
  // Sub-rankings
  subRankingsTaker?: SubRankingEntry[]
  subRankingsMaker?: SubRankingEntry[]
  subRankingsPnl?: SubRankingEntry[]
  dailyRaceItems?: DailyRaceItem[]
  currentUserSubRankingTaker?: SubRankingEntry
  currentUserSubRankingMaker?: SubRankingEntry
  currentUserSubRankingPnl?: SubRankingEntry
  currentUserDailyRace?: DailyRaceItem
  disqualifiedTraders?: DisqualifiedTraderEntry[]
  pnlWeights?: Record<string, number>
  pnlRankingConfig?: {
    minVolume?: string
    requirePositivePnl?: boolean
  }
  totalRewards?: string
  isComplete?: boolean
}
