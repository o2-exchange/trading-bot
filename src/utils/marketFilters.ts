import { Market } from '../types/market'
import { HIDE_USDT_IN_UI, HIDE_MOOR_IN_UI } from '../constants/o2Constants'

/**
 * Filters markets based on configuration flags.
 * When enabled, filters out markets where the base symbol matches a hidden token.
 *
 * @param markets - Array of markets to filter
 * @returns Filtered array of markets
 */
export function filterMarkets(markets: Market[]): Market[] {
  return markets.filter((market) => {
    if (HIDE_USDT_IN_UI && market.base.symbol === 'USDT') return false
    if (HIDE_MOOR_IN_UI && market.base.symbol === 'MOOR') return false
    return true
  })
}

