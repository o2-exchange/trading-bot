import { useState, useEffect } from 'react'
import { Market } from '../types/market'
import { StrategyConfigStore, StrategyConfig as StrategyConfigType, getDefaultStrategyConfig } from '../types/strategy'
import { db } from '../services/dbService'
import { useToast } from './ToastProvider'
import { marketService } from '../services/marketService'
import './StrategyConfig.css'

interface StrategyConfigProps {
  markets: Market[]
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

export default function StrategyConfig({ markets }: StrategyConfigProps) {
  const [configs, setConfigs] = useState<StrategyConfigStore[]>([])
  const [editingConfig, setEditingConfig] = useState<StrategyConfigStore | null>(null)
  const [selectedMarket, setSelectedMarket] = useState<string>('')
  const [isCreating, setIsCreating] = useState(false)
  const { addToast } = useToast()

  useEffect(() => {
    loadConfigs()
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
      // Update existing config
      configToSave = {
        ...editingConfig.config,
        updatedAt: Date.now(),
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
    }
  }

  const currentConfig = editingConfig?.config || (selectedMarket ? getDefaultStrategyConfig(selectedMarket) : null)
  const showForm = isCreating || editingConfig

  return (
    <div className="strategy-config">
      {!showForm && (
        <div className="strategy-config-header">
          <button onClick={handleCreateNew} className="btn btn-primary">
            Create New Strategy
          </button>
        </div>
      )}

      {showForm && (
        <div className="config-modal-overlay" onClick={handleCancel}>
          <div className="config-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="config-modal-header">
              <h2>{editingConfig ? 'Edit Strategy' : 'Create New Strategy'}</h2>
              <button className="config-modal-close" onClick={handleCancel}>×</button>
            </div>
            <div className="config-modal-body">
              {currentConfig ? (
                <StrategyConfigForm
                  markets={markets}
                  selectedMarket={selectedMarket}
                  config={currentConfig}
                  onMarketChange={setSelectedMarket}
                  onConfigChange={(newConfig) => {
                    if (editingConfig) {
                      setEditingConfig({
                        ...editingConfig,
                        config: newConfig,
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
                      setSelectedMarket(e.target.value)
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
            <button onClick={handleCreateNew} className="btn btn-primary">
              Create Strategy
            </button>
          </div>
        ) : (
          <div className="configs-grid">
            {configs.map((config) => {
              const market = markets.find((m) => m.market_id === config.marketId)
              const marketPair = market 
                ? `${market.base.symbol}/${market.quote.symbol}`
                : config.marketId.slice(0, 8) + '...'
              
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
                    {config.config.averageBuyPrice && config.config.averageBuyPrice !== '0' && (
                      <div className="config-stats">
                        <div className="stat-item">
                          <span className="stat-label">Avg Buy Price</span>
                          <span className="stat-value">{parseFloat(config.config.averageBuyPrice).toFixed(4)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <div className="config-card-actions">
                    <button onClick={() => handleEdit(config)} className="btn-action btn-edit">
                      Edit
                    </button>
                    <button
                      onClick={() => handleToggleActive(config)}
                      className={`btn-action ${config.isActive ? 'btn-deactivate' : 'btn-activate'}`}
                    >
                      {config.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    <button onClick={() => handleDelete(config)} className="btn-action btn-delete">
                      Delete
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
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
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['basic', 'order']))

  const toggleSection = (section: string) => {
    const newExpanded = new Set(expandedSections)
    if (newExpanded.has(section)) {
      newExpanded.delete(section)
    } else {
      newExpanded.add(section)
    }
    setExpandedSections(newExpanded)
  }

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
    <div className="strategy-config-form">
      <div className="form-section">
        <div className="section-header" onClick={() => toggleSection('basic')}>
          <h3>Basic Settings</h3>
          <span className="section-toggle">{expandedSections.has('basic') ? '−' : '+'}</span>
        </div>
        {expandedSections.has('basic') && (
          <div className="section-content">
        <div className="form-group">
              <label>Market *</label>
          <div className="select-wrapper">
            <select
              value={selectedMarket}
              onChange={(e) => onMarketChange(e.target.value)}
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
            </div>
            <div className="form-group">
              <label>Strategy Name (optional)</label>
              <input
                type="text"
                value={config.name || ''}
                onChange={(e) => updateConfig({ name: e.target.value })}
                placeholder="My Trading Strategy"
              />
            </div>
          </div>
        )}
      </div>

      <div className="form-section">
        <div className="section-header" onClick={() => toggleSection('order')}>
          <h3>Order Settings</h3>
          <span className="section-toggle">{expandedSections.has('order') ? '−' : '+'}</span>
        </div>
        {expandedSections.has('order') && (
          <div className="section-content">
            <div className="form-group">
              <label>Order Type *</label>
              <div className="select-wrapper">
                <select
                  value={config.orderConfig.orderType}
                  onChange={(e) => updateOrderConfig({ orderType: e.target.value as any })}
                >
                  <option value="Market">Market</option>
                  <option value="Spot">Spot</option>
                </select>
              </div>
              <small>Market: Executes immediately at the best available price. Spot: Executes immediately, similar to Market but with different contract-level handling.</small>
            </div>
            <div className="form-group">
              <label>Price Mode *</label>
              <div className="select-wrapper">
                <select
                  value={config.orderConfig.priceMode}
                  onChange={(e) => updateOrderConfig({ priceMode: e.target.value as any })}
                >
                  <option value="offsetFromMid">Offset from Mid Price</option>
                  <option value="offsetFromBestBid">Offset from Best Bid</option>
                  <option value="offsetFromBestAsk">Offset from Best Ask</option>
                  <option value="market">Market Price</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>Price Offset (%) *</label>
              <input
                type="number"
                step="0.01"
                value={config.orderConfig.priceOffsetPercent}
                onChange={(e) => updateOrderConfig({ priceOffsetPercent: parseFloat(e.target.value) || 0 })}
              />
              <small>Price offset from reference (positive = above, negative = below). For Market/Spot orders, this sets the target price but orders execute at best available price.</small>
            </div>
            <div className="form-group">
              <label>Max Spread (%) *</label>
              <input
                type="number"
                step="0.1"
                value={config.orderConfig.maxSpreadPercent}
                onChange={(e) => updateOrderConfig({ maxSpreadPercent: parseFloat(e.target.value) || 0 })}
              />
              <small>Don't trade if spread exceeds this percentage</small>
            </div>
            <div className="form-group">
              <label>Order Side *</label>
              <div className="radio-group">
                <label className="radio-option">
                  <input
                    type="radio"
                    name="orderSide"
                    value="Buy"
                    checked={config.orderConfig.side === 'Buy'}
                    onChange={() => updateOrderConfig({ side: 'Buy' })}
                  />
                  <span className="radio-custom"></span>
                  <span className="radio-label">Buy</span>
                </label>
                <label className="radio-option">
                  <input
                    type="radio"
                    name="orderSide"
                    value="Sell"
                    checked={config.orderConfig.side === 'Sell'}
                    onChange={() => updateOrderConfig({ side: 'Sell' })}
                  />
                  <span className="radio-custom"></span>
                  <span className="radio-label">Sell</span>
                </label>
                <label className="radio-option">
                  <input
                    type="radio"
                    name="orderSide"
                    value="Both"
                    checked={config.orderConfig.side === 'Both'}
                    onChange={() => updateOrderConfig({ side: 'Both' })}
                  />
                  <span className="radio-custom"></span>
                  <span className="radio-label">Both</span>
                </label>
              </div>
            </div>
          </div>
        )}
        </div>

      <div className="form-section">
        <div className="section-header" onClick={() => toggleSection('sizing')}>
          <h3>Position Sizing</h3>
          <span className="section-toggle">{expandedSections.has('sizing') ? '−' : '+'}</span>
        </div>
        {expandedSections.has('sizing') && (
          <div className="section-content">
            <div className="form-group">
              <label>Size Mode *</label>
              <div className="radio-group">
                <label className="radio-option">
                  <input
                    type="radio"
                    name="sizeMode"
                    value="percentageOfBalance"
                    checked={config.positionSizing.sizeMode === 'percentageOfBalance'}
                    onChange={() => updatePositionSizing({ sizeMode: 'percentageOfBalance' })}
                  />
                  <span className="radio-custom"></span>
                  <span className="radio-label">% of Balance</span>
                </label>
                <label className="radio-option">
                  <input
                    type="radio"
                    name="sizeMode"
                    value="fixedUsd"
                    checked={config.positionSizing.sizeMode === 'fixedUsd'}
                    onChange={() => updatePositionSizing({ sizeMode: 'fixedUsd' })}
                  />
                  <span className="radio-custom"></span>
                  <span className="radio-label">Fixed USD</span>
                </label>
              </div>
            </div>
            {config.positionSizing.sizeMode === 'percentageOfBalance' && (
              <>
                <div className="form-group">
                  <label>Base Balance Percentage (%) *</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={config.positionSizing.baseBalancePercentage ?? config.positionSizing.balancePercentage}
                    onChange={(e) => updatePositionSizing({ baseBalancePercentage: parseFloat(e.target.value) || 0 })}
                  />
                  <small className="form-hint">Percentage of base balance to use for sell orders</small>
                </div>
                <div className="form-group">
                  <label>Quote Balance Percentage (%) *</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={config.positionSizing.quoteBalancePercentage ?? config.positionSizing.balancePercentage}
                    onChange={(e) => updatePositionSizing({ quoteBalancePercentage: parseFloat(e.target.value) || 0 })}
                  />
                  <small className="form-hint">Percentage of quote balance to use for buy orders</small>
                </div>
              </>
            )}
            {config.positionSizing.sizeMode === 'fixedUsd' && (
              <div className="form-group">
                <label>Fixed USD Amount *</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={config.positionSizing.fixedUsdAmount || 0}
                  onChange={(e) => updatePositionSizing({ fixedUsdAmount: parseFloat(e.target.value) || 0 })}
                />
              </div>
            )}
            <div className="form-group">
              <label>Min Order Size (USD) *</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={config.positionSizing.minOrderSizeUsd}
                onChange={(e) => updatePositionSizing({ minOrderSizeUsd: parseFloat(e.target.value) || 5 })}
              />
            </div>
            <div className="form-group">
              <label>Max Order Size (USD)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={config.positionSizing.maxOrderSizeUsd || ''}
                onChange={(e) => updatePositionSizing({ maxOrderSizeUsd: e.target.value ? parseFloat(e.target.value) : undefined })}
              />
              <small className="form-hint">Optional: Cap order size at this USD value (leave empty for no limit)</small>
            </div>
          </div>
        )}
      </div>

      <div className="form-section">
        <div className="section-header" onClick={() => toggleSection('management')}>
          <h3>Order Management</h3>
          <span className="section-toggle">{expandedSections.has('management') ? '−' : '+'}</span>
        </div>
        {expandedSections.has('management') && (
          <div className="section-content">
            <div className="form-group">
              <label className="checkbox-option">
                <input
                  type="checkbox"
                  checked={config.orderManagement.trackFillPrices}
                  onChange={(e) => updateOrderManagement({ trackFillPrices: e.target.checked })}
                />
                <span className="checkbox-custom"></span>
                <span className="checkbox-label">Track Fill Prices</span>
              </label>
            </div>
            <div className="form-group">
              <label className={`checkbox-option ${!config.orderManagement.trackFillPrices ? 'disabled' : ''}`}>
                <input
                  type="checkbox"
                  checked={config.orderManagement.onlySellAboveBuyPrice}
                  onChange={(e) => updateOrderManagement({ onlySellAboveBuyPrice: e.target.checked })}
                  disabled={!config.orderManagement.trackFillPrices}
                />
                <span className="checkbox-custom"></span>
                <span className="checkbox-label">Only Sell Above Buy Price</span>
              </label>
              <small>Requires fill price tracking to be enabled</small>
            </div>
            <div className="form-group">
              <label>Max Open Orders (per side) *</label>
              <input
                type="number"
                min="1"
                value={config.orderManagement.maxOpenOrders}
                onChange={(e) => updateOrderManagement({ maxOpenOrders: parseInt(e.target.value) || 2 })}
              />
            </div>
            <div className="form-group">
              <label className="checkbox-option">
                <input
                  type="checkbox"
                  checked={config.orderManagement.cancelAndReplace}
                  onChange={(e) => updateOrderManagement({ cancelAndReplace: e.target.checked })}
                />
                <span className="checkbox-custom"></span>
                <span className="checkbox-label">Cancel & Replace Orders</span>
              </label>
              <small>Cancel existing orders before placing new ones</small>
            </div>
          </div>
        )}
        </div>


      <div className="form-section">
        <div className="section-header" onClick={() => toggleSection('timing')}>
          <h3>Timing</h3>
          <span className="section-toggle">{expandedSections.has('timing') ? '−' : '+'}</span>
        </div>
        {expandedSections.has('timing') && (
          <div className="section-content">
            <div className="form-group">
              <label>Min Interval (ms) *</label>
              <input
                type="number"
                min="1000"
                step="100"
                value={config.timing.cycleIntervalMinMs}
                onChange={(e) => updateTiming({ cycleIntervalMinMs: parseInt(e.target.value) || 3000 })}
              />
            </div>
            <div className="form-group">
              <label>Max Interval (ms) *</label>
              <input
                type="number"
                min="1000"
                step="100"
                value={config.timing.cycleIntervalMaxMs}
                onChange={(e) => updateTiming({ cycleIntervalMaxMs: parseInt(e.target.value) || 5000 })}
              />
            </div>
          </div>
        )}
      </div>

      <div className="form-actions">
        <button onClick={onReset} className="btn btn-secondary">
          Reset to Default
        </button>
        <div className="form-actions-right">
          <button onClick={onCancel} className="btn btn-secondary">
            Cancel
          </button>
          <button onClick={onSave} className="btn btn-primary">
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  )
}
