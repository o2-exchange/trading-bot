import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Decimal from 'decimal.js'
import { Order } from '../types/order'
import { Market } from '../types/market'
import { orderService } from '../services/orderService'
import { walletService } from '../services/walletService'
import { marketService } from '../services/marketService'
import { tradingEngine } from '../services/tradingEngine'
import './OpenOrdersPanel.css'

export default function OpenOrdersPanel() {
  const { t } = useTranslation()
  const [orders, setOrders] = useState<Order[]>([])
  const [markets, setMarkets] = useState<Map<string, Market>>(new Map())
  const [loading, setLoading] = useState(true)
  const [cancellingOrders, setCancellingOrders] = useState<Set<string>>(new Set())
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const loadMarkets = async () => {
    try {
      const marketsList = await marketService.fetchMarkets()
      const marketsMap = new Map<string, Market>()
      marketsList.forEach(market => {
        marketsMap.set(market.market_id, market)
      })
      setMarkets(marketsMap)
    } catch (error) {
      console.error('Failed to load markets', error)
    }
  }

  const loadOrders = async () => {
    try {
      const wallet = walletService.getConnectedWallet()
      if (!wallet) return

      const openOrders = await orderService.getAllOpenOrders(wallet.address)
      setOrders(openOrders)
    } catch (error) {
      console.error('Failed to load orders', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadMarkets()
    loadOrders()

    const checkTradingStatus = () => {
      const isTrading = tradingEngine.isActive()

      if (isTrading) {
        if (!refreshIntervalRef.current) {
          refreshIntervalRef.current = setInterval(() => {
            loadOrders()
          }, 5000)
        }
      } else {
        if (refreshIntervalRef.current) {
          clearInterval(refreshIntervalRef.current)
          refreshIntervalRef.current = null
        }
      }
    }

    checkTradingStatus()
    const statusCheckInterval = setInterval(checkTradingStatus, 2000)

    // Listen for external refresh requests (e.g., after bulk order cancellation)
    const handleRefreshOrders = () => {
      console.log('[OpenOrdersPanel] Received refresh-orders event')
      setLoading(true)
      loadOrders()
    }
    window.addEventListener('refresh-orders', handleRefreshOrders)

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current)
      }
      clearInterval(statusCheckInterval)
      window.removeEventListener('refresh-orders', handleRefreshOrders)
    }
  }, [])

  const formatPrice = (price: string, marketId: string) => {
    const market = markets.get(marketId)
    if (!market) return price
    const priceHuman = new Decimal(price).div(10 ** market.quote.decimals)
    return `$${priceHuman.toFixed(2)}`
  }

  const formatQuantity = (quantity: string, marketId: string) => {
    const market = markets.get(marketId)
    if (!market) return quantity
    const qtyHuman = new Decimal(quantity).div(10 ** market.base.decimals)
    return qtyHuman.toFixed(3).replace(/\.?0+$/, '')
  }

  const formatTotal = (price: string, quantity: string, marketId: string) => {
    const market = markets.get(marketId)
    if (!market) return '-'
    // Total = (price * quantity) / 10^(base_decimals + quote_decimals) * 10^quote_decimals
    // Simplified: Total = (price * quantity) / 10^base_decimals
    const priceDecimal = new Decimal(price)
    const qtyDecimal = new Decimal(quantity)
    const total = priceDecimal.mul(qtyDecimal).div(10 ** (market.base.decimals + market.quote.decimals))
    return `$${total.toFixed(2)}`
  }

  const formatTime = (timestamp: number) => {
    const now = Date.now()
    const diff = now - timestamp

    // Less than 1 minute
    if (diff < 60 * 1000) {
      return t('open_orders.just_now')
    }
    // Less than 1 hour
    if (diff < 60 * 60 * 1000) {
      const mins = Math.floor(diff / (60 * 1000))
      return t('open_orders.minutes_ago', { count: mins })
    }
    // Less than 24 hours
    if (diff < 24 * 60 * 60 * 1000) {
      const hours = Math.floor(diff / (60 * 60 * 1000))
      return t('open_orders.hours_ago', { count: hours })
    }
    // Less than 7 days
    if (diff < 7 * 24 * 60 * 60 * 1000) {
      const days = Math.floor(diff / (24 * 60 * 60 * 1000))
      return t('open_orders.days_ago', { count: days })
    }
    // Otherwise show date
    const date = new Date(timestamp)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const getMarketPair = (marketId: string) => {
    const market = markets.get(marketId)
    if (!market) return `${marketId.slice(0, 6)}...`
    return `${market.base.symbol}/${market.quote.symbol}`
  }

  const handleCancelOrder = async (order: Order) => {
    const wallet = walletService.getConnectedWallet()
    if (!wallet) return

    setCancellingOrders(prev => new Set(prev).add(order.order_id))

    try {
      await orderService.cancelOrder(order.order_id, order.market_id, wallet.address)
      setOrders(prev => prev.filter(o => o.order_id !== order.order_id))
    } catch (error) {
      console.error('Failed to cancel order', error)
      await loadOrders()
    } finally {
      setCancellingOrders(prev => {
        const newSet = new Set(prev)
        newSet.delete(order.order_id)
        return newSet
      })
    }
  }

  const handleRefresh = () => {
    setLoading(true)
    loadOrders()
  }

  return (
    <div className="open-orders-panel">
      <div className="panel-header">
        <div className="panel-title">
          <h3>{t('open_orders.title')}</h3>
          {orders.length > 0 && (
            <span className="order-count">{orders.length}</span>
          )}
        </div>
        <div className="panel-actions">
          <button
            className="refresh-btn"
            onClick={handleRefresh}
            disabled={loading}
            title={t('open_orders.refresh')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 2v6h-6" />
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
              <path d="M3 22v-6h6" />
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            </svg>
          </button>
        </div>
      </div>

      <div className="panel-content">
        {loading ? (
          <div className="panel-loading">{t('common.loading')}</div>
        ) : orders.length === 0 ? (
          <div className="panel-empty">{t('open_orders.no_orders')}</div>
        ) : (
          <div className="orders-table-wrapper">
            <table className="compact-orders-table">
              <thead>
                <tr>
                  <th>{t('open_orders.market')}</th>
                  <th>{t('open_orders.side')}</th>
                  <th>{t('open_orders.price')}</th>
                  <th>{t('open_orders.qty')}</th>
                  <th>{t('open_orders.total')}</th>
                  <th>{t('open_orders.time')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.order_id}>
                    <td className="market-cell">{getMarketPair(order.market_id)}</td>
                    <td>
                      <span className={`side-badge ${order.side.toLowerCase()}`}>
                        {order.side}
                      </span>
                    </td>
                    <td className="numeric-cell">{formatPrice(order.price, order.market_id)}</td>
                    <td className="numeric-cell">{formatQuantity(order.quantity, order.market_id)}</td>
                    <td className="numeric-cell">{formatTotal(order.price, order.quantity, order.market_id)}</td>
                    <td className="time-cell">{formatTime(order.created_at)}</td>
                    <td className="action-cell">
                      {(order.status === 'open' || order.status === 'partially_filled') && (
                        <button
                          className="cancel-btn"
                          onClick={() => handleCancelOrder(order)}
                          disabled={cancellingOrders.has(order.order_id)}
                          title={t('open_orders.cancel_order')}
                        >
                          {cancellingOrders.has(order.order_id) ? '...' : '×'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
