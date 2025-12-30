import { useState, useEffect, useRef } from 'react'
import Decimal from 'decimal.js'
import { Order } from '../types/order'
import { Market } from '../types/market'
import { orderService } from '../services/orderService'
import { walletService } from '../services/walletService'
import { marketService } from '../services/marketService'
import { tradingEngine } from '../services/tradingEngine'
import './OrderHistory.css'

export default function OrderHistory() {
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
    // Load markets and orders initially
    loadMarkets()
    loadOrders()

    // Set up auto-refresh when trading is active
    const checkTradingStatus = () => {
      const isTrading = tradingEngine.isActive()

      if (isTrading) {
        // Start polling every 5 seconds when trading
        if (!refreshIntervalRef.current) {
          refreshIntervalRef.current = setInterval(() => {
            loadOrders()
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
    return `${qtyHuman.toFixed(3).replace(/\.?0+$/, '')} ${market.base.symbol}`
  }

  const getMarketPair = (marketId: string) => {
    const market = markets.get(marketId)
    if (!market) return formatAddress(marketId)
    return `${market.base.symbol}/${market.quote.symbol}`
  }

  const handleCancelOrder = async (order: Order) => {
    const wallet = walletService.getConnectedWallet()
    if (!wallet) return

    setCancellingOrders(prev => new Set(prev).add(order.order_id))

    try {
      await orderService.cancelOrder(order.order_id, order.market_id, wallet.address)
      // Optimistically remove the cancelled order from local state
      setOrders(prev => prev.filter(o => o.order_id !== order.order_id))
    } catch (error) {
      console.error('Failed to cancel order', error)
      // On error, refresh from API to get accurate state
      await loadOrders()
    } finally {
      setCancellingOrders(prev => {
        const newSet = new Set(prev)
        newSet.delete(order.order_id)
        return newSet
      })
    }
  }

  const getStatusClass = (status: string) => {
    const statusLower = status.toLowerCase()
    if (statusLower.includes('filled') || statusLower === 'filled') return 'filled'
    if (statusLower.includes('completed')) return 'filled'
    if (statusLower.includes('cancelled') || statusLower === 'cancelled') return 'cancelled'
    if (statusLower.includes('failed') || statusLower === 'failed') return 'cancelled'
    if (statusLower.includes('partial') || statusLower === 'partially_filled') return 'partial'
    if (statusLower === 'open' || statusLower === 'pending') return 'open'
    return 'open'
  }

  if (loading) {
    return (
      <div className="order-history">
        <h2>Open Orders</h2>
        <div className="loading">Loading orders...</div>
      </div>
    )
  }

  return (
    <div className="order-history">
      <h2>Open Orders</h2>
      {orders.length === 0 ? (
        <div className="empty-state">No open orders</div>
      ) : (
        <div className="orders-table-container">
        <table className="orders-table">
          <thead>
            <tr>
              <th>Market</th>
              <th>Side</th>
              <th>Price</th>
              <th>Quantity</th>
              <th>Filled</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.order_id}>
                <td>{getMarketPair(order.market_id)}</td>
                <td>
                  <span className={`side-badge ${order.side.toLowerCase()}`}>
                    {order.side}
                  </span>
                </td>
                <td>{formatPrice(order.price, order.market_id)}</td>
                <td>{formatQuantity(order.quantity, order.market_id)}</td>
                <td>{formatQuantity(order.filled_quantity || '0', order.market_id)}</td>
                <td>
                  <span className={`status-badge ${getStatusClass(order.status)}`}>
                    {order.status}
                  </span>
                </td>
                <td>
                  {(order.status === 'open' || order.status === 'partially_filled') && (
                    <button
                      className="cancel-order-btn"
                      onClick={() => handleCancelOrder(order)}
                      disabled={cancellingOrders.has(order.order_id)}
                    >
                      {cancellingOrders.has(order.order_id) ? 'Cancelling...' : 'Cancel'}
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
  )
}

