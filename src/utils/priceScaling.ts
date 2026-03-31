import Decimal from 'decimal.js'

/**
 * Scales up a Decimal by a given number of decimals and truncates it
 * according to the maximum precision or tick size.
 *
 * @param amount - Price in human-readable format
 * @param decimals - Number of decimals for the quote asset
 * @param maxPrecision - Maximum precision allowed
 * @param tickSize - Optional tick size string from market config (in human-readable format)
 * @param roundUp - If true, round UP (ceil) instead of down (floor).
 *                  Use true for sell orders to ensure price stays above the ask.
 *                  Use false (default) for buy orders to stay at or below the bid.
 * @returns Scaled and truncated price as integer
 */
export function scaleUpAndTruncateToInt(
  amount: Decimal,
  decimals: number,
  maxPrecision: number,
  tickSize?: string,
  roundUp: boolean = false
): Decimal {
  const round = roundUp ? (v: Decimal) => v.ceil() : (v: Decimal) => v.floor()

  // If tick_size is available, use it for alignment (more precise than max_precision)
  if (tickSize) {
    const tickSizeDecimal = new Decimal(tickSize)
    if (!tickSizeDecimal.isZero()) {
      // Align price to tick size first (in human format)
      const tickAlignedPrice = round(amount.div(tickSizeDecimal)).mul(tickSizeDecimal)
      // Then scale to raw integer
      return round(tickAlignedPrice.mul(new Decimal(10).pow(decimals)))
    }
  }

  // Fallback to max_precision-based truncation
  const effectivePrecision = maxPrecision !== undefined && maxPrecision >= 0 ? maxPrecision : decimals
  const priceInt = amount.mul(new Decimal(10).pow(decimals))
  const truncateFactor = new Decimal(10).pow(decimals - effectivePrecision)

  if (truncateFactor.lte(1)) {
    return round(priceInt)
  }

  return round(priceInt.div(truncateFactor)).mul(truncateFactor)
}
