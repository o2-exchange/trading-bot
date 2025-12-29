import { useState, useEffect } from 'react'
import { Market } from '../types/market'
import { StrategyConfigStore, StrategyConfig as StrategyConfigType, getDefaultStrategyConfig } from '../types/strategy'
import { db } from '../services/dbService'
import { useToast } from './ToastProvider'
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
      // Check if market ID has changed - if so, clear fill prices
      if (editingConfig.config.marketId !== selectedMarket) {
        // Market changed - clear fill prices and update market ID
        configToSave = {
          ...editingConfig.config,
          marketId: selectedMarket,
          averageBuyPrice: undefined,
          averageSellPrice: undefined,
          lastFillPrices: undefined,
          updatedAt: Date.now(),
        }
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
          <label>Order Type</label>
          <div className="select-wrapper">
            <select value={config.orderConfig.orderType} onChange={(e) => updateOrderConfig({ orderType: e.target.value as any })}>
              <option value="Market">Market</option>
              <option value="Spot">Spot</option>
            </select>
          </div>
        </div>
        <div className="form-field">
          <label>Price Mode</label>
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
          <label>Side</label>
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
          <label>Price Offset %</label>
          <input type="number" step="0.01" value={config.orderConfig.priceOffsetPercent} onChange={(e) => updateOrderConfig({ priceOffsetPercent: parseFloat(e.target.value) || 0 })} />
        </div>
        <div className="form-field">
          <label>Max Spread %</label>
          <input type="number" step="0.1" value={config.orderConfig.maxSpreadPercent} onChange={(e) => updateOrderConfig({ maxSpreadPercent: parseFloat(e.target.value) || 0 })} />
        </div>
        <div className="form-field">
          <label>Max Open Orders</label>
          <input type="number" min="1" value={config.orderManagement.maxOpenOrders} onChange={(e) => updateOrderManagement({ maxOpenOrders: parseInt(e.target.value) || 2 })} />
        </div>
      </div>

      <div className="form-divider" />

      {/* Position Sizing */}
      <div className="form-section-label">Position Sizing</div>
      <div className="form-row">
        <div className="form-field">
          <label>Size Mode</label>
          <div className="btn-group">
            <button type="button" className={`btn-toggle ${config.positionSizing.sizeMode === 'percentageOfBalance' ? 'active' : ''}`} onClick={() => updatePositionSizing({ sizeMode: 'percentageOfBalance' })}>% Balance</button>
            <button type="button" className={`btn-toggle ${config.positionSizing.sizeMode === 'fixedUsd' ? 'active' : ''}`} onClick={() => updatePositionSizing({ sizeMode: 'fixedUsd' })}>Fixed USD</button>
          </div>
        </div>
        {config.positionSizing.sizeMode === 'percentageOfBalance' ? (
          <>
            <div className="form-field">
              <label>{markets.find(m => m.market_id === selectedMarket)?.base.symbol || 'Base'} Balance %</label>
              <input type="number" min="0" max="100" step="1" value={config.positionSizing.baseBalancePercentage ?? config.positionSizing.balancePercentage} onChange={(e) => updatePositionSizing({ baseBalancePercentage: parseFloat(e.target.value) || 0 })} />
            </div>
            <div className="form-field">
              <label>{markets.find(m => m.market_id === selectedMarket)?.quote.symbol || 'Quote'} Balance %</label>
              <input type="number" min="0" max="100" step="1" value={config.positionSizing.quoteBalancePercentage ?? config.positionSizing.balancePercentage} onChange={(e) => updatePositionSizing({ quoteBalancePercentage: parseFloat(e.target.value) || 0 })} />
            </div>
          </>
        ) : (
          <div className="form-field flex-2">
            <label>Fixed Amount (USD)</label>
            <input type="number" min="0" step="0.01" value={config.positionSizing.fixedUsdAmount || 0} onChange={(e) => updatePositionSizing({ fixedUsdAmount: parseFloat(e.target.value) || 0 })} />
          </div>
        )}
      </div>

      <div className="form-row">
        <div className="form-field">
          <label>Min Order (USD)</label>
          <input type="number" min="0" step="0.01" value={config.positionSizing.minOrderSizeUsd} onChange={(e) => updatePositionSizing({ minOrderSizeUsd: parseFloat(e.target.value) || 5 })} />
        </div>
        <div className="form-field">
          <label>Max Order (USD)</label>
          <input type="number" min="0" step="0.01" value={config.positionSizing.maxOrderSizeUsd || ''} placeholder="No limit" onChange={(e) => updatePositionSizing({ maxOrderSizeUsd: e.target.value ? parseFloat(e.target.value) : undefined })} />
        </div>
        <div className="form-field">
          <label>Cycle Interval (ms)</label>
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
          <input type="checkbox" checked={config.orderManagement.trackFillPrices} onChange={(e) => updateOrderManagement({ trackFillPrices: e.target.checked })} />
          <span>Track Fills</span>
        </label>
        <label className={`checkbox-inline ${!config.orderManagement.trackFillPrices ? 'disabled' : ''}`}>
          <input type="checkbox" checked={config.orderManagement.onlySellAboveBuyPrice} onChange={(e) => updateOrderManagement({ onlySellAboveBuyPrice: e.target.checked })} disabled={!config.orderManagement.trackFillPrices} />
          <span>Sell Above Buy</span>
        </label>
        <div className="form-field compact">
          <label>Take Profit %</label>
          <input type="number" min="0" step="0.01" value={config.riskManagement?.takeProfitPercent ?? 0.02} onChange={(e) => updateRiskManagement({ takeProfitPercent: parseFloat(e.target.value) || 0.02 })} disabled={!config.orderManagement.onlySellAboveBuyPrice} />
        </div>
      </div>

      <div className="form-row checkboxes">
        <label className="checkbox-inline">
          <input type="checkbox" checked={config.riskManagement?.stopLossEnabled ?? false} onChange={(e) => updateRiskManagement({ stopLossEnabled: e.target.checked })} />
          <span>Stop Loss</span>
        </label>
        {config.riskManagement?.stopLossEnabled && (
          <div className="form-field compact">
            <input type="number" min="0" step="0.1" value={config.riskManagement?.stopLossPercent ?? 5} onChange={(e) => updateRiskManagement({ stopLossPercent: parseFloat(e.target.value) || 5 })} />
            <span className="suffix">%</span>
          </div>
        )}
        <label className="checkbox-inline">
          <input type="checkbox" checked={config.riskManagement?.orderTimeoutEnabled ?? false} onChange={(e) => updateRiskManagement({ orderTimeoutEnabled: e.target.checked })} />
          <span>Order Timeout</span>
        </label>
        {config.riskManagement?.orderTimeoutEnabled && (
          <div className="form-field compact">
            <input type="number" min="1" step="1" value={config.riskManagement?.orderTimeoutMinutes ?? 30} onChange={(e) => updateRiskManagement({ orderTimeoutMinutes: parseInt(e.target.value) || 30 })} />
            <span className="suffix">min</span>
          </div>
        )}
      </div>

      <div className="form-row checkboxes">
        <label className="checkbox-inline">
          <input type="checkbox" checked={config.riskManagement?.maxDailyLossEnabled ?? false} onChange={(e) => updateRiskManagement({ maxDailyLossEnabled: e.target.checked })} />
          <span>Max Daily Loss</span>
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
