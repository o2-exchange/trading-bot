import Decimal from 'decimal.js'

export interface FormatPriceOptions {
  prefix?: string
  maxDecimals?: number
  minSignificantDigits?: number
  trimTrailingZeros?: boolean
}

/**
 * Format a price with appropriate decimal places based on magnitude.
 * Ensures small prices like 0.00017 are displayed correctly.
 *
 * Examples:
 *   50000     -> "$50000"
 *   3500.50   -> "$3500.5"
 *   1.5       -> "$1.50"
 *   0.05      -> "$0.05"
 *   0.0017    -> "$0.0017"
 *   0.00017   -> "$0.00017"
 *   0.0000005 -> "$0.0000005"
 */
export function formatPrice(
  price: Decimal | string | number,
  options?: FormatPriceOptions
): string {
  const {
    prefix = '$',
    maxDecimals = 8,
    minSignificantDigits = 2,
    trimTrailingZeros = true
  } = options || {}

  const priceDecimal = price instanceof Decimal ? price : new Decimal(price)

  if (priceDecimal.isZero() || priceDecimal.isNaN() || !priceDecimal.isFinite()) {
    return `${prefix}0`
  }

  const priceValue = priceDecimal.abs().toNumber()

  // Determine base decimals based on price magnitude
  let decimals: number
  if (priceValue >= 10000) {
    decimals = 0
  } else if (priceValue >= 1000) {
    decimals = 1
  } else if (priceValue >= 1) {
    decimals = 2
  } else if (priceValue >= 0.01) {
    decimals = 4
  } else if (priceValue >= 0.0001) {
    decimals = 6
  } else {
    decimals = maxDecimals
  }

  // Ensure we have at least minSignificantDigits significant figures
  // For a price like 0.00017, we need 5 decimals to show 2 significant figures
  if (priceValue > 0 && priceValue < 1) {
    const magnitude = Math.floor(Math.log10(priceValue))
    const neededDecimals = -magnitude + minSignificantDigits - 1
    decimals = Math.max(decimals, neededDecimals)
  }

  // Cap at maxDecimals
  decimals = Math.min(decimals, maxDecimals)

  const formatted = priceDecimal.toFixed(decimals)

  // Remove trailing zeros if requested (but keep at least one decimal for prices < 10)
  let result = formatted
  if (trimTrailingZeros) {
    // Remove trailing zeros after decimal point
    result = formatted.replace(/(\.\d*?)0+$/, '$1')
    // Remove trailing decimal point if no decimals left
    result = result.replace(/\.$/, '')
  }

  return `${prefix}${result}`
}

/**
 * Format a raw price (scaled by decimals) to human-readable format.
 *
 * @param rawPrice - Price in raw/scaled format (e.g., "170000000" for 0.17 with 9 decimals)
 * @param quoteDecimals - Number of decimals the quote currency uses
 * @param options - Formatting options
 */
export function formatRawPrice(
  rawPrice: string,
  quoteDecimals: number,
  options?: FormatPriceOptions
): string {
  try {
    const priceHuman = new Decimal(rawPrice).div(new Decimal(10).pow(quoteDecimals))
    return formatPrice(priceHuman, options)
  } catch (error) {
    console.error('Error formatting raw price:', error, rawPrice)
    return options?.prefix ? `${options.prefix}${rawPrice}` : rawPrice
  }
}

/**
 * Format a quantity with appropriate decimal places.
 * Removes trailing zeros and limits to a sensible number of decimals.
 *
 * @param rawQuantity - Quantity in raw/scaled format
 * @param baseDecimals - Number of decimals the base currency uses
 * @param maxDisplayDecimals - Maximum decimals to display (default: 6)
 */
export function formatRawQuantity(
  rawQuantity: string,
  baseDecimals: number,
  maxDisplayDecimals: number = 6
): string {
  try {
    const qtyHuman = new Decimal(rawQuantity).div(new Decimal(10).pow(baseDecimals))

    if (qtyHuman.isZero()) {
      return '0'
    }

    // For very small quantities, show more decimals
    const qtyValue = qtyHuman.abs().toNumber()
    let decimals = 3 // Default

    if (qtyValue < 0.001) {
      decimals = 6
    } else if (qtyValue < 0.01) {
      decimals = 5
    } else if (qtyValue < 0.1) {
      decimals = 4
    }

    decimals = Math.min(decimals, maxDisplayDecimals)

    const formatted = qtyHuman.toFixed(decimals)
    // Remove trailing zeros
    return formatted.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  } catch (error) {
    console.error('Error formatting raw quantity:', error, rawQuantity)
    return rawQuantity
  }
}

/**
 * Format a total value (price * quantity) with appropriate decimals.
 * Uses 2 decimals for values >= 0.01, more for smaller values.
 */
export function formatTotal(
  total: Decimal | string | number,
  prefix: string = '$'
): string {
  const totalDecimal = total instanceof Decimal ? total : new Decimal(total)

  if (totalDecimal.isZero() || totalDecimal.isNaN() || !totalDecimal.isFinite()) {
    return `${prefix}0.00`
  }

  const value = totalDecimal.abs().toNumber()

  let decimals = 2
  if (value < 0.01 && value > 0) {
    decimals = 4
  }
  if (value < 0.0001 && value > 0) {
    decimals = 6
  }

  const formatted = totalDecimal.toFixed(decimals)
  const trimmed = formatted.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')

  return `${prefix}${trimmed}`
}
