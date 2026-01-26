export interface Competition {
  competitionId: string
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
  }
  totalTraders: number
  totalVolume: string
  /** @deprecated Use prizePool.milestones from LeaderboardResponse instead. Kept for backward compatibility. */
  rewardPool?: string
  startDate: string
  endDate: string | null
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
}

export interface CompetitionListResponse {
  competitions: Competition[]
}

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
  streak?: StreakInfo
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
  }
  ruleType: number
  markets: string[]
  startDate: string
  endDate: string | null
  lottery?: LotteryInfo
  specialPositions?: Record<string, SpecialPosition>
  marketBoosts?: Record<string, number>
}

