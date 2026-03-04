import axios, { AxiosInstance } from 'axios'
import { Competition, CompetitionListResponse, CompetitionLayout, LeaderboardResponse } from '../types/competition'
import { O2_ANALYTICS_API_URL } from '../constants/o2Constants'

/**
 * Normalize a Fuel B256 address (64-char hex with 24 leading zeros) to a 40-char EVM address.
 * If the address is already 40 chars (with 0x prefix = 42), return as-is.
 */
function normalizeAddress(address: string): string {
  if (!address) return address
  const clean = address.startsWith('0x') ? address.slice(2) : address
  // Fuel B256 addresses are 64 hex chars; if the first 24 are zeros, strip them to get 40-char EVM address
  if (clean.length === 64 && clean.startsWith('000000000000000000000000')) {
    return '0x' + clean.slice(24)
  }
  return address.startsWith('0x') ? address : '0x' + address
}

/**
 * Strip HTML tags from a string (e.g. <highlight>...</highlight>)
 */
function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, '')
}

class CompetitionService {
  private client: AxiosInstance

  constructor(baseUrl: string = O2_ANALYTICS_API_URL) {
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Referer': 'https://trade.o2.app/',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36',
      },
    })
  }

  /**
   * Get list of all competitions
   */
  async getCompetitionList(): Promise<CompetitionListResponse> {
    const response = await this.client.get<CompetitionListResponse>('/competition/list')
    const data = response.data

    // Parse new fields from API response
    if (data.competitions) {
      data.competitions = data.competitions.map((comp: any) => {
        const parsed: Competition = {
          ...comp,
          slug: comp.slug || undefined,
          layout: (comp.assets?.layout || comp.layout || 'standard') as CompetitionLayout,
          marketBoosts: comp.market_boosts || comp.marketBoosts || undefined,
          streakConfig: comp.streak_config || comp.streakConfig || undefined,
          placeholderVolumeTarget: comp.placeholder_volume_target || comp.placeholderVolumeTarget || undefined,
        }
        return parsed
      })
    }

    return data
  }

  /**
   * Get leaderboard for a specific competition
   * @param competitionId - The competition ID
   * @param walletAddress - The wallet address to get current user info
   */
  async getLeaderboard(competitionId: string, walletAddress: string): Promise<LeaderboardResponse> {
    const response = await this.client.get<LeaderboardResponse>('/competition/leaderboard', {
      params: {
        current_address: walletAddress.toLowerCase(),
        competition_id: competitionId,
      },
    })
    const data: any = response.data

    // Normalize addresses in leaderboard items
    if (data.items) {
      data.items = data.items.map((item: any) => ({
        ...item,
        traderId: normalizeAddress(item.traderId || item.trader_id),
        tradingAccount: normalizeAddress(item.tradingAccount || item.trading_account),
      }))
    }

    // Normalize current user address and parse nested fields
    if (data.currentUser || data.current_user) {
      const cu = data.currentUser || data.current_user
      data.currentUser = {
        ...cu,
        traderId: normalizeAddress(cu.traderId || cu.trader_id),
        tradingAccount: normalizeAddress(cu.tradingAccount || cu.trading_account),
        // Parse streak with snake_case fallback
        streak: cu.streak || cu.daily_streak || undefined,
        // Parse lottery with snake_case fallback
        lottery: cu.lottery ? {
          ticketsThisPeriod: cu.lottery.ticketsThisPeriod ?? cu.lottery.tickets_this_period ?? 0,
          ticketsTotal: cu.lottery.ticketsTotal ?? cu.lottery.tickets_total ?? 0,
          winsCount: cu.lottery.winsCount ?? cu.lottery.wins_count ?? 0,
        } : undefined,
        // Parse sub-ranking fields
        takerRank: cu.takerRank || cu.taker_rank || undefined,
        makerRank: cu.makerRank || cu.maker_rank || undefined,
        pnlRank: cu.pnlRank || cu.pnl_rank || undefined,
        superBoostStatus: cu.superBoostStatus || cu.super_boost_status || undefined,
        superBoostStreakBrokenDay: cu.superBoostStreakBrokenDay ?? cu.super_boost_streak_broken_day ?? undefined,
      }
    }

    // Helper to normalize addresses in sub-ranking entries
    const normalizeSubRankingEntries = (entries: any[] | undefined) => {
      if (!entries) return undefined
      return entries.map((item: any) => ({
        ...item,
        traderId: normalizeAddress(item.traderId || item.trader_id),
        tradingAccount: normalizeAddress(item.tradingAccount || item.trading_account),
      }))
    }

    // Parse sub-rankings (handle both camelCase and snake_case) and normalize addresses
    data.subRankingsTaker = normalizeSubRankingEntries(data.subRankingsTaker || data.sub_rankings_taker)
    data.subRankingsMaker = normalizeSubRankingEntries(data.subRankingsMaker || data.sub_rankings_maker)
    data.subRankingsPnl = normalizeSubRankingEntries(data.subRankingsPnl || data.sub_rankings_pnl)
    data.dailyRaceItems = normalizeSubRankingEntries(data.dailyRaceItems || data.daily_race_items)

    // Normalize dailyRaceItems ticket field fallback (API may use `tickets` instead of `dailyTicketsEarned`)
    if (data.dailyRaceItems) {
      data.dailyRaceItems = data.dailyRaceItems.map((item: any) => ({
        ...item,
        dailyTicketsEarned: item.dailyTicketsEarned ?? item.daily_tickets_earned ?? item.tickets ?? 0,
        dailyVolume: item.dailyVolume || item.daily_volume || '0',
      }))
    }

    // Parse current user sub-rankings and normalize addresses
    const normalizeSubRankingEntry = (entry: any) => {
      if (!entry) return undefined
      return {
        ...entry,
        traderId: normalizeAddress(entry.traderId || entry.trader_id),
        tradingAccount: normalizeAddress(entry.tradingAccount || entry.trading_account),
      }
    }
    data.currentUserSubRankingTaker = normalizeSubRankingEntry(data.currentUserSubRankingTaker || data.current_user_sub_ranking_taker)
    data.currentUserSubRankingMaker = normalizeSubRankingEntry(data.currentUserSubRankingMaker || data.current_user_sub_ranking_maker)
    data.currentUserSubRankingPnl = normalizeSubRankingEntry(data.currentUserSubRankingPnl || data.current_user_sub_ranking_pnl)

    // Parse current user daily race with ticket field fallback
    const rawDailyRace = data.currentUserDailyRace || data.current_user_daily_race
    if (rawDailyRace) {
      data.currentUserDailyRace = {
        ...rawDailyRace,
        traderId: normalizeAddress(rawDailyRace.traderId || rawDailyRace.trader_id),
        tradingAccount: normalizeAddress(rawDailyRace.tradingAccount || rawDailyRace.trading_account),
        dailyTicketsEarned: rawDailyRace.dailyTicketsEarned ?? rawDailyRace.daily_tickets_earned ?? rawDailyRace.tickets ?? 0,
        dailyVolume: rawDailyRace.dailyVolume || rawDailyRace.daily_volume || '0',
      }
    } else {
      data.currentUserDailyRace = undefined
    }

    // Parse disqualified traders
    data.disqualifiedTraders = data.disqualifiedTraders || data.disqualified_traders || undefined

    // Parse streak config
    data.streakConfig = data.streakConfig || data.streak_config || undefined

    // Parse market boosts
    data.marketBoosts = data.marketBoosts || data.market_boosts || undefined

    // Parse PnL ranking config
    data.pnlRankingConfig = data.pnlRankingConfig || data.pnl_ranking_config || undefined

    // Parse prize pool active milestone
    if (data.prizePool?.activeMilestone || data.prize_pool?.active_milestone) {
      if (!data.prizePool) {
        data.prizePool = data.prize_pool
      }
      if (data.prizePool && !data.prizePool.activeMilestone) {
        data.prizePool.activeMilestone = data.prize_pool?.active_milestone || undefined
      }
    }

    // Parse slug
    data.slug = data.slug || undefined

    // Parse completion status
    data.isComplete = data.isComplete ?? data.is_complete ?? undefined

    // Parse total rewards
    data.totalRewards = data.totalRewards || data.total_rewards || undefined

    return data as LeaderboardResponse
  }

  /**
   * Determine which competition is currently active
   * A competition is active if startDate <= now and (endDate === null or endDate >= now)
   * Ignores "Hall of Fame" competition (by layout or title)
   */
  getActiveCompetition(competitions: Competition[]): Competition | null {
    const now = new Date().getTime()

    for (const competition of competitions) {
      // Ignore Hall of Fame competition by layout first, then by title as fallback
      const layout = competition.layout || competition.assets?.layout
      if (layout === 'halloffame') {
        continue
      }
      const plainTitle = stripHtml(competition.title)
      if (plainTitle.includes('Hall of Fame')) {
        continue
      }

      const startDate = new Date(competition.startDate).getTime()
      const endDate = competition.endDate ? new Date(competition.endDate).getTime() : null

      const hasStarted = startDate <= now
      const hasNotEnded = endDate === null || endDate >= now

      if (hasStarted && hasNotEnded) {
        return competition
      }
    }

    return null
  }
}

export const competitionService = new CompetitionService()
