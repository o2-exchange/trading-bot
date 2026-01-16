import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Market } from '../types/market'
import { StrategyConfigStore, StrategyConfig as StrategyConfigType, getDefaultStrategyConfig, getPresetStrategyConfig, StrategyPreset, STRATEGY_PRESET_LABELS, STRATEGY_PRESET_DESCRIPTIONS, OrderConfig, PositionSizingConfig, OrderManagementConfig, RiskManagementConfig, TimingConfig } from '../types/strategy'
import { db } from '../services/dbService'
import { orderService } from '../services/orderService'
import { walletService } from '../services/walletService'
import { tradingEngine } from '../services/tradingEngine'
import { tradingSessionService } from '../services/tradingSessionService'
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

// NumberInput component that allows clearing the field
interface NumberInputProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number | string
  disabled?: boolean
  placeholder?: string
  isInteger?: boolean
}

function NumberInput({ value, onChange, min, max, step = 'any', disabled, placeholder, isInteger }: NumberInputProps) {
  const [localValue, setLocalValue] = useState<string>(String(value))

  // Sync local value when external value changes (e.g., preset change)
  useEffect(() => {
    setLocalValue(String(value))
  }, [value])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value
    setLocalValue(rawValue) // Allow any input including empty

    // Parse and update parent if valid
    if (rawValue !== '' && rawValue !== '-') {
      const parsed = isInteger ? parseInt(rawValue, 10) : parseFloat(rawValue)
      if (!isNaN(parsed)) {
        let clamped = parsed
        if (min !== undefined) clamped = Math.max(min, clamped)
        if (max !== undefined) clamped = Math.min(max, clamped)
        onChange(clamped)
      }
    }
  }

  const handleBlur = () => {
    // On blur, if empty or invalid, reset to current value
    const parsed = isInteger ? parseInt(localValue, 10) : parseFloat(localValue)
    if (isNaN(parsed) || localValue === '') {
      setLocalValue(String(value))
    } else {
      // Ensure displayed value matches clamped value
      let clamped = parsed
      if (min !== undefined) clamped = Math.max(min, clamped)
      if (max !== undefined) clamped = Math.min(max, clamped)
      setLocalValue(String(clamped))
    }
  }

  return (
    <input
      type="number"
      value={localValue}
      onChange={handleChange}
      onBlur={handleBlur}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      placeholder={placeholder}
    />
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
  maxSessionLoss: "Pause trading for the session if realized losses exceed this USD amount. End session to reset.",
}

// Format price mode for display
const formatPriceMode = (mode?: string): string => {
  switch (mode) {
    case 'offsetFromMid': return 'Mid'
    case 'offsetFromBestBid': return 'Best Bid'
    case 'offsetFromBestAsk': return 'Best Ask'
    case 'market': return 'Market'
    default: return mode || 'Mid'
  }
}

