import { useState, useEffect, useRef } from 'react'
import { Trade } from '../types/trade'
import { tradeHistoryService } from '../services/tradeHistoryService'
import { tradingEngine } from '../services/tradingEngine'
import { marketService } from '../services/marketService'
import './TradeHistory.css'

export default function TradeHistory() {
  const [trades, setTrades] = useState<Trade[]>([])
  const [markets, setMarkets] = useState<Map<string, any>>(new Map())
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const loadTrades = async () => {
    const recentTrades = await tradeHistoryService.getRecentTrades(50)
    setTrades(recentTrades)
  }
  
  const formatValue = (value: string, decimals: number = 18, maxDisplayDecimals: number = 8): string => {
    try {
      const bigIntValue = BigInt(value || '0')
      const divisor = BigInt(10 ** decimals)

      const integerPart = bigIntValue / divisor
      const fractionalPart = bigIntValue % divisor

      const fractionalStr = fractionalPart.toString().padStart(decimals, '0')
      const fractionalTrimmed = fractionalStr.replace(/0+$/, '')

      if (fractionalTrimmed === '') {
        return integerPart.toString()
      }

      // Format with appropriate decimal places
      const displayDecimals = Math.min(fractionalTrimmed.length, maxDisplayDecimals)
      return `${integerPart}.${fractionalTrimmed.slice(0, displayDecimals)}`
    } catch (error) {
      console.error('Error formatting value:', error, value)
      return value
    }
  }
  
  const formatPrice = (price: string, marketId: string, priceFill?: string): string => {
    const market = markets.get(marketId)
    // Price is typically in quote token decimals
    const decimals = market?.quote?.decimals || 18
    
    // Prefer fill price if available, otherwise use limit price
    const priceToFormat = priceFill && priceFill !== '0' ? priceFill : price
    return formatValue(priceToFormat, decimals)
  }
  
  const formatQuantity = (quantity: string, marketId: string, side: 'Buy' | 'Sell'): string => {
    const market = markets.get(marketId)
    // Quantity is in base token decimals, limit to 3 decimal places for display
    const decimals = market?.base?.decimals || 18
    return formatValue(quantity, decimals, 3)
  }

  useEffect(() => {
    // Load markets first, then trades
    const loadMarkets = async () => {
      try {
        const marketsList = await marketService.fetchMarkets()
        const marketsMap = new Map(marketsList.map(m => [m.market_id, m]))
        setMarkets(marketsMap)
      } catch (error) {
        console.error('Failed to load markets for formatting', error)
      }
    }
    
    loadMarkets()
    loadTrades()

    // Set up auto-refresh when trading is active
    const checkTradingStatus = () => {
      const isTrading = tradingEngine.isActive()
      
      if (isTrading) {
        // Start polling every 5 seconds when trading
        if (!refreshIntervalRef.current) {
          refreshIntervalRef.current = setInterval(() => {
            loadTrades()
          }, 5000)
        }
      } else {
        // Stop polling when not trading
        if (refreshIntervalRef.current) {
          clearInterval(refreshIntervalRef.current)
          refreshIntervalRef.current = null
        }
      }
    }

    // Check initially
    checkTradingStatus()

    // Check periodically (every 2 seconds) if trading status changed
    const statusCheckInterval = setInterval(checkTradingStatus, 2000)

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current)
      }
      clearInterval(statusCheckInterval)
    }
  }, [])

  const formatAddress = (address: string) => {
    return `${address.slice(0, 8)}...${address.slice(-6)}`
  }

  return (
    <div className="trade-history">
      <h2>Trade History</h2>
      {trades.length === 0 ? (
        <div className="empty-state">No trades yet</div>
      ) : (
        <div className="trades-table-container">
        <table className="trades-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Market</th>
              <th>Side</th>
              <th>Order Price</th>
              <th>Fill Price</th>
              <th>Quantity</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade, index) => (
                <tr key={trade.id || index} className={trade.success ? 'success' : 'failed'}>
                <td>{new Date(trade.timestamp).toLocaleString()}</td>
                  <td title={trade.marketId}>{formatAddress(trade.marketId)}</td>
                  <td>
                    <span className={`direction-badge ${trade.side.toLowerCase()}`}>
                      {trade.side}
                    </span>
                  </td>
                  <td>{formatPrice(trade.price, trade.marketId)}</td>
                  <td>
                    {trade.priceFill && trade.priceFill !== '0' 
                      ? formatPrice(trade.price, trade.marketId, trade.priceFill)
                      : <span className="text-muted">-</span>
                    }
                  </td>
                  <td>
                    {trade.filledQuantity && trade.filledQuantity !== '0'
                      ? formatQuantity(trade.filledQuantity, trade.marketId, trade.side)
                      : formatQuantity(trade.quantity, trade.marketId, trade.side)
                    }
                  </td>
                  <td>
                    <span className={`status-badge ${trade.success ? 'success' : 'failed'}`}>
                  {trade.success ? 'Success' : 'Failed'}
                    </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  )
}

