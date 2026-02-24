import { db } from '../services/dbService'
import { Order } from '../types/order'
import { Trade } from '../types/trade'

/**
 * Escape a CSV field value (handle commas, quotes, newlines)
 */
function escapeCSV(value: string | number | boolean | undefined | null): string {
  if (value === undefined || value === null) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/**
 * Convert array of objects to CSV string
 */
function toCSV(headers: string[], rows: string[][]): string {
  const headerLine = headers.map(escapeCSV).join(',')
  const dataLines = rows.map(row => row.map(escapeCSV).join(','))
  return [headerLine, ...dataLines].join('\n')
}

/**
 * Trigger a file download in the browser
 */
function downloadFile(content: string, filename: string, mimeType: string = 'text/csv') {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Format epoch timestamp to ISO string
 */
function formatTimestamp(ts: number): string {
  if (!ts || ts === 0) return ''
  return new Date(ts).toISOString()
}

/**
 * Export trades from IndexedDB as CSV
 */
export async function exportTradesCSV(): Promise<number> {
  const trades = await db.trades.orderBy('timestamp').reverse().toArray()
  if (trades.length === 0) return 0

  const headers = [
    'Timestamp', 'Market', 'Side', 'Order Type', 'Price', 'Fill Price',
    'Quantity', 'Filled Quantity', 'Value (USD)', 'Fee (USD)',
    'Status', 'Order ID', 'Session ID'
  ]

  const rows = trades.map((t: Trade) => [
    formatTimestamp(t.timestamp),
    t.marketId,
    t.side,
    t.orderType || '',
    t.price,
    t.priceFill || '',
    t.quantity,
    t.filledQuantity || '',
    t.valueUsd !== undefined ? t.valueUsd.toFixed(4) : '',
    t.feeUsd !== undefined ? t.feeUsd.toFixed(4) : '',
    t.status || (t.success ? 'filled' : 'failed'),
    t.orderId,
    t.sessionId || '',
  ])

  const csv = toCSV(headers, rows)
  downloadFile(csv, `trades-${Date.now()}.csv`)
  return trades.length
}

/**
 * Export orders from IndexedDB as CSV
 */
export async function exportOrdersCSV(): Promise<number> {
  const orders = await db.orders.orderBy('created_at').reverse().toArray()
  if (orders.length === 0) return 0

  const headers = [
    'Created At', 'Updated At', 'Market', 'Side', 'Order Type',
    'Price', 'Fill Price', 'Quantity', 'Filled Quantity', 'Remaining Quantity',
    'Status', 'Order ID', 'TX ID'
  ]

  const rows = orders.map((o: Order) => [
    formatTimestamp(o.created_at),
    formatTimestamp(o.updated_at),
    o.market_id,
    o.side,
    o.order_type,
    o.price,
    o.price_fill || '',
    o.quantity,
    o.filled_quantity,
    o.remaining_quantity,
    o.status,
    o.order_id,
    o.tx_id || '',
  ])

  const csv = toCSV(headers, rows)
  downloadFile(csv, `orders-${Date.now()}.csv`)
  return orders.length
}
