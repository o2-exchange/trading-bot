import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Trade } from '../types/trade'
import { tradeHistoryService } from '../services/tradeHistoryService'
import { tradingEngine } from '../services/tradingEngine'
import { marketService } from '../services/marketService'
import { Market } from '../types/market'
import { formatRawPrice, formatRawQuantity } from '../utils/priceFormatter'
import { exportTradesCSV } from '../utils/csvExport'
import './TradeHistory.css'

export default function TradeHistory() {
  const { t } = useTranslation()
  const [trades, setTrades] = useState<Trade[]>([])
  const [markets, setMarkets] = useState<Map<string, Market>>(new Map())
  const [filterMarket, setFilterMarket] = useState<string>('')
  const [filterSide, setFilterSide] = useState<string>('')
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [filterTimeRange, setFilterTimeRange] = useState<string>('')
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const hasFilters = filterMarket || filterSide || filterStatus || filterTimeRange

  const getTimeRange = (): { startTime?: number; endTime?: number } => {
    if (!filterTimeRange) return {}
    const now = Date.now()
    const ranges: Record<string, number> = {
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
    }
    const ms = ranges[filterTimeRange]
    return ms ? { startTime: now - ms, endTime: now } : {}
  }

  const loadTrades = async () => {
    if (hasFilters) {
      const { startTime, endTime } = getTimeRange()
      const filtered = await tradeHistoryService.getFilteredTrades({
        marketId: filterMarket || undefined,
        side: filterSide || undefined,
        status: filterStatus || undefined,
        startTime,
        endTime,
      })
      setTrades(filtered)
    } else {
      const recentTrades = await tradeHistoryService.getRecentTrades(50)
      setTrades(recentTrades)
    }
  }

  const formatPrice = (price: string, marketId: string, priceFill?: string): string => {
    const market = markets.get(marketId)
    const decimals = market?.quote?.decimals || 18

    // Prefer fill price if available, otherwise use limit price
    const priceToFormat = priceFill && priceFill !== '0' ? priceFill : price
    return formatRawPrice(priceToFormat, decimals, { prefix: '' })
  }

  const formatQuantity = (quantity: string, marketId: string): string => {
    const market = markets.get(marketId)
    const decimals = market?.base?.decimals || 18
    return formatRawQuantity(quantity, decimals)
  }

  const getPairName = (marketId: string): string => {
    const market = markets.get(marketId)
    if (market) {
      return `${market.base.symbol}/${market.quote.symbol}`
    }
    return formatAddress(marketId)
  }

  const getQuoteSymbol = (marketId: string): string => {
    const market = markets.get(marketId)
    return market?.quote?.symbol || 'USDC'
  }

  const getBaseSymbol = (marketId: string): string => {
    const market = markets.get(marketId)
    return market?.base?.symbol || ''
  }

  const formatFilledVsAll = (trade: Trade): string => {
    const baseSymbol = getBaseSymbol(trade.marketId)
    const filled = trade.filledQuantity && trade.filledQuantity !== '0'
      ? formatQuantity(trade.filledQuantity, trade.marketId)
      : '0.00'
    const total = formatQuantity(trade.quantity, trade.marketId)
    return `${filled} / ${total} ${baseSymbol}`
  }

  const formatTotal = (trade: Trade): string => {
    const quoteSymbol = getQuoteSymbol(trade.marketId)
    const market = markets.get(trade.marketId)

    // Calculate total from fill price × filled quantity (or order price × quantity if not filled)
    if (trade.priceFill && trade.priceFill !== '0' && trade.filledQuantity && trade.filledQuantity !== '0') {
      const priceDecimals = market?.quote?.decimals || 18
      const qtyDecimals = market?.base?.decimals || 18

      try {
        const priceBigInt = BigInt(trade.priceFill)
        const qtyBigInt = BigInt(trade.filledQuantity)
        // Total = price * qty / (10^baseDecimals) since price is already in quote decimals
        const totalBigInt = (priceBigInt * qtyBigInt) / BigInt(10 ** qtyDecimals)
        // Convert to human-readable using formatRawPrice (without $ prefix since we add symbol)
        const total = formatRawPrice(totalBigInt.toString(), priceDecimals, { prefix: '' })
        return `${total} ${quoteSymbol}`
      } catch {
        return `0.00 ${quoteSymbol}`
      }
    }
    return `0.00 ${quoteSymbol}`
  }

  // Reload when filters change
  useEffect(() => {
    loadTrades()
  }, [filterMarket, filterSide, filterStatus, filterTimeRange])

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

  const formatStatus = (status?: string): string => {
    if (!status) return t('trade_history.unknown')
    if (status.toLowerCase() === 'filled') return t('trade_history.filled')
    if (status.toLowerCase() === 'failed') return t('trade_history.failed')
    return status.charAt(0).toUpperCase() + status.slice(1)
  }

  const handleExportCSV = async () => {
    const count = await exportTradesCSV()
    if (count === 0) {
      alert(t('common.no_data_to_export'))
    }
  }

  return (
    <div className="trade-history">
      <div className="trade-history-header">
        <h2>{t('trade_history.title')}</h2>
        <button className="btn-secondary btn-sm" onClick={handleExportCSV} title={t('common.export_csv')}>
          {t('common.export_csv')}
        </button>
      </div>
      <div className="filters">
        <select
          className="filter-select"
          value={filterTimeRange}
          onChange={(e) => setFilterTimeRange(e.target.value)}
        >
          <option value="">{t('trade_history.all_time')}</option>
          <option value="1h">{t('trade_history.last_1h')}</option>
          <option value="24h">{t('trade_history.last_24h')}</option>
          <option value="7d">{t('trade_history.last_7d')}</option>
          <option value="30d">{t('trade_history.last_30d')}</option>
        </select>
        <select
          className="filter-select"
          value={filterMarket}
          onChange={(e) => setFilterMarket(e.target.value)}
        >
          <option value="">{t('trade_history.all_markets')}</option>
          {Array.from(markets.values()).map(m => (
            <option key={m.market_id} value={m.market_id}>
              {m.base.symbol}/{m.quote.symbol}
            </option>
          ))}
        </select>
        <select
          className="filter-select"
          value={filterSide}
          onChange={(e) => setFilterSide(e.target.value)}
        >
          <option value="">{t('trade_history.all_sides')}</option>
          <option value="Buy">{t('trade_history.buy')}</option>
          <option value="Sell">{t('trade_history.sell')}</option>
        </select>
        <select
          className="filter-select"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="">{t('trade_history.all_statuses')}</option>
          <option value="filled">{t('trade_history.filled')}</option>
          <option value="failed">{t('trade_history.failed')}</option>
          <option value="cancelled">{t('trade_history.cancelled')}</option>
          <option value="pending">{t('trade_history.pending')}</option>
        </select>
        {hasFilters && (
          <button
            className="filter-clear-btn"
            onClick={() => {
              setFilterTimeRange('')
              setFilterMarket('')
              setFilterSide('')
              setFilterStatus('')
            }}
          >
            {t('trade_history.clear_filters')}
          </button>
        )}
      </div>
      {trades.length === 0 ? (
        <div className="empty-state">{hasFilters ? t('trade_history.no_matches') : t('trade_history.no_trades')}</div>
      ) : (
        <div className="trades-table-container">
        <table className="trades-table">
          <thead>
            <tr>
              <th>{t('trade_history.date')}</th>
              <th>{t('trade_history.pair')}</th>
              <th>{t('trade_history.type')}</th>
              <th>{t('trade_history.side')}</th>
              <th>{t('trade_history.order_price')}</th>
              <th>{t('trade_history.fill_price')}</th>
              <th>{t('trade_history.filled_all')}</th>
              <th>{t('trade_history.total')}</th>
              <th>{t('trade_history.status')}</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade, index) => (
                <tr key={trade.id || index} className={trade.success ? 'success' : 'failed'}>
                <td>{new Date(trade.timestamp).toLocaleString()}</td>
                <td className="pair-cell">{getPairName(trade.marketId)}</td>
                <td>
                  <span className="type-badge">{trade.orderType || 'Limit'}</span>
                </td>
                <td>
                  <span className={`direction-badge ${trade.side.toLowerCase()}`}>
                    {trade.side}
                  </span>
                </td>
                <td>{formatPrice(trade.price, trade.marketId)} {getQuoteSymbol(trade.marketId)}</td>
                <td>
                  {trade.priceFill && trade.priceFill !== '0'
                    ? `${formatPrice(trade.price, trade.marketId, trade.priceFill)} ${getQuoteSymbol(trade.marketId)}`
                    : <span className="text-muted">-</span>
                  }
                </td>
                <td className="filled-all-cell">{formatFilledVsAll(trade)}</td>
                <td className="total-cell">{formatTotal(trade)}</td>
                <td>
                  <span className={`status-badge ${trade.status || (trade.success ? 'filled' : 'failed')}`}>
                    {formatStatus(trade.status) || (trade.success ? t('trade_history.filled') : t('trade_history.failed'))}
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
