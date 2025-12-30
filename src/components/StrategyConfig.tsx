import { useState, useEffect, useRef } from 'react'
import { Market } from '../types/market'
import { StrategyConfigStore, StrategyConfig as StrategyConfigType, getDefaultStrategyConfig, OrderConfig, PositionSizingConfig, OrderManagementConfig, RiskManagementConfig, TimingConfig } from '../types/strategy'
import { db } from '../services/dbService'
import { useToast } from './ToastProvider'
import './StrategyConfig.css'

// Export format for sharing strategies
interface StrategyExport {
  version: "1.0"
  exportedAt: string
  name?: string
  orderConfig: OrderConfig
  positionSizing: PositionSizingConfig
  orderManagement: OrderManagementConfig
  riskManagement: RiskManagementConfig
  timing: TimingConfig
}

interface StrategyConfigProps {
  markets: Market[]
  onCreateNew?: () => void
  createNewRef?: React.MutableRefObject<(() => void) | null>
  importRef?: React.MutableRefObject<(() => void) | null>
}

// Tooltip component for form field hints
function Tooltip({ text, position = 'center' }: { text: string; position?: 'left' | 'center' | 'right' }) {
  const positionClass = position === 'left' ? 'tooltip-left' : position === 'right' ? 'tooltip-right' : ''
  return (
    <span className={`tooltip-wrapper ${positionClass}`}>
      <span className="tooltip-icon">?</span>
      <span className="tooltip-content">{text}</span>
    </span>
  )
}

// Tooltip descriptions for each setting
const TOOLTIPS = {
  // Order Config
  orderType: "Market orders execute immediately at best available price. Limit orders are placed on the orderbook and wait for a match at your specified price.",
  priceMode: "The reference price used to calculate your order price. Mid = average of best bid/ask. Best Bid/Ask = top of orderbook. Market = last traded price.",
  side: "Buy: Only place buy orders. Sell: Only place sell orders. Both: Place both buy and sell orders each cycle.",
  priceOffsetPercent: "Percentage offset from reference price. For buys, adds to price (buy higher). For sells, subtracts from price (sell lower). 0% = exact reference price.",
  maxSpreadPercent: "Maximum bid-ask spread allowed. If spread exceeds this, no orders are placed. Prevents trading in illiquid markets.",
  maxOpenOrders: "Maximum open orders per side. E.g., 2 means max 2 buy orders + 2 sell orders at once. Prevents over-exposure.",

  // Position Sizing
  sizeMode: "% Balance: Use percentage of available balance. Fixed USD: Use fixed dollar amount per order.",
  baseBalancePercent: "Percentage of base asset balance to use for sell orders. 100% = use entire available balance.",
  quoteBalancePercent: "Percentage of quote asset balance to use for buy orders. 100% = use entire available balance.",
  fixedUsdAmount: "Fixed USD value for each order. Applied to both buy and sell orders.",
  minOrderSizeUsd: "Minimum order value in USD. Orders below this are skipped. Prevents dust orders.",
  maxOrderSizeUsd: "Maximum order value in USD. Caps order size even if balance allows more. Leave empty for no limit.",
  cycleInterval: "Time between order placement cycles (in milliseconds). Random interval between min and max adds unpredictability.",

  // Profit & Risk
  onlySellAboveBuyPrice: "When enabled, only places sell orders above your last buy price + take profit %. Prevents selling at a loss.",
  takeProfitPercent: "Minimum profit margin above buy price required for sell orders. 0.02% covers round-trip fees (0.01% buy + 0.01% sell).",
  stopLoss: "Emergency exit if price drops below your average buy price by this percentage. Cancels all orders and market sells entire position.",
  orderTimeout: "Cancel unfilled orders after this many minutes. Useful for limit orders that don't get filled.",
  maxDailyLoss: "Pause trading for the day if realized losses exceed this USD amount. Resets at midnight UTC.",
}

