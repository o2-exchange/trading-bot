import Decimal from 'decimal.js'
import { Market } from '../types/market'

export interface OrderValidationResult {
  valid: boolean
  adjustedPrice: Decimal
  adjustedQuantity: Decimal
  errors: string[]
  warnings: string[]
}

/**
 * Validate and adjust order parameters to match market constraints.
 * This ensures orders won't be rejected on-chain due to precision issues.
 *
 * @param price - Price in human-readable format (e.g., 0.00017)
 * @param quantity - Quantity in human-readable format (e.g., 100)
 * @param market - Market configuration with tick_size, step_size, and max_precision
 * @returns Validation result with adjusted values and any errors/warnings
 */
export function validateOrderParams(
  price: Decimal,
  quantity: Decimal,
  market: Market
): OrderValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  let adjustedPrice = price
  let adjustedQuantity = quantity

  // Validate tick size (price precision)
  if (market.tick_size) {
    const tickSize = new Decimal(market.tick_size)
    if (!tickSize.isZero()) {
      const tickAlignedPrice = price.div(tickSize).floor().mul(tickSize)

      if (!tickAlignedPrice.eq(price)) {
        warnings.push(
          `Price adjusted from ${price.toString()} to ${tickAlignedPrice.toString()} to match tick size ${tickSize.toString()}`
        )
        adjustedPrice = tickAlignedPrice
      }
    }
  }

  // Validate step size (quantity precision)
  if (market.step_size) {
    const stepSize = new Decimal(market.step_size)
    if (!stepSize.isZero()) {
      const stepAlignedQty = quantity.div(stepSize).floor().mul(stepSize)

      if (!stepAlignedQty.eq(quantity)) {
        warnings.push(
          `Quantity adjusted from ${quantity.toString()} to ${stepAlignedQty.toString()} to match step size ${stepSize.toString()}`
        )
        adjustedQuantity = stepAlignedQty
      }
    }
  }

  // Validate against max_precision for price
  if (market.quote?.max_precision !== undefined) {
    const maxPrecision = market.quote.max_precision
    const quoteDecimals = market.quote.decimals

    // Only apply if maxPrecision < decimals (otherwise no truncation needed)
    if (maxPrecision < quoteDecimals) {
      // Scale price to raw format
      const scaledPrice = adjustedPrice.mul(new Decimal(10).pow(quoteDecimals))
      const truncateFactor = new Decimal(10).pow(quoteDecimals - maxPrecision)
      const truncatedScaled = scaledPrice.div(truncateFactor).floor().mul(truncateFactor)

      if (!truncatedScaled.eq(scaledPrice.floor())) {
        const newHumanPrice = truncatedScaled.div(new Decimal(10).pow(quoteDecimals))
        warnings.push(
          `Price truncated to max_precision ${maxPrecision}: ${adjustedPrice.toString()} -> ${newHumanPrice.toString()}`
        )
        adjustedPrice = newHumanPrice
      }
    }
  }

  // Check for zero values after adjustments
  if (adjustedPrice.isZero() || adjustedPrice.isNegative()) {
    errors.push(
      `Price would be ${adjustedPrice.isZero() ? 'zero' : 'negative'} after precision adjustment - price too small for this market`
    )
  }

  if (adjustedQuantity.isZero() || adjustedQuantity.isNegative()) {
    errors.push(
      `Quantity would be ${adjustedQuantity.isZero() ? 'zero' : 'negative'} after precision adjustment - quantity too small for this market`
    )
  }

  return {
    valid: errors.length === 0,
    adjustedPrice,
    adjustedQuantity,
    errors,
    warnings
  }
}

/**
 * Validate price against market's tick size.
 *
 * @param price - Price in human-readable format
 * @param market - Market configuration
 * @returns Adjusted price aligned to tick size
 */
export function alignPriceToTickSize(price: Decimal, market: Market): Decimal {
  if (!market.tick_size) {
    return price
  }

  const tickSize = new Decimal(market.tick_size)
  if (tickSize.isZero()) {
    return price
  }

  return price.div(tickSize).floor().mul(tickSize)
}

/**
 * Validate quantity against market's step size.
 *
 * @param quantity - Quantity in human-readable format
 * @param market - Market configuration
 * @returns Adjusted quantity aligned to step size
 */
export function alignQuantityToStepSize(quantity: Decimal, market: Market): Decimal {
  if (!market.step_size) {
    return quantity
  }

  const stepSize = new Decimal(market.step_size)
  if (stepSize.isZero()) {
    return quantity
  }

  return quantity.div(stepSize).floor().mul(stepSize)
}

/**
 * Check if a price is valid for a given market (non-zero after truncation).
 *
 * @param price - Price in human-readable format
 * @param market - Market configuration
 * @returns True if price would be valid after all adjustments
 */
export function isPriceValidForMarket(price: Decimal, market: Market): boolean {
  const result = validateOrderParams(price, new Decimal(1), market)
  return !result.adjustedPrice.isZero() && !result.adjustedPrice.isNegative()
}

/**
 * Get the minimum valid price for a market based on its precision constraints.
 *
 * @param market - Market configuration
 * @returns Minimum valid price as a Decimal
 */
export function getMinimumPrice(market: Market): Decimal {
  const quoteDecimals = market.quote?.decimals || 9
  const maxPrecision = market.quote?.max_precision || quoteDecimals

  // Minimum price is 10^(-(quoteDecimals - (quoteDecimals - maxPrecision)))
  // Simplified: 10^(-maxPrecision) when scaled up, which is 10^(maxPrecision - quoteDecimals) in human terms
  // Actually: the minimum is 1 in scaled format at the max precision level
  // min_scaled = 10^(quoteDecimals - maxPrecision)
  // min_human = min_scaled / 10^quoteDecimals = 10^(-maxPrecision)

  // If tick_size is set, use that as the minimum
  if (market.tick_size) {
    return new Decimal(market.tick_size)
  }

  // Otherwise calculate from max_precision
  return new Decimal(10).pow(-maxPrecision)
}

/**
 * Get the minimum valid quantity for a market based on its precision constraints.
 *
 * @param market - Market configuration
 * @returns Minimum valid quantity as a Decimal
 */
export function getMinimumQuantity(market: Market): Decimal {
  if (market.step_size) {
    return new Decimal(market.step_size)
  }

  // Fallback: use 6 decimal places as minimum (0.000001)
  const baseDecimals = market.base?.decimals || 18
  const maxPrecision = Math.min(market.base?.max_precision || 6, 6)
  return new Decimal(10).pow(-maxPrecision)
}
