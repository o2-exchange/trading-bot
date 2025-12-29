import { TradingAccountBalances, Balance } from '../types/tradingAccount'
import { HIDE_USDT_IN_UI } from '../constants/o2Constants'
import './Balances.css'

interface BalancesProps {
  balances: TradingAccountBalances | null
  loading?: boolean
}

export default function Balances({ balances, loading }: BalancesProps) {
  if (loading) {
    return (
      <div className="balances">
        <p>Loading balances...</p>
      </div>
    )
  }

  if (!balances || balances.balances.length === 0) {
    return (
      <div className="balances">
        <p>No balances found</p>
      </div>
    )
  }

  const formatBalance = (value: string, decimals: number): string => {
    try {
      // Use BigInt to handle large numbers safely
      const valueBigInt = BigInt(value || '0')
      const divisor = BigInt(10 ** decimals)
      
      // Calculate integer and fractional parts
      const integerPart = valueBigInt / divisor
      const fractionalPart = valueBigInt % divisor
      
      // Format fractional part with leading zeros
      const fractionalStr = fractionalPart.toString().padStart(decimals, '0')
      
      // Remove trailing zeros from fractional part
      const fractionalTrimmed = fractionalStr.replace(/0+$/, '')
      
      // Combine integer and fractional parts
      if (fractionalTrimmed === '') {
        return integerPart.toString()
      }
      
      return `${integerPart}.${fractionalTrimmed}`
    } catch (error) {
      console.error('Error formatting balance:', error, value)
      return '0'
    }
  }

  return (
    <div className="balances">
      <table className="balances-table">
        <thead>
          <tr>
            <th>Asset</th>
            <th>Available</th>
            <th>Locked</th>
            <th>Value (USD)</th>
          </tr>
        </thead>
        <tbody>
          {balances.balances
            .filter((balance) => !HIDE_USDT_IN_UI || balance.assetSymbol !== 'USDT')
            .map((balance: Balance) => (
            <tr key={balance.assetId}>
              <td>{balance.assetSymbol}</td>
              <td className="tabular-nums">{formatBalance(balance.unlocked, balance.decimals)}</td>
              <td className="tabular-nums">{formatBalance(balance.locked, balance.decimals)}</td>
              <td className="tabular-nums value-usd">{balance.valueUsd ? `$${balance.valueUsd}` : '—'}</td>
            </tr>
          ))}
        </tbody>
        {balances.totalValueUsd && balances.totalValueUsd > 0 && (
          <tfoot>
            <tr className="total-row">
              <td colSpan={3}>Total</td>
              <td className="tabular-nums value-usd">${balances.totalValueUsd.toFixed(2)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