// Migration function to convert old config structure to new structure
const migrateOldConfig = (oldConfig: any): StrategyConfigType => {
    // Check if config already has new structure
    if (oldConfig.orderConfig && oldConfig.positionSizing) {
      return oldConfig as StrategyConfigType
    }

    // Migrate from old structure to new structure
    const defaultConfig = getDefaultStrategyConfig(oldConfig.marketId || '')
    
    // Try to preserve old values if they exist
    if (oldConfig.type === 'marketMaking') {
      return {
        ...defaultConfig,
        name: oldConfig.name,
        orderConfig: {
          ...defaultConfig.orderConfig,
          orderType: 'Market',
          priceOffsetPercent: oldConfig.buyPriceAdjustmentPercent || defaultConfig.orderConfig.priceOffsetPercent,
          maxSpreadPercent: oldConfig.spreadPercent || defaultConfig.orderConfig.maxSpreadPercent,
          side: 'Both',
        },
        positionSizing: {
          ...defaultConfig.positionSizing,
          balancePercentage: oldConfig.orderSizeUsd ? 50 : defaultConfig.positionSizing.balancePercentage,
          // Initialize new fields with balancePercentage for backward compatibility
          baseBalancePercentage: defaultConfig.positionSizing.baseBalancePercentage ?? defaultConfig.positionSizing.balancePercentage,
          quoteBalancePercentage: defaultConfig.positionSizing.quoteBalancePercentage ?? defaultConfig.positionSizing.balancePercentage,
        },
        timing: {
          ...defaultConfig.timing,
          cycleIntervalMinMs: oldConfig.cycleIntervalMinMs || defaultConfig.timing.cycleIntervalMinMs,
          cycleIntervalMaxMs: oldConfig.cycleIntervalMaxMs || defaultConfig.timing.cycleIntervalMaxMs,
        },
        riskManagement: {
          ...defaultConfig.riskManagement,
        },
      }
    } else if (oldConfig.type === 'balanceThreshold') {
      return {
        ...defaultConfig,
        name: oldConfig.name,
        orderConfig: {
          ...defaultConfig.orderConfig,
          side: 'Auto' as any, // Will be handled as both buy and sell based on thresholds
        },
        riskManagement: {
          ...defaultConfig.riskManagement,
        },
        timing: {
          ...defaultConfig.timing,
          cycleIntervalMinMs: oldConfig.cycleIntervalMinMs || defaultConfig.timing.cycleIntervalMinMs,
          cycleIntervalMaxMs: oldConfig.cycleIntervalMaxMs || defaultConfig.timing.cycleIntervalMaxMs,
        },
      }
    }

    // If we can't migrate, return default
    return defaultConfig
}