// Format interval for display (ms to human readable)
const formatInterval = (minMs?: number, maxMs?: number): string => {
  const min = minMs ? (minMs / 1000).toFixed(0) : '3'
  const max = maxMs ? (maxMs / 1000).toFixed(0) : '5'
  return `${min}-${max}s`
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
  const { t } = useTranslation()
  const [configs, setConfigs] = useState<StrategyConfigStore[]>([])
  const [editingConfig, setEditingConfig] = useState<StrategyConfigStore | null>(null)
  const [selectedMarket, setSelectedMarket] = useState<string>('')
  const [isCreating, setIsCreating] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [importMarket, setImportMarket] = useState<string>('')
  const [importJson, setImportJson] = useState<string>('')
  const [currentPreset, setCurrentPreset] = useState<StrategyPreset>('simple')
  const [showCancelOrdersConfirm, setShowCancelOrdersConfirm] = useState(false)
  const [pendingAction, setPendingAction] = useState<{ type: 'save' | 'deactivate'; config?: StrategyConfigStore } | null>(null)
  const [isCancellingOrders, setIsCancellingOrders] = useState(false)
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

  // Actual save logic extracted to be called after order cancellation confirmation
  const performSave = async () => {
    if (!selectedMarket) {
      addToast(t('strategy.select_market_error'), 'error')
      return
    }

    const market = markets.find((m) => m.market_id === selectedMarket)
    if (!market) {
      addToast(t('strategy.market_not_found'), 'error')
      return
    }

    let configToSave: StrategyConfigType

    if (editingConfig) {
      // Check if market ID has changed - if so, warn user and clear fill prices
      const oldMarketId = editingConfig.config.marketId
      if (oldMarketId !== selectedMarket) {
        // Warn user that changing market will clear trading history
        const hasHistory = editingConfig.config.averageBuyPrice ||
          editingConfig.config.averageSellPrice ||
          (editingConfig.config.lastFillPrices?.buy?.length ?? 0) > 0 ||
          (editingConfig.config.lastFillPrices?.sell?.length ?? 0) > 0

        if (hasHistory) {
          const confirmed = confirm(t('strategy.market_change_warning'))
          if (!confirmed) {
            return
          }
        }

        // Stop trading for the old market if trading is active
        if (tradingEngine.isActive()) {
          tradingEngine.stopMarketTrading(oldMarketId)
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
        addToast(t('strategy.market_changed'), 'warning')
      } else {
        // Update existing config (same market)
        configToSave = {
          ...editingConfig.config,
          updatedAt: Date.now(),
        }
      }
    } else {
      // Create new config with current preset
      configToSave = getPresetStrategyConfig(selectedMarket, currentPreset)
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

    // If this is an active strategy and trading is active, ensure it's added to engine
    // (addMarketTrading already checks if market is already being traded and returns early)
    if (configStore.isActive && tradingEngine.isActive()) {
      await tradingEngine.addMarketTrading(selectedMarket)
    }

    await loadConfigs()
    addToast(t('strategy.saved'), 'success')
    handleCancel()
  }

  const handleSave = async () => {
    if (!selectedMarket) {
      addToast(t('strategy.select_market_error'), 'error')
      return
    }

    // Check for open orders before saving
    const wallet = walletService.getConnectedWallet()
    if (wallet && selectedMarket) {
      try {
        const openOrders = await orderService.getOpenOrders(selectedMarket, wallet.address)
        if (openOrders.length > 0) {
          setPendingAction({ type: 'save' })
          setShowCancelOrdersConfirm(true)
          return
        }
      } catch (error) {
        console.error('Failed to check open orders:', error)
        // Proceed with save if we can't check orders
      }
    }

    // No open orders, proceed with save
    await performSave()
  }

  // Actual toggle logic extracted to be called after order cancellation confirmation
  const performToggleActive = async (config: StrategyConfigStore) => {
    const isDeactivating = config.isActive

    await db.strategyConfigs.update(config.id, {
      isActive: !config.isActive,
      updatedAt: Date.now(),
    })

    // Update trading engine if it's active
    if (tradingEngine.isActive()) {
      if (isDeactivating) {
        // Deactivating - stop trading for this specific market
        tradingEngine.stopMarketTrading(config.marketId)
      } else {
        // Activating - start trading for this market
        await tradingEngine.addMarketTrading(config.marketId)
      }
    }

    await loadConfigs()
  }

  const handleToggleActive = async (config: StrategyConfigStore) => {
    // If deactivating, check for open orders
    if (config.isActive) {
      const wallet = walletService.getConnectedWallet()
      if (wallet) {
        try {
          const openOrders = await orderService.getOpenOrders(config.marketId, wallet.address)
          if (openOrders.length > 0) {
            setPendingAction({ type: 'deactivate', config })
            setShowCancelOrdersConfirm(true)
            return
          }
        } catch (error) {
          console.error('Failed to check open orders:', error)
          // Proceed with toggle if we can't check orders
        }
      }
    }

    // No open orders or activating, proceed
    await performToggleActive(config)
  }

  // Handle confirmation of order cancellation
  const handleConfirmCancelOrders = async () => {
    if (!pendingAction) return

    const wallet = walletService.getConnectedWallet()
    if (!wallet) {
      addToast(t('wallet.not_connected'), 'error')
      setShowCancelOrdersConfirm(false)
      setPendingAction(null)
      return
    }

    setIsCancellingOrders(true)

    try {
      const marketId = pendingAction.type === 'save' ? selectedMarket : pendingAction.config?.marketId
      if (marketId) {
        const result = await orderService.cancelOrdersForMarket(marketId, wallet.address)
        if (result.cancelled > 0) {
          addToast(t('strategy.orders_cancelled', { count: result.cancelled }), 'info')
        }
        if (result.failed > 0) {
          addToast(t('strategy.orders_cancel_failed', { count: result.failed }), 'warning')
        }
        // Trigger refresh of OpenOrdersPanel
        window.dispatchEvent(new Event('refresh-orders'))
      }
    } catch (error) {
      console.error('Failed to cancel orders:', error)
      addToast(t('strategy.orders_cancel_error'), 'warning')
    } finally {
      setIsCancellingOrders(false)
    }

    // Proceed with the pending action
    if (pendingAction.type === 'save') {
      await performSave()
    } else if (pendingAction.config) {
      await performToggleActive(pendingAction.config)
    }

    setShowCancelOrdersConfirm(false)
    setPendingAction(null)
  }

  const handleCancelOrdersDialogClose = () => {
    setShowCancelOrdersConfirm(false)
    setPendingAction(null)
  }

  const handleDelete = async (config: StrategyConfigStore) => {
    if (confirm(t('strategy.delete_confirm'))) {
      // Stop trading for this market if trading is active
      if (tradingEngine.isActive()) {
        tradingEngine.stopMarketTrading(config.marketId)
      }

      // End all trading sessions for this market so they don't show in TradeConsole
      const wallet = walletService.getConnectedWallet()
      if (wallet) {
        const walletAddress = typeof wallet.address === 'string'
          ? wallet.address.toLowerCase()
          : String(wallet.address).toLowerCase()
        await tradingSessionService.endAllResumableSessions(walletAddress, config.marketId)
      }

      await db.strategyConfigs.delete(config.id)
      await loadConfigs()
      addToast(t('strategy.deleted'), 'success')
    }
  }

  const handleResetToDefault = () => {
    if (!selectedMarket) return

    // Reset to Simple Mode preset
    const simpleConfig = getPresetStrategyConfig(selectedMarket, 'simple')
    if (editingConfig) {
      setEditingConfig({
        ...editingConfig,
        config: simpleConfig,
      })
    } else if (isCreating) {
      // Reset for new strategy
      setEditingConfig({
        id: selectedMarket,
        marketId: selectedMarket,
        config: simpleConfig,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    }
    setCurrentPreset('simple')
  }

  const handlePresetChange = (preset: StrategyPreset) => {
    setCurrentPreset(preset)
    if (selectedMarket) {
      const presetConfig = getPresetStrategyConfig(selectedMarket, preset)
      if (editingConfig) {
        setEditingConfig({
          ...editingConfig,
          config: presetConfig,
        })
      } else if (isCreating) {
        setEditingConfig({
          id: selectedMarket,
          marketId: selectedMarket,
          config: presetConfig,
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
      }
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
      addToast(t('strategy.copied_to_clipboard'), 'success')
    } catch (error) {
      addToast(t('strategy.copy_failed'), 'error')
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
      addToast(t('strategy.exported'), 'success')
    } catch (error) {
      addToast(t('strategy.export_failed'), 'error')
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
      addToast(t('strategy.file_read_failed'), 'error')
    }
    reader.readAsText(file)
  }

  // Process and validate import
  const handleProcessImport = () => {
    if (!importMarket) {
      addToast(t('strategy.select_target_market'), 'error')
      return
    }

    if (!importJson.trim()) {
      addToast(t('strategy.provide_json'), 'error')
      return
    }

    try {
      const data = JSON.parse(importJson)

      // Validate version and required fields
      if (!data.orderConfig || !data.positionSizing || !data.orderManagement || !data.riskManagement || !data.timing) {
        addToast(t('strategy.invalid_format'), 'error')
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

      addToast(t('strategy.imported'), 'success')
    } catch (error) {
      addToast(t('strategy.invalid_json'), 'error')
    }
  }

  const currentConfig = editingConfig?.config || (selectedMarket ? getPresetStrategyConfig(selectedMarket, currentPreset) : null)
  const showForm = isCreating || editingConfig

  return (
    <div className="strategy-config">
      {showForm && (
        <div className="config-modal-overlay" onClick={handleCancel}>
          <div className="config-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="config-modal-header">
              <h2>{editingConfig ? t('strategy.edit_strategy') : t('strategy.create_new')}</h2>
              <div className="config-modal-header-actions">
                {editingConfig && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleCopyToClipboard(editingConfig)}
                      className="btn-export"
                      title={t('strategy.copy_tooltip')}
                    >
                      {t('strategy.copy')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExportAsFile(editingConfig)}
                      className="btn-export"
                      title={t('strategy.export_tooltip')}
                    >
                      {t('strategy.export')}
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
                  preset={currentPreset}
                  onPresetChange={handlePresetChange}
                  onMarketChange={(marketId) => {
                    setSelectedMarket(marketId)
                    // When creating new and market changes, create a new editingConfig with preset
                    if (isCreating && marketId) {
                      const newConfig = getPresetStrategyConfig(marketId, currentPreset)
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
                    // Switch to custom mode when user manually edits
                    if (currentPreset !== 'custom') {
                      setCurrentPreset('custom')
                    }
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
                  <label>{t('strategy.market')} *</label>
                  <select
                    value={selectedMarket}
                    onChange={(e) => {
                      const marketId = e.target.value
                      setSelectedMarket(marketId)
                      // Initialize editingConfig when market is selected with current preset
                      if (marketId) {
                        const newConfig = getPresetStrategyConfig(marketId, currentPreset)
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
                    <option value="">{t('strategy.select_market')}</option>
                    {markets.map((market) => (
                      <option key={market.market_id} value={market.market_id}>
                        {market.base.symbol}/{market.quote.symbol}
                      </option>
                    ))}
                  </select>
                  <small style={{ display: 'block', marginTop: '8px', color: 'var(--muted-foreground)' }}>
                    {t('strategy.select_market_hint')}
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
            <p>{t('strategy.no_configs')}</p>
            <div className="empty-state-actions">
              <button onClick={handleCreateNew} className="btn btn-primary">
                {t('strategy.create_strategy')}
              </button>
              <button onClick={handleOpenImport} className="btn btn-secondary">
                {t('strategy.import')}
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
                      {config.isActive ? t('strategy.active') : t('strategy.inactive')}
                    </span>
                  </div>
                  
                  <div className="config-card-body">
                    {config.config.orderConfig && (
                      <div className="config-inline-grid">
                        {/* Left: Order & Position settings */}
                        <div className="config-left">
                          <span className="cfg-text">
                            <span className="cfg-label">Type:</span> {config.config.orderConfig.orderType === 'Spot' ? 'Limit' : 'Market'} ·
                            <span className="cfg-label">Side:</span> {config.config.orderConfig.side || 'Both'} ·
                            <span className="cfg-label">Mode:</span> {formatPriceMode(config.config.orderConfig.priceMode)}
                          </span>
                          <span className="cfg-text">
                            <span className="cfg-label">Offset:</span> {config.config.orderConfig.priceOffsetPercent?.toFixed(2) || '0.00'}% ·
                            <span className="cfg-label">Spread:</span> {config.config.orderConfig.maxSpreadPercent?.toFixed(1) || '0'}% ·
                            <span className="cfg-label">Orders:</span> {config.config.orderManagement?.maxOpenOrders || 2}
                          </span>
                          <span className="cfg-text">
                            <span className="cfg-label">Size:</span>
                            {config.config.positionSizing?.sizeMode === 'fixedUsd'
                              ? ` $${config.config.positionSizing.fixedUsdAmount || 0}`
                              : ` ${config.config.positionSizing?.baseBalancePercentage ?? 100}%/${config.config.positionSizing?.quoteBalancePercentage ?? 100}%`
                            } ·
                            <span className="cfg-label">Min:</span> ${config.config.positionSizing?.minOrderSizeUsd || 5}
                            {config.config.positionSizing?.maxOrderSizeUsd ? <> · <span className="cfg-label">Max:</span> ${config.config.positionSizing.maxOrderSizeUsd}</> : null} ·
                            <span className="cfg-label">Interval:</span> {formatInterval(config.config.timing?.cycleIntervalMinMs, config.config.timing?.cycleIntervalMaxMs)}
                          </span>
                        </div>
                        {/* Right: Risk management */}
                        <div className="config-right">
                          <span className={config.config.orderManagement?.onlySellAboveBuyPrice ? 'risk-on' : 'risk-off'}>
                            Sell Above{config.config.orderManagement?.onlySellAboveBuyPrice ? ` +${config.config.riskManagement?.takeProfitPercent || 0.02}%` : ''}
                          </span>
                          <span className={config.config.riskManagement?.stopLossEnabled ? 'risk-on' : 'risk-off'}>
                            Stop Loss{config.config.riskManagement?.stopLossEnabled ? ` ${config.config.riskManagement?.stopLossPercent}%` : ''}
                          </span>
                          <span className={config.config.riskManagement?.orderTimeoutEnabled ? 'risk-on' : 'risk-off'}>
                            Timeout{config.config.riskManagement?.orderTimeoutEnabled ? ` ${config.config.riskManagement?.orderTimeoutMinutes}m` : ''}
                          </span>
                          <span className={config.config.riskManagement?.maxSessionLossEnabled ? 'risk-on' : 'risk-off'}>
                            Session Limit{config.config.riskManagement?.maxSessionLossEnabled ? ` $${config.config.riskManagement?.maxSessionLossUsd}` : ''}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <div className="config-card-actions">
                    <button type="button" onClick={() => handleEdit(config)} className="btn-action btn-edit">
                      {t('strategy.edit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleActive(config)}
                      className={`btn-action ${config.isActive ? 'btn-deactivate' : 'btn-activate'}`}
                    >
                      {config.isActive ? t('strategy.deactivate') : t('strategy.activate')}
                    </button>
                    <button type="button" onClick={() => handleDelete(config)} className="btn-action btn-delete">
                      {t('strategy.delete')}
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
              <h2>{t('strategy.import_strategy')}</h2>
              <button className="config-modal-close" onClick={() => setShowImportModal(false)}>×</button>
            </div>
            <div className="config-modal-body">
              <div className="form-group">
                <label>{t('strategy.target_market')} *</label>
                <div className="select-wrapper">
                  <select
                    value={importMarket}
                    onChange={(e) => setImportMarket(e.target.value)}
                    required
                  >
                    <option value="">{t('strategy.select_market')}</option>
                    {markets.map((market) => (
                      <option key={market.market_id} value={market.market_id}>
                        {market.base.symbol}/{market.quote.symbol}
                      </option>
                    ))}
                  </select>
                </div>
                <small>{t('strategy.import_market_hint')}</small>
              </div>

              <div className="import-divider">
                <span>{t('strategy.upload_file')}</span>
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
                <span>{t('strategy.or_paste_json')}</span>
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
                    {t('common.cancel')}
                  </button>
                  <button type="button" onClick={handleProcessImport} className="btn btn-primary">
                    {t('strategy.import')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Orders Confirmation Dialog */}
      {showCancelOrdersConfirm && (
        <div className="config-modal-overlay" onClick={handleCancelOrdersDialogClose}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-dialog-header">
              <h3>{pendingAction?.type === 'save' ? t('strategy.save_strategy') : t('strategy.deactivate_strategy')}</h3>
            </div>
            <div className="confirm-dialog-body">
              {isCancellingOrders ? (
                <p>{t('strategy.cancelling_orders')}</p>
              ) : (
                <>
                  <p>{t('strategy.open_orders_warning')}</p>
                  <ul>
                    <li>{t('strategy.will_cancel_orders')}</li>
                    <li>{pendingAction?.type === 'save' ? t('strategy.will_save_changes') : t('strategy.will_deactivate')}</li>
                  </ul>
                  <p>{t('strategy.confirm_proceed')}</p>
                </>
              )}
            </div>
            <div className="confirm-dialog-actions">
              <button onClick={handleCancelOrdersDialogClose} className="cancel-btn" disabled={isCancellingOrders}>
                {t('common.cancel')}
              </button>
              <button onClick={handleConfirmCancelOrders} className="confirm-btn" disabled={isCancellingOrders}>
                {isCancellingOrders ? t('common.processing') : t('common.confirm')}
              </button>
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
  preset: StrategyPreset
  onPresetChange: (preset: StrategyPreset) => void
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
  preset,
  onPresetChange,
  onMarketChange,
  onConfigChange,
  onSave,
  onCancel,
  onReset,
}: StrategyConfigFormProps) {
  const { t } = useTranslation()

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
    // When enabling "Sell Above Buy Price", force order type to Limit (Spot)
    if (updates.onlySellAboveBuyPrice === true) {
      updateConfig({
        orderManagement: {
          ...config.orderManagement,
          ...updates,
        },
        orderConfig: {
          ...config.orderConfig,
          orderType: 'Spot', // Force Limit orders when sell above buy is enabled
        },
      })
    } else {
      updateConfig({
        orderManagement: {
          ...config.orderManagement,
          ...updates,
        },
      })
    }
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
          <label>{t('strategy.market')}</label>
          <div className="select-wrapper">
            <select value={selectedMarket} onChange={(e) => onMarketChange(e.target.value)} required>
              <option value="">{t('strategy.select_market')}</option>
              {markets.map((market) => (
                <option key={market.market_id} value={market.market_id}>
                  {market.base.symbol}/{market.quote.symbol}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-field flex-2">
          <label>{t('strategy.strategy_name')}</label>
          <input
            type="text"
            value={config.name || ''}
            onChange={(e) => updateConfig({ name: e.target.value })}
            placeholder={t('strategy.optional')}
          />
        </div>
      </div>

      {/* Preset Mode Tabs */}
      <div className="preset-tabs">
        {(['simple', 'volumeMaximizing', 'profitTaking', 'custom'] as StrategyPreset[]).map((presetKey) => (
          <div
            key={presetKey}
            className={`preset-tab ${preset === presetKey ? 'active' : ''}`}
            onClick={() => onPresetChange(presetKey)}
          >
            <div className="preset-tab-name">{t(`strategy.preset_${presetKey}`)}</div>
            <div className="preset-tab-desc">{t(`strategy.preset_${presetKey}_desc`)}</div>
          </div>
        ))}
      </div>

      <div className="form-divider" />

      {/* Row 2: Order Type, Price Mode, Side */}
      <div className="form-row">
        <div className="form-field">
          <label className="label-with-tooltip">
            {t('strategy.order_type')} <Tooltip text={TOOLTIPS.orderType} position="left" />
            {config.orderManagement.onlySellAboveBuyPrice && (
              <span className="field-locked-indicator" title={t('strategy.limit_locked_hint')}>🔒</span>
            )}
          </label>
          <div className="select-wrapper">
            <select
              value={config.orderConfig.orderType}
              onChange={(e) => updateOrderConfig({ orderType: e.target.value as any })}
              disabled={config.orderManagement.onlySellAboveBuyPrice}
              className={config.orderManagement.onlySellAboveBuyPrice ? 'disabled-locked' : ''}
            >
              <option value="Market">{t('strategy.market_order')}</option>
              <option value="Spot">{t('strategy.limit_order')}</option>
            </select>
          </div>
          {config.orderManagement.onlySellAboveBuyPrice && (
            <small className="field-hint">{t('strategy.limit_required')}</small>
          )}
        </div>
        <div className="form-field">
          <label className="label-with-tooltip">{t('strategy.price_mode')} <Tooltip text={TOOLTIPS.priceMode} /></label>
          <div className="select-wrapper">
            <select value={config.orderConfig.priceMode} onChange={(e) => updateOrderConfig({ priceMode: e.target.value as any })}>
              <option value="offsetFromMid">{t('strategy.mid_price')}</option>
              <option value="offsetFromBestBid">{t('strategy.best_bid')}</option>
              <option value="offsetFromBestAsk">{t('strategy.best_ask')}</option>
              <option value="market">{t('strategy.market_price')}</option>
            </select>
          </div>
        </div>
        <div className="form-field">
          <label className="label-with-tooltip">{t('strategy.side')} <Tooltip text={TOOLTIPS.side} position="right" /></label>
          <div className="btn-group">
            <button type="button" className={`btn-toggle ${config.orderConfig.side === 'Buy' ? 'active' : ''}`} onClick={() => updateOrderConfig({ side: 'Buy' })}>{t('strategy.buy')}</button>
            <button type="button" className={`btn-toggle ${config.orderConfig.side === 'Sell' ? 'active' : ''}`} onClick={() => updateOrderConfig({ side: 'Sell' })}>{t('strategy.sell')}</button>
            <button type="button" className={`btn-toggle ${config.orderConfig.side === 'Both' ? 'active' : ''}`} onClick={() => updateOrderConfig({ side: 'Both' })}>{t('strategy.both')}</button>
          </div>
        </div>
      </div>

      {/* Row 3: Price Offset, Max Spread */}
      <div className="form-row">
        <div className="form-field">
          <label className="label-with-tooltip">{t('strategy.price_offset')} <Tooltip text={TOOLTIPS.priceOffsetPercent} position="left" /></label>
          <NumberInput
            value={config.orderConfig.priceOffsetPercent}
            onChange={(value) => updateOrderConfig({ priceOffsetPercent: value })}
            min={0}
            max={50}
            step={0.01}
          />
        </div>
        <div className="form-field">
          <label className="label-with-tooltip">{t('strategy.max_spread')} <Tooltip text={TOOLTIPS.maxSpreadPercent} /></label>
          <NumberInput
            value={config.orderConfig.maxSpreadPercent}
            onChange={(value) => updateOrderConfig({ maxSpreadPercent: value })}
            min={0}
            max={100}
            step={0.1}
          />
        </div>
        <div className="form-field">
          <label className="label-with-tooltip">{t('strategy.max_open_orders')} <Tooltip text={TOOLTIPS.maxOpenOrders} position="right" /></label>
          <NumberInput
            value={config.orderManagement.maxOpenOrders}
            onChange={(value) => updateOrderManagement({ maxOpenOrders: value })}
            min={1}
            max={50}
            isInteger
          />
        </div>
      </div>

      <div className="form-divider" />

      {/* Position Sizing */}
      <div className="form-section-label">{t('strategy.position_sizing')}</div>
      <div className="form-row">
        <div className="form-field">
          <label className="label-with-tooltip">{t('strategy.size_mode')} <Tooltip text={TOOLTIPS.sizeMode} position="left" /></label>
          <div className="btn-group">
            <button type="button" className={`btn-toggle ${config.positionSizing.sizeMode === 'percentageOfBalance' ? 'active' : ''}`} onClick={() => updatePositionSizing({ sizeMode: 'percentageOfBalance' })}>{t('strategy.percent_balance')}</button>
            <button type="button" className={`btn-toggle ${config.positionSizing.sizeMode === 'fixedUsd' ? 'active' : ''}`} onClick={() => updatePositionSizing({ sizeMode: 'fixedUsd' })}>{t('strategy.fixed_usd')}</button>
          </div>
        </div>
        {config.positionSizing.sizeMode === 'percentageOfBalance' ? (
          <>
            <div className="form-field">
              <label className="label-with-tooltip">{markets.find(m => m.market_id === selectedMarket)?.base.symbol || t('strategy.base')} {t('strategy.balance_percent')} <Tooltip text={TOOLTIPS.baseBalancePercent} /></label>
              <NumberInput
                value={config.positionSizing.baseBalancePercentage ?? config.positionSizing.balancePercentage}
                onChange={(value) => updatePositionSizing({ baseBalancePercentage: value })}
                min={0}
                max={100}
                step={1}
              />
            </div>
            <div className="form-field">
              <label className="label-with-tooltip">{markets.find(m => m.market_id === selectedMarket)?.quote.symbol || t('strategy.quote')} {t('strategy.balance_percent')} <Tooltip text={TOOLTIPS.quoteBalancePercent} position="right" /></label>
              <NumberInput
                value={config.positionSizing.quoteBalancePercentage ?? config.positionSizing.balancePercentage}
                onChange={(value) => updatePositionSizing({ quoteBalancePercentage: value })}
                min={0}
                max={100}
                step={1}
              />
            </div>
          </>
        ) : (
          <div className="form-field flex-2">
            <label className="label-with-tooltip">{t('strategy.fixed_amount_usd')} <Tooltip text={TOOLTIPS.fixedUsdAmount} /></label>
            <NumberInput
              value={config.positionSizing.fixedUsdAmount || 0}
              onChange={(value) => updatePositionSizing({ fixedUsdAmount: value })}
              min={0}
              step={0.01}
            />
          </div>
        )}
      </div>

      <div className="form-row">
        <div className="form-field">
          <label className="label-with-tooltip">{t('strategy.min_order_usd')} <Tooltip text={TOOLTIPS.minOrderSizeUsd} position="left" /></label>
          <NumberInput
            value={config.positionSizing.minOrderSizeUsd}
            onChange={(value) => updatePositionSizing({ minOrderSizeUsd: value })}
            min={0}
            step={0.01}
          />
        </div>
        <div className="form-field">
          <label className="label-with-tooltip">{t('strategy.max_order_usd')} <Tooltip text={TOOLTIPS.maxOrderSizeUsd} /></label>
          <input type="number" min="0" step="0.01" value={config.positionSizing.maxOrderSizeUsd || ''} placeholder={t('strategy.no_limit')} onChange={(e) => updatePositionSizing({ maxOrderSizeUsd: e.target.value ? parseFloat(e.target.value) : undefined })} />
        </div>
        <div className="form-field">
          <label className="label-with-tooltip">{t('strategy.cycle_interval')} <Tooltip text={TOOLTIPS.cycleInterval} position="right" /></label>
          <div className="inline-inputs">
            <NumberInput
              value={config.timing.cycleIntervalMinMs}
              onChange={(value) => updateTiming({ cycleIntervalMinMs: value })}
              min={100}
              step={100}
              isInteger
            />
            <span className="separator">-</span>
            <NumberInput
              value={config.timing.cycleIntervalMaxMs}
              onChange={(value) => updateTiming({ cycleIntervalMaxMs: value })}
              min={100}
              step={100}
              isInteger
            />
          </div>
        </div>
      </div>

      <div className="form-divider" />

      {/* Profit & Risk Settings */}
      <div className="form-section-label">{t('strategy.profit_risk')}</div>
      <div className="form-row checkboxes">
        <label className="checkbox-inline">
          <input type="checkbox" checked={config.orderManagement.onlySellAboveBuyPrice} onChange={(e) => updateOrderManagement({ onlySellAboveBuyPrice: e.target.checked })} />
          <span className="label-with-tooltip">{t('strategy.sell_above_buy')} <Tooltip text={TOOLTIPS.onlySellAboveBuyPrice} position="left" /></span>
        </label>
        <div className="form-field compact">
          <label className="label-with-tooltip">{t('strategy.take_profit')} <Tooltip text={TOOLTIPS.takeProfitPercent} /></label>
          <NumberInput
            value={config.riskManagement?.takeProfitPercent ?? 0.02}
            onChange={(value) => updateRiskManagement({ takeProfitPercent: value })}
            min={0}
            step={0.01}
            disabled={!config.orderManagement.onlySellAboveBuyPrice}
          />
        </div>
      </div>

      <div className="form-row checkboxes">
        <label className="checkbox-inline">
          <input type="checkbox" checked={config.riskManagement?.stopLossEnabled ?? false} onChange={(e) => updateRiskManagement({ stopLossEnabled: e.target.checked })} />
          <span className="label-with-tooltip">{t('strategy.stop_loss')} <Tooltip text={TOOLTIPS.stopLoss} position="left" /></span>
        </label>
        {config.riskManagement?.stopLossEnabled && (
          <div className="form-field compact">
            <NumberInput
              value={config.riskManagement?.stopLossPercent ?? 5}
              onChange={(value) => updateRiskManagement({ stopLossPercent: value })}
              min={0.1}
              max={100}
              step={0.1}
            />
            <span className="suffix">%</span>
          </div>
        )}
        <label className="checkbox-inline">
          <input type="checkbox" checked={config.riskManagement?.orderTimeoutEnabled ?? false} onChange={(e) => updateRiskManagement({ orderTimeoutEnabled: e.target.checked })} />
          <span className="label-with-tooltip">{t('strategy.order_timeout')} <Tooltip text={TOOLTIPS.orderTimeout} /></span>
        </label>
        {config.riskManagement?.orderTimeoutEnabled && (
          <div className="form-field compact">
            <NumberInput
              value={config.riskManagement?.orderTimeoutMinutes ?? 30}
              onChange={(value) => updateRiskManagement({ orderTimeoutMinutes: value })}
              min={1}
              max={1440}
              step={1}
              isInteger
            />
            <span className="suffix">{t('strategy.min')}</span>
          </div>
        )}
      </div>

      <div className="form-row checkboxes">
        <label className="checkbox-inline">
          <input type="checkbox" checked={config.riskManagement?.maxSessionLossEnabled ?? false} onChange={(e) => updateRiskManagement({ maxSessionLossEnabled: e.target.checked })} />
          <span className="label-with-tooltip">{t('strategy.max_session_loss')} <Tooltip text={TOOLTIPS.maxSessionLoss} position="left" /></span>
        </label>
        {config.riskManagement?.maxSessionLossEnabled && (
          <div className="form-field compact">
            <span className="prefix">$</span>
            <NumberInput
              value={config.riskManagement?.maxSessionLossUsd ?? 100}
              onChange={(value) => updateRiskManagement({ maxSessionLossUsd: value })}
              min={0}
              step={1}
            />
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="form-actions compact">
        <button type="button" onClick={onReset} className="btn btn-text">{t('strategy.reset')}</button>
        <div className="form-actions-right">
          <button type="button" onClick={onCancel} className="btn btn-secondary">{t('common.cancel')}</button>
          <button type="button" onClick={onSave} className="btn btn-primary">{t('strategy.save')}</button>
        </div>
      </div>
    </div>
  )
}