export default function StrategyConfig({ markets, createNewRef, importRef }: StrategyConfigProps) {
  const [configs, setConfigs] = useState<StrategyConfigStore[]>([])
  const [editingConfig, setEditingConfig] = useState<StrategyConfigStore | null>(null)
  const [selectedMarket, setSelectedMarket] = useState<string>('')
  const [isCreating, setIsCreating] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [importMarket, setImportMarket] = useState<string>('')
  const [importJson, setImportJson] = useState<string>('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { addToast } = useToast()

  useEffect(() => {
    loadConfigs()
  }, [])

  // Expose handleCreateNew via ref for external triggering
  useEffect(() => {
    if (createNewRef) {
      createNewRef.current = handleCreateNew
    }
    return () => {
      if (createNewRef) {
        createNewRef.current = null
      }
    }
  }, [])

  // Expose handleOpenImport via ref for external triggering
  useEffect(() => {
    if (importRef) {
      importRef.current = handleOpenImport
    }
    return () => {
      if (importRef) {
        importRef.current = null
      }
    }
  }, [])

  const loadConfigs = async () => {
    const all = await db.strategyConfigs.toArray()
    
    // Migrate old configs to new format
    const migratedConfigs = await Promise.all(
      all.map(async (config) => {
        // Check if config needs migration
        if (!config.config.orderConfig || !config.config.positionSizing) {
          const migratedConfig = migrateOldConfig(config.config)
          // Update in database
          await db.strategyConfigs.update(config.id, {
            config: migratedConfig,
            updatedAt: Date.now(),
          })
          return {
            ...config,
            config: migratedConfig,
          }
        }
        return config
      })
    )
    
    setConfigs(migratedConfigs)
  }

  const handleCreateNew = () => {
    setSelectedMarket('')
    setIsCreating(true)
    setEditingConfig(null)
  }

  const handleEdit = (config: StrategyConfigStore) => {
    // Ensure config is migrated before editing
    if (!config.config.orderConfig || !config.config.positionSizing) {
      const migratedConfig = migrateOldConfig(config.config)
      const updatedConfig: StrategyConfigStore = {
        ...config,
        config: migratedConfig,
      }
      setEditingConfig(updatedConfig)
    } else {
      setEditingConfig(config)
    }
    setSelectedMarket(config.marketId)
    setIsCreating(false)
  }

  const handleCancel = () => {
    setEditingConfig(null)
    setSelectedMarket('')
    setIsCreating(false)
  }

  const handleSave = async () => {
    if (!selectedMarket) {
      addToast('Please select a market', 'error')
      return
    }

    const market = markets.find((m) => m.market_id === selectedMarket)
    if (!market) {
      addToast('Market not found', 'error')
      return
    }

    let configToSave: StrategyConfigType

    if (editingConfig) {
      // Check if market ID has changed - if so, warn user and clear fill prices
      if (editingConfig.config.marketId !== selectedMarket) {
        // Warn user that changing market will clear trading history
        const hasHistory = editingConfig.config.averageBuyPrice ||
          editingConfig.config.averageSellPrice ||
          (editingConfig.config.lastFillPrices?.buy?.length ?? 0) > 0 ||
          (editingConfig.config.lastFillPrices?.sell?.length ?? 0) > 0

        if (hasHistory) {
          const confirmed = confirm(
            'Changing the market will permanently clear your trading history (buy/sell prices, fill data).\n\n' +
            'This cannot be undone. Are you sure you want to continue?'
          )
          if (!confirmed) {
            return
          }
        }

        // Market changed - clear fill prices and update market ID
        configToSave = {
          ...editingConfig.config,
          marketId: selectedMarket,
          averageBuyPrice: undefined,
          averageSellPrice: undefined,
          lastFillPrices: undefined,
          updatedAt: Date.now(),
        }
        addToast('Market changed - trading history cleared', 'warning')
      } else {
        // Update existing config (same market)
        configToSave = {
          ...editingConfig.config,
          updatedAt: Date.now(),
        }
      }
    } else {
      // Create new config with defaults
      configToSave = getDefaultStrategyConfig(selectedMarket)
    }

    const configStore: StrategyConfigStore = {
      id: selectedMarket,
      marketId: selectedMarket,
      config: configToSave,
      isActive: editingConfig?.isActive ?? true,
      createdAt: editingConfig?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    }

    await db.strategyConfigs.put(configStore)
    await loadConfigs()
    addToast('Strategy configuration saved', 'success')
    handleCancel()
  }

  const handleToggleActive = async (config: StrategyConfigStore) => {
    await db.strategyConfigs.update(config.id, {
      isActive: !config.isActive,
      updatedAt: Date.now(),
    })
    await loadConfigs()
  }

  const handleDelete = async (config: StrategyConfigStore) => {
    if (confirm('Are you sure you want to delete this strategy configuration?')) {
      await db.strategyConfigs.delete(config.id)
      await loadConfigs()
      addToast('Strategy configuration deleted', 'success')
    }
  }

  const handleResetToDefault = () => {
    if (!selectedMarket) return

    const defaultConfig = getDefaultStrategyConfig(selectedMarket)
    if (editingConfig) {
      setEditingConfig({
        ...editingConfig,
        config: defaultConfig,
      })
    } else if (isCreating) {
      // Reset for new strategy
      setEditingConfig({
        id: selectedMarket,
        marketId: selectedMarket,
        config: defaultConfig,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    }
  }

  // Create export data from a config
  const createExportData = (config: StrategyConfigStore): StrategyExport => {
    return {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      name: config.config.name,
      orderConfig: config.config.orderConfig,
      positionSizing: config.config.positionSizing,
      orderManagement: config.config.orderManagement,
      riskManagement: config.config.riskManagement,
      timing: config.config.timing,
    }
  }

  // Copy strategy to clipboard
  const handleCopyToClipboard = async (config: StrategyConfigStore) => {
    try {
      const exportData = createExportData(config)
      await navigator.clipboard.writeText(JSON.stringify(exportData, null, 2))
      addToast('Strategy copied to clipboard', 'success')
    } catch (error) {
      addToast('Failed to copy to clipboard', 'error')
    }
  }

  // Export strategy as JSON file
  const handleExportAsFile = (config: StrategyConfigStore) => {
    try {
      const exportData = createExportData(config)
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const safeName = (config.config.name || 'strategy').replace(/[^a-z0-9]/gi, '-').toLowerCase()
      a.download = `${safeName}-${Date.now()}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      addToast('Strategy exported', 'success')
    } catch (error) {
      addToast('Failed to export strategy', 'error')
    }
  }

  // Open import modal
  const handleOpenImport = () => {
    setImportMarket('')
    setImportJson('')
    setShowImportModal(true)
  }

  // Handle file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result as string
      setImportJson(content)
    }
    reader.onerror = () => {
      addToast('Failed to read file', 'error')
    }
    reader.readAsText(file)
  }

  // Process and validate import
  const handleProcessImport = () => {
    if (!importMarket) {
      addToast('Please select a target market', 'error')
      return
    }

    if (!importJson.trim()) {
      addToast('Please provide JSON data', 'error')
      return
    }

    try {
      const data = JSON.parse(importJson)

      // Validate version and required fields
      if (!data.orderConfig || !data.positionSizing || !data.orderManagement || !data.riskManagement || !data.timing) {
        addToast('Invalid strategy format: missing required sections', 'error')
        return
      }

      // Get defaults to merge with imported data
      const defaults = getDefaultStrategyConfig(importMarket)

      // Create new config by merging with defaults (handles missing optional fields)
      const newConfig: StrategyConfigType = {
        ...defaults,
        name: data.name || defaults.name,
        marketId: importMarket,
        orderConfig: { ...defaults.orderConfig, ...data.orderConfig },
        positionSizing: { ...defaults.positionSizing, ...data.positionSizing },
        orderManagement: { ...defaults.orderManagement, ...data.orderManagement },
        riskManagement: { ...defaults.riskManagement, ...data.riskManagement },
        timing: { ...defaults.timing, ...data.timing },
        // Clear internal state - user starts fresh
        lastFillPrices: undefined,
        averageBuyPrice: undefined,
        averageSellPrice: undefined,
        dailyPnL: undefined,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      // Close import modal
      setShowImportModal(false)
      setImportJson('')
      setImportMarket('')

      // Open in edit mode so user can review before saving
      setSelectedMarket(importMarket)
      setEditingConfig({
        id: importMarket,
        marketId: importMarket,
        config: newConfig,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      setIsCreating(false)

      addToast('Strategy imported - review and save', 'success')
    } catch (error) {
      addToast('Invalid JSON format', 'error')
    }
  }

  const currentConfig = editingConfig?.config || (selectedMarket ? getDefaultStrategyConfig(selectedMarket) : null)
  const showForm = isCreating || editingConfig

  return (
    <div className="strategy-config">
      {showForm && (
        <div className="config-modal-overlay" onClick={handleCancel}>
          <div className="config-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="config-modal-header">
              <h2>{editingConfig ? 'Edit Strategy' : 'Create New Strategy'}</h2>
              <div className="config-modal-header-actions">
                {editingConfig && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleCopyToClipboard(editingConfig)}
                      className="btn-export"
                      title="Copy strategy JSON to clipboard"
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExportAsFile(editingConfig)}
                      className="btn-export"
                      title="Export as JSON file"
                    >
                      Export
                    </button>
                  </>
                )}
                <button className="config-modal-close" onClick={handleCancel}>×</button>
              </div>
            </div>
            <div className="config-modal-body">
              {currentConfig ? (
                <StrategyConfigForm
                  markets={markets}
                  selectedMarket={selectedMarket}
                  config={currentConfig}
                  onMarketChange={(marketId) => {
                    setSelectedMarket(marketId)
                    // When creating new and market changes, create a new editingConfig
                    if (isCreating && marketId) {
                      const newConfig = getDefaultStrategyConfig(marketId)
                      setEditingConfig({
                        id: marketId,
                        marketId: marketId,
                        config: newConfig,
                        isActive: true,
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                      })
                    }
                  }}
                  onConfigChange={(newConfig) => {
                    if (editingConfig) {
                      setEditingConfig({
                        ...editingConfig,
                        config: newConfig,
                      })
                    } else if (isCreating && selectedMarket) {
                      // Creating new - initialize editingConfig with the new config
                      setEditingConfig({
                        id: selectedMarket,
                        marketId: selectedMarket,
                        config: newConfig,
                        isActive: true,
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                      })
                    }
                  }}
                  onSave={handleSave}
                  onCancel={handleCancel}
                  onReset={handleResetToDefault}
                />
              ) : (
                <div className="form-group">
                  <label>Market *</label>
                  <select
                    value={selectedMarket}
                    onChange={(e) => {
                      const marketId = e.target.value
                      setSelectedMarket(marketId)
                      // Initialize editingConfig when market is selected
                      if (marketId) {
                        const newConfig = getDefaultStrategyConfig(marketId)
                        setEditingConfig({
                          id: marketId,
                          marketId: marketId,
                          config: newConfig,
                          isActive: true,
                          createdAt: Date.now(),
                          updatedAt: Date.now(),
                        })
                      }
                    }}
                    required
                    style={{ width: '100%', padding: '8px 12px', marginTop: '8px' }}
                  >
                    <option value="">Select a market</option>
                    {markets.map((market) => (
                      <option key={market.market_id} value={market.market_id}>
                        {market.base.symbol}/{market.quote.symbol}
                      </option>
                    ))}
                  </select>
                  <small style={{ display: 'block', marginTop: '8px', color: 'var(--muted-foreground)' }}>
                    Please select a market to continue
                  </small>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="configs-list">
        {configs.length === 0 ? (
          <div className="empty-state">
            <p>No strategy configurations</p>
            <div className="empty-state-actions">
              <button onClick={handleCreateNew} className="btn btn-primary">
                Create Strategy
              </button>
              <button onClick={handleOpenImport} className="btn btn-secondary">
                Import
              </button>
            </div>
          </div>
        ) : (
          <div className="configs-grid">
            {configs.map((config) => {
              const market = markets.find((m) => m.market_id === config.marketId)

              return (
                <div key={config.id} className="config-card">
                  <div className="config-card-header">
                    <div className="config-card-title">
                      <div className="market-pair">
                        <span className="base-symbol">{market?.base.symbol || 'N/A'}</span>
                        <span className="separator">/</span>
                        <span className="quote-symbol">{market?.quote.symbol || 'N/A'}</span>
                      </div>
                      {config.config.name && config.config.name !== config.marketId && (
                        <div className="strategy-name">{config.config.name}</div>
                      )}
                    </div>
                    <span className={`status-badge ${config.isActive ? 'active' : 'inactive'}`}>
                      {config.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  
                  <div className="config-card-body">
                    {config.config.orderConfig && (
                      <div className="config-summary">
                        <div className="summary-row">
                          <span className="summary-item">
                            <span className="summary-label">Type</span>
                            <span className="summary-value">{config.config.orderConfig.orderType || 'Market'}</span>
                          </span>
                          <span className="summary-separator">•</span>
                          <span className="summary-item">
                            <span className="summary-label">Side</span>
                            <span className="summary-value">{config.config.orderConfig.side || 'Both'}</span>
                          </span>
                        </div>
                        <div className="summary-row">
                          <span className="summary-item">
                            <span className="summary-label">Offset</span>
                            <span className="summary-value">{config.config.orderConfig.priceOffsetPercent?.toFixed(2) || '0.00'}%</span>
                          </span>
                          <span className="summary-separator">•</span>
                          <span className="summary-item">
                            <span className="summary-label">Max Spread</span>
                            <span className="summary-value">{config.config.orderConfig.maxSpreadPercent?.toFixed(1) || '0'}%</span>
                          </span>
                        </div>
                        <div className="summary-row">
                          <span className="summary-item">
                            <span className="summary-label">Balance</span>
                            <span className="summary-value">
                              {config.config.positionSizing?.sizeMode === 'fixedUsd' 
                                ? `$${config.config.positionSizing.fixedUsdAmount || 0}`
                                : `Base: ${config.config.positionSizing?.baseBalancePercentage ?? config.config.positionSizing?.balancePercentage ?? 0}%, Quote: ${config.config.positionSizing?.quoteBalancePercentage ?? config.config.positionSizing?.balancePercentage ?? 0}%`
                              }
                            </span>
                          </span>
                          <span className="summary-separator">•</span>
                          <span className="summary-item">
                            <span className="summary-label">Min Size</span>
                            <span className="summary-value">${config.config.positionSizing?.minOrderSizeUsd || 5}</span>
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <div className="config-card-actions">
                    <button type="button" onClick={() => handleEdit(config)} className="btn-action btn-edit">
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleActive(config)}
                      className={`btn-action ${config.isActive ? 'btn-deactivate' : 'btn-activate'}`}
                    >
                      {config.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    <button type="button" onClick={() => handleDelete(config)} className="btn-action btn-delete">
                      Delete
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Import Modal */}
      {showImportModal && (
        <div className="config-modal-overlay" onClick={() => setShowImportModal(false)}>
          <div className="config-modal-content import-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="config-modal-header">
              <h2>Import Strategy</h2>
              <button className="config-modal-close" onClick={() => setShowImportModal(false)}>×</button>
            </div>
            <div className="config-modal-body">
              <div className="form-group">
                <label>Target Market *</label>
                <div className="select-wrapper">
                  <select
                    value={importMarket}
                    onChange={(e) => setImportMarket(e.target.value)}
                    required
                  >
                    <option value="">Select a market</option>
                    {markets.map((market) => (
                      <option key={market.market_id} value={market.market_id}>
                        {market.base.symbol}/{market.quote.symbol}
                      </option>
                    ))}
                  </select>
                </div>
                <small>The imported strategy will be applied to this market</small>
              </div>

              <div className="import-divider">
                <span>Upload file</span>
              </div>

              <div className="form-group">
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".json"
                  onChange={handleFileUpload}
                  className="file-input"
                />
              </div>

              <div className="import-divider">
                <span>Or paste JSON</span>
              </div>

              <div className="form-group">
                <textarea
                  className="import-textarea"
                  value={importJson}
                  onChange={(e) => setImportJson(e.target.value)}
                  placeholder='{"version": "1.0", "orderConfig": {...}, ...}'
                  rows={8}
                />
              </div>

              <div className="form-actions">
                <div></div>
                <div className="form-actions-right">
                  <button type="button" onClick={() => setShowImportModal(false)} className="btn btn-secondary">
                    Cancel
                  </button>
                  <button type="button" onClick={handleProcessImport} className="btn btn-primary">
                    Import
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface StrategyConfigFormProps {
  markets: Market[]
  selectedMarket: string
  config: StrategyConfigType
  onMarketChange: (marketId: string) => void
  onConfigChange: (config: StrategyConfigType) => void
  onSave: () => void
  onCancel: () => void
  onReset: () => void
}

function StrategyConfigForm({
  markets,
  selectedMarket,
  config,
  onMarketChange,
  onConfigChange,
  onSave,
  onCancel,
  onReset,
}: StrategyConfigFormProps) {
  const updateConfig = (updates: Partial<StrategyConfigType>) => {
    onConfigChange({
      ...config,
      ...updates,
    })
  }

  const updateOrderConfig = (updates: Partial<StrategyConfigType['orderConfig']>) => {
    updateConfig({
      orderConfig: {
        ...config.orderConfig,
        ...updates,
      },
    })
  }

  const updatePositionSizing = (updates: Partial<StrategyConfigType['positionSizing']>) => {
    updateConfig({
      positionSizing: {
        ...config.positionSizing,
        ...updates,
      },
    })
  }

  const updateOrderManagement = (updates: Partial<StrategyConfigType['orderManagement']>) => {
    updateConfig({
      orderManagement: {
        ...config.orderManagement,
        ...updates,
      },
    })
  }

  const updateRiskManagement = (updates: Partial<StrategyConfigType['riskManagement']>) => {
    updateConfig({
      riskManagement: {
        ...config.riskManagement,
        ...updates,
      },
    })
  }

  const updateTiming = (updates: Partial<StrategyConfigType['timing']>) => {
    updateConfig({
      timing: {
        ...config.timing,
        ...updates,
      },
    })
  }

  return (
    <div className="strategy-config-form compact">
      {/* Row 1: Market & Name */}
      <div className="form-row">
        <div className="form-field flex-2">
          <label>Market</label>
          <div className="select-wrapper">
            <select value={selectedMarket} onChange={(e) => onMarketChange(e.target.value)} required>
              <option value="">Select market</option>
              {markets.map((market) => (
                <option key={market.market_id} value={market.market_id}>
                  {market.base.symbol}/{market.quote.symbol}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-field flex-2">
          <label>Strategy Name</label>
          <input
            type="text"
            value={config.name || ''}
            onChange={(e) => updateConfig({ name: e.target.value })}
            placeholder="Optional"
          />
        </div>
      </div>

      <div className="form-divider" />

      {/* Row 2: Order Type, Price Mode, Side */}
      <div className="form-row">
        <div className="form-field">
          <label className="label-with-tooltip">Order Type <Tooltip text={TOOLTIPS.orderType} position="left" /></label>
          <div className="select-wrapper">
            <select value={config.orderConfig.orderType} onChange={(e) => updateOrderConfig({ orderType: e.target.value as any })}>
              <option value="Market">Market</option>
              <option value="Spot">Limit</option>
            </select>
          </div>
        </div>
        <div className="form-field">
          <label className="label-with-tooltip">Price Mode <Tooltip text={TOOLTIPS.priceMode} /></label>
          <div className="select-wrapper">
            <select value={config.orderConfig.priceMode} onChange={(e) => updateOrderConfig({ priceMode: e.target.value as any })}>
              <option value="offsetFromMid">Mid Price</option>
              <option value="offsetFromBestBid">Best Bid</option>
              <option value="offsetFromBestAsk">Best Ask</option>
              <option value="market">Market</option>
            </select>
          </div>
        </div>
        <div className="form-field">
          <label className="label-with-tooltip">Side <Tooltip text={TOOLTIPS.side} position="right" /></label>
          <div className="btn-group">
            <button type="button" className={`btn-toggle ${config.orderConfig.side === 'Buy' ? 'active' : ''}`} onClick={() => updateOrderConfig({ side: 'Buy' })}>Buy</button>
            <button type="button" className={`btn-toggle ${config.orderConfig.side === 'Sell' ? 'active' : ''}`} onClick={() => updateOrderConfig({ side: 'Sell' })}>Sell</button>
            <button type="button" className={`btn-toggle ${config.orderConfig.side === 'Both' ? 'active' : ''}`} onClick={() => updateOrderConfig({ side: 'Both' })}>Both</button>
          </div>
        </div>
      </div>

      {/* Row 3: Price Offset, Max Spread */}
      <div className="form-row">
        <div className="form-field">
          <label className="label-with-tooltip">Price Offset % <Tooltip text={TOOLTIPS.priceOffsetPercent} position="left" /></label>
          <input
            type="number"
            step="0.01"
            min="0"
            max="50"
            value={config.orderConfig.priceOffsetPercent}
            onChange={(e) => {
              const value = parseFloat(e.target.value) || 0
              // Clamp to safe range: 0-50% (negative would buy high/sell low)
              updateOrderConfig({ priceOffsetPercent: Math.max(0, Math.min(50, value)) })
            }}
          />
        </div>
        <div className="form-field">
          <label className="label-with-tooltip">Max Spread % <Tooltip text={TOOLTIPS.maxSpreadPercent} /></label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="100"
            value={config.orderConfig.maxSpreadPercent}
            onChange={(e) => {
              const value = parseFloat(e.target.value) || 0
              // Clamp to safe range: 0-100%
              updateOrderConfig({ maxSpreadPercent: Math.max(0, Math.min(100, value)) })
            }}
          />
        </div>
        <div className="form-field">
          <label className="label-with-tooltip">Max Open Orders <Tooltip text={TOOLTIPS.maxOpenOrders} position="right" /></label>
          <input
            type="number"
            min="1"
            max="50"
            value={config.orderManagement.maxOpenOrders}
            onChange={(e) => {
              const value = parseInt(e.target.value) || 2
              // Clamp to safe range: 1-50
              updateOrderManagement({ maxOpenOrders: Math.max(1, Math.min(50, value)) })
            }}
          />
        </div>
      </div>

      <div className="form-divider" />

      {/* Position Sizing */}
      <div className="form-section-label">Position Sizing</div>
      <div className="form-row">
        <div className="form-field">
          <label className="label-with-tooltip">Size Mode <Tooltip text={TOOLTIPS.sizeMode} position="left" /></label>
          <div className="btn-group">
            <button type="button" className={`btn-toggle ${config.positionSizing.sizeMode === 'percentageOfBalance' ? 'active' : ''}`} onClick={() => updatePositionSizing({ sizeMode: 'percentageOfBalance' })}>% Balance</button>
            <button type="button" className={`btn-toggle ${config.positionSizing.sizeMode === 'fixedUsd' ? 'active' : ''}`} onClick={() => updatePositionSizing({ sizeMode: 'fixedUsd' })}>Fixed USD</button>
          </div>
        </div>
        {config.positionSizing.sizeMode === 'percentageOfBalance' ? (
          <>
            <div className="form-field">
              <label className="label-with-tooltip">{markets.find(m => m.market_id === selectedMarket)?.base.symbol || 'Base'} Balance % <Tooltip text={TOOLTIPS.baseBalancePercent} /></label>
              <input type="number" min="0" max="100" step="1" value={config.positionSizing.baseBalancePercentage ?? config.positionSizing.balancePercentage} onChange={(e) => updatePositionSizing({ baseBalancePercentage: parseFloat(e.target.value) || 0 })} />
            </div>
            <div className="form-field">
              <label className="label-with-tooltip">{markets.find(m => m.market_id === selectedMarket)?.quote.symbol || 'Quote'} Balance % <Tooltip text={TOOLTIPS.quoteBalancePercent} position="right" /></label>
              <input type="number" min="0" max="100" step="1" value={config.positionSizing.quoteBalancePercentage ?? config.positionSizing.balancePercentage} onChange={(e) => updatePositionSizing({ quoteBalancePercentage: parseFloat(e.target.value) || 0 })} />
            </div>
          </>
        ) : (
          <div className="form-field flex-2">
            <label className="label-with-tooltip">Fixed Amount (USD) <Tooltip text={TOOLTIPS.fixedUsdAmount} /></label>
            <input type="number" min="0" step="0.01" value={config.positionSizing.fixedUsdAmount || 0} onChange={(e) => updatePositionSizing({ fixedUsdAmount: parseFloat(e.target.value) || 0 })} />
          </div>
        )}
      </div>

      <div className="form-row">
        <div className="form-field">
          <label className="label-with-tooltip">Min Order (USD) <Tooltip text={TOOLTIPS.minOrderSizeUsd} position="left" /></label>
          <input type="number" min="0" step="0.01" value={config.positionSizing.minOrderSizeUsd} onChange={(e) => updatePositionSizing({ minOrderSizeUsd: parseFloat(e.target.value) || 5 })} />
        </div>
        <div className="form-field">
          <label className="label-with-tooltip">Max Order (USD) <Tooltip text={TOOLTIPS.maxOrderSizeUsd} /></label>
          <input type="number" min="0" step="0.01" value={config.positionSizing.maxOrderSizeUsd || ''} placeholder="No limit" onChange={(e) => updatePositionSizing({ maxOrderSizeUsd: e.target.value ? parseFloat(e.target.value) : undefined })} />
        </div>
        <div className="form-field">
          <label className="label-with-tooltip">Cycle Interval (ms) <Tooltip text={TOOLTIPS.cycleInterval} position="right" /></label>
          <div className="inline-inputs">
            <input type="number" min="1000" step="100" value={config.timing.cycleIntervalMinMs} onChange={(e) => updateTiming({ cycleIntervalMinMs: parseInt(e.target.value) || 3000 })} />
            <span className="separator">-</span>
            <input type="number" min="1000" step="100" value={config.timing.cycleIntervalMaxMs} onChange={(e) => updateTiming({ cycleIntervalMaxMs: parseInt(e.target.value) || 5000 })} />
          </div>
        </div>
      </div>

      <div className="form-divider" />

      {/* Profit & Risk Settings */}
      <div className="form-section-label">Profit & Risk</div>
      <div className="form-row checkboxes">
        <label className="checkbox-inline">
          <input type="checkbox" checked={config.orderManagement.onlySellAboveBuyPrice} onChange={(e) => updateOrderManagement({ onlySellAboveBuyPrice: e.target.checked })} />
          <span className="label-with-tooltip">Sell Above Buy <Tooltip text={TOOLTIPS.onlySellAboveBuyPrice} position="left" /></span>
        </label>
        <div className="form-field compact">
          <label className="label-with-tooltip">Take Profit % <Tooltip text={TOOLTIPS.takeProfitPercent} /></label>
          <input type="number" min="0" step="0.01" value={config.riskManagement?.takeProfitPercent ?? 0.02} onChange={(e) => updateRiskManagement({ takeProfitPercent: parseFloat(e.target.value) || 0.02 })} disabled={!config.orderManagement.onlySellAboveBuyPrice} />
        </div>
      </div>

      <div className="form-row checkboxes">
        <label className="checkbox-inline">
          <input type="checkbox" checked={config.riskManagement?.stopLossEnabled ?? false} onChange={(e) => updateRiskManagement({ stopLossEnabled: e.target.checked })} />
          <span className="label-with-tooltip">Stop Loss <Tooltip text={TOOLTIPS.stopLoss} position="left" /></span>
        </label>
        {config.riskManagement?.stopLossEnabled && (
          <div className="form-field compact">
            <input
              type="number"
              min="0.1"
              max="100"
              step="0.1"
              value={config.riskManagement?.stopLossPercent ?? 5}
              onChange={(e) => {
                const value = parseFloat(e.target.value) || 5
                // Clamp to safe range: 0.1-100% (must be positive)
                updateRiskManagement({ stopLossPercent: Math.max(0.1, Math.min(100, value)) })
              }}
            />
            <span className="suffix">%</span>
          </div>
        )}
        <label className="checkbox-inline">
          <input type="checkbox" checked={config.riskManagement?.orderTimeoutEnabled ?? false} onChange={(e) => updateRiskManagement({ orderTimeoutEnabled: e.target.checked })} />
          <span className="label-with-tooltip">Order Timeout <Tooltip text={TOOLTIPS.orderTimeout} /></span>
        </label>
        {config.riskManagement?.orderTimeoutEnabled && (
          <div className="form-field compact">
            <input
              type="number"
              min="1"
              max="1440"
              step="1"
              value={config.riskManagement?.orderTimeoutMinutes ?? 30}
              onChange={(e) => {
                const value = parseInt(e.target.value) || 30
                // Clamp to safe range: 1-1440 minutes (max 24 hours)
                updateRiskManagement({ orderTimeoutMinutes: Math.max(1, Math.min(1440, value)) })
              }}
            />
            <span className="suffix">min</span>
          </div>
        )}
      </div>

      <div className="form-row checkboxes">
        <label className="checkbox-inline">
          <input type="checkbox" checked={config.riskManagement?.maxDailyLossEnabled ?? false} onChange={(e) => updateRiskManagement({ maxDailyLossEnabled: e.target.checked })} />
          <span className="label-with-tooltip">Max Daily Loss <Tooltip text={TOOLTIPS.maxDailyLoss} position="left" /></span>
        </label>
        {config.riskManagement?.maxDailyLossEnabled && (
          <div className="form-field compact">
            <span className="prefix">$</span>
            <input type="number" min="0" step="1" value={config.riskManagement?.maxDailyLossUsd ?? 100} onChange={(e) => updateRiskManagement({ maxDailyLossUsd: parseFloat(e.target.value) || 100 })} />
          </div>
        )}
        {config.dailyPnL && (
          <div className={`pnl-badge ${config.dailyPnL.realizedPnL >= 0 ? 'positive' : 'negative'}`}>
            P&L: {config.dailyPnL.realizedPnL >= 0 ? '+' : ''}${config.dailyPnL.realizedPnL.toFixed(2)}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="form-actions compact">
        <button type="button" onClick={onReset} className="btn btn-text">Reset</button>
        <div className="form-actions-right">
          <button type="button" onClick={onCancel} className="btn btn-secondary">Cancel</button>
          <button type="button" onClick={onSave} className="btn btn-primary">Save</button>
        </div>
      </div>
    </div>
  )
}
