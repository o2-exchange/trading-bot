import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import mascotImage from '../assets/mascot.png'
import './WelcomeModal.css'

interface WelcomeModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function WelcomeModal({ isOpen, onClose }: WelcomeModalProps) {
  const { t } = useTranslation()
  const [currentSection, setCurrentSection] = useState(0)

  if (!isOpen) return null

  const sections = [
    { id: 'welcome', label: t('welcome.welcome_tab') },
    { id: 'dashboard', label: t('welcome.dashboard_tab') },
    { id: 'strategy', label: t('welcome.strategy_tab') },
    { id: 'console', label: t('welcome.console_tab') },
    { id: 'start', label: t('welcome.start_tab') },
  ]

  const handleNext = () => {
    if (currentSection < sections.length - 1) {
      setCurrentSection(currentSection + 1)
    } else {
      onClose()
    }
  }

  const handlePrev = () => {
    if (currentSection > 0) {
      setCurrentSection(currentSection - 1)
    }
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="welcome-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="welcome-header">
          <h2>{t('welcome.title')}</h2>
          <div className="welcome-nav-tabs">
            {sections.map((section, i) => (
              <button
                key={section.id}
                className={`nav-tab ${i === currentSection ? 'active' : ''}`}
                onClick={() => setCurrentSection(i)}
              >
                {section.label}
              </button>
            ))}
          </div>
        </div>

        <div className="welcome-body">
          {currentSection === 0 && <WelcomeSlide t={t} />}
          {currentSection === 1 && <DashboardSlide t={t} />}
          {currentSection === 2 && <StrategySlide t={t} />}
          {currentSection === 3 && <ConsoleSlide t={t} />}
          {currentSection === 4 && <StartSlide t={t} />}
        </div>

        <div className="welcome-footer">
          <button className="btn-skip" onClick={onClose}>
            {t('common.skip')}
          </button>
          <div className="footer-nav">
            {currentSection > 0 && (
              <button className="btn-secondary" onClick={handlePrev}>
                {t('common.back')}
              </button>
            )}
            <button className="btn-primary" onClick={handleNext}>
              {currentSection === sections.length - 1 ? t('welcome.get_started') : t('common.next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function WelcomeSlide({ t }: { t: (key: string) => string }) {
  return (
    <div className="slide welcome-slide">
      <div className="welcome-hero">
        <img src={mascotImage} alt="o2 Trading Bot" className="welcome-mascot" />
        <div className="welcome-hero-text">
          <h3 className="slide-title">{t('welcome.welcome_title')}</h3>
          <p className="slide-subtitle">{t('welcome.welcome_subtitle')}</p>
          <div className="warning-box-inline">
            {t('welcome.warning_alpha')}
          </div>
        </div>
      </div>

      {/* Dashboard preview */}
      <div className="mockup-dashboard">
        <div className="mockup-column">
          <div className="mockup-section">
            <div className="mockup-section-header">{t('welcome.trading_controls')}</div>
            <span className="mock-btn mock-btn-success">{t('trading.start_trading')}</span>
          </div>
          <div className="mockup-section">
            <div className="mockup-section-header">{t('welcome.trade_console')}</div>
            <div style={{ fontSize: '9px', color: 'var(--muted-foreground)' }}>Live execution log...</div>
          </div>
        </div>
        <div className="mockup-column">
          <div className="mockup-section">
            <div className="mockup-section-header">{t('welcome.balances_panel')}</div>
            <div style={{ fontSize: '9px', color: 'var(--muted-foreground)' }}>ETH, USDC, ...</div>
          </div>
          <div className="mockup-section">
            <div className="mockup-section-header">{t('welcome.strategy_config')}</div>
            <div style={{ fontSize: '9px', color: 'var(--muted-foreground)' }}>Your strategies...</div>
          </div>
        </div>
      </div>

      <p style={{ fontSize: '12px', color: 'var(--muted-foreground)', margin: 0, textAlign: 'center' }}>
        {t('welcome.dashboard_organized')}
      </p>
    </div>
  )
}

function DashboardSlide({ t }: { t: (key: string) => string }) {
  return (
    <div className="slide">
      <h3 className="slide-title">{t('welcome.dashboard_layout_title')}</h3>
      <p className="slide-subtitle">{t('welcome.dashboard_layout_subtitle')}</p>

      {/* Full dashboard mockup with callouts */}
      <div style={{ marginBottom: '16px' }}>
        {/* Mock header */}
        <div className="mock-header">
          <span className="mock-header-title">o2 Trading Bot <span className="mock-badge mock-badge-inactive" style={{ marginLeft: '6px' }}>Alpha</span></span>
          <div className="mock-header-actions">
            <span className="mock-btn mock-btn-secondary" style={{ padding: '2px 6px' }}>?</span>
            <span className="mock-wallet-chip">
              <span className="mock-wallet-dot"></span>
              0x1234...5678
            </span>
            <span className="mock-btn mock-btn-secondary">Disconnect</span>
          </div>
        </div>

        {/* Mock tabs */}
        <div className="mock-tabs">
          <span className="mock-tab active">Dashboard</span>
          <span className="mock-tab">Orders</span>
          <span className="mock-tab">Trades</span>
        </div>

        {/* Dashboard grid */}
        <div className="mockup-dashboard" style={{ marginBottom: 0 }}>
          <div className="mockup-column">
            <div className="mockup-section">
              <div className="mockup-section-header">
                <span className="callout">1</span> Trading Controls
              </div>
              <span className="mock-btn mock-btn-success">Start Trading</span>
            </div>
            <div className="mockup-section">
              <div className="mockup-section-header">
                <span className="callout">2</span> Trade Console
              </div>
              <div className="mock-console" style={{ padding: '4px 6px' }}>
                <div className="mock-console-line success">
                  <span className="time">14:32</span>
                  <span className="msg">BUY 0.5 ETH</span>
                </div>
              </div>
            </div>
            <div className="mockup-section">
              <div className="mockup-section-header">
                <span className="callout">3</span> Markets
              </div>
              <div style={{ display: 'flex', gap: '4px' }}>
                <span className="mock-market-card">ETH/USDC</span>
                <span className="mock-market-card">BTC/USDC</span>
              </div>
            </div>
          </div>
          <div className="mockup-column">
            <div className="mockup-section">
              <div className="mockup-section-header">
                <span className="callout">4</span> Balances
              </div>
              <div className="mock-table">
                <div className="mock-table-header">
                  <span className="mock-table-cell">Asset</span>
                  <span className="mock-table-cell">Available</span>
                </div>
                <div className="mock-table-row">
                  <span className="mock-table-cell">ETH</span>
                  <span className="mock-table-cell">1.5</span>
                </div>
                <div className="mock-table-row">
                  <span className="mock-table-cell">USDC</span>
                  <span className="mock-table-cell">5,000</span>
                </div>
              </div>
            </div>
            <div className="mockup-section">
              <div className="mockup-section-header">
                <span className="callout">5</span> Strategy Config
              </div>
              <div className="mock-strategy-card">
                <div className="mock-strategy-header">
                  <span className="mock-strategy-pair">ETH/USDC</span>
                  <span className="mock-badge mock-badge-active">Active</span>
                </div>
                <div className="mock-strategy-actions">
                  <span className="mock-btn mock-btn-secondary">Edit</span>
                  <span className="mock-btn mock-btn-secondary">Delete</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Callout explanations */}
      <div className="callout-list">
        <div className="callout-item">
          <span className="callout">1</span>
          <div><strong>{t('welcome.trading_controls')}</strong><p>{t('welcome.trading_controls_desc')}</p></div>
        </div>
        <div className="callout-item">
          <span className="callout">2</span>
          <div><strong>{t('welcome.trade_console')}</strong><p>{t('welcome.trade_console_desc')}</p></div>
        </div>
        <div className="callout-item">
          <span className="callout">3</span>
          <div><strong>{t('welcome.available_markets')}</strong><p>{t('welcome.available_markets_desc')}</p></div>
        </div>
        <div className="callout-item">
          <span className="callout">4</span>
          <div><strong>{t('welcome.balances_panel')}</strong><p>{t('welcome.balances_panel_desc')}</p></div>
        </div>
        <div className="callout-item">
          <span className="callout">5</span>
          <div><strong>{t('welcome.strategy_config')}</strong><p>{t('welcome.strategy_config_desc')}</p></div>
        </div>
      </div>
    </div>
  )
}

function StrategySlide({ t }: { t: (key: string) => string }) {
  return (
    <div className="slide">
      <h3 className="slide-title">{t('welcome.strategy_title')}</h3>
      <p className="slide-subtitle">{t('welcome.strategy_subtitle')}</p>

      {/* Strategy form mockup */}
      <div className="mockup-form">
        <div className="mockup-form-header">
          <span>Create New Strategy</span>
          <span style={{ color: 'var(--muted-foreground)' }}>×</span>
        </div>
        <div className="mockup-form-body">
          {/* Row 1: Market & Name */}
          <div className="mockup-form-row">
            <div className="mockup-form-group">
              <span className="mockup-form-label"><span className="callout" style={{ marginRight: '4px' }}>1</span> Market</span>
              <span className="mock-select" style={{ width: '100%' }}>ETH/USDC</span>
            </div>
            <div className="mockup-form-group">
              <span className="mockup-form-label">Name</span>
              <span className="mock-input" style={{ width: '100%' }}>My Strategy</span>
            </div>
          </div>

          <div className="mockup-form-divider"></div>

          {/* Row 2: Order settings */}
          <div className="mockup-form-row">
            <div className="mockup-form-group">
              <span className="mockup-form-label"><span className="callout" style={{ marginRight: '4px' }}>2</span> Order Type</span>
              <div className="mock-toggle-group">
                <span className="mock-toggle active">Market</span>
                <span className="mock-toggle">Spot</span>
              </div>
            </div>
            <div className="mockup-form-group">
              <span className="mockup-form-label">Price Mode</span>
              <span className="mock-select">Mid Price</span>
            </div>
            <div className="mockup-form-group">
              <span className="mockup-form-label"><span className="callout" style={{ marginRight: '4px' }}>3</span> Side</span>
              <div className="mock-toggle-group">
                <span className="mock-toggle">Buy</span>
                <span className="mock-toggle">Sell</span>
                <span className="mock-toggle active">Both</span>
              </div>
            </div>
          </div>

          <div className="mockup-form-divider"></div>

          {/* Row 3: Position sizing */}
          <div className="mockup-form-section-title"><span className="callout" style={{ marginRight: '4px' }}>4</span> Position Sizing</div>
          <div className="mockup-form-row">
            <div className="mockup-form-group">
              <div className="mock-toggle-group">
                <span className="mock-toggle active">% Balance</span>
                <span className="mock-toggle">Fixed USD</span>
              </div>
            </div>
            <div className="mockup-form-group">
              <span className="mockup-form-label">Base %</span>
              <span className="mock-input">50</span>
            </div>
            <div className="mockup-form-group">
              <span className="mockup-form-label">Quote %</span>
              <span className="mock-input">50</span>
            </div>
          </div>

          <div className="mockup-form-divider"></div>

          {/* Row 4: Risk */}
          <div className="mockup-form-section-title"><span className="callout" style={{ marginRight: '4px' }}>5</span> Risk Management</div>
          <div className="mockup-form-row">
            <span className="mock-checkbox">Take Profit</span>
            <span className="mock-checkbox">Stop Loss</span>
            <span className="mock-checkbox">Max Daily Loss</span>
          </div>
        </div>
        <div className="mockup-form-footer">
          <span className="mock-btn mock-btn-secondary">Cancel</span>
          <span className="mock-btn mock-btn-primary">Save</span>
        </div>
      </div>

      {/* Callout explanations */}
      <div className="callout-list">
        <div className="callout-item">
          <span className="callout">1</span>
          <div><strong>{t('strategy.market')}</strong><p>{t('welcome.market_callout')}</p></div>
        </div>
        <div className="callout-item">
          <span className="callout">2</span>
          <div><strong>{t('strategy.order_type')}</strong><p>{t('welcome.order_type_callout')}</p></div>
        </div>
        <div className="callout-item">
          <span className="callout">3</span>
          <div><strong>{t('strategy.side')}</strong><p>{t('welcome.side_callout')}</p></div>
        </div>
        <div className="callout-item">
          <span className="callout">4</span>
          <div><strong>{t('strategy.position_sizing')}</strong><p>{t('welcome.position_sizing_callout')}</p></div>
        </div>
        <div className="callout-item">
          <span className="callout">5</span>
          <div><strong>{t('strategy.profit_risk')}</strong><p>{t('welcome.risk_management_callout')}</p></div>
        </div>
      </div>
    </div>
  )
}

function ConsoleSlide({ t }: { t: (key: string) => string }) {
  return (
    <div className="slide">
      <h3 className="slide-title">{t('welcome.console_title')}</h3>
      <p className="slide-subtitle">{t('welcome.console_subtitle')}</p>

      {/* Console mockup */}
      <div className="mock-console" style={{ marginBottom: '16px', padding: '10px 12px' }}>
        <div className="mock-console-header">
          <span>Trade Execution Console</span>
          <span className="mock-console-status">ACTIVE</span>
        </div>

        {/* Stats dashboard */}
        <div className="mock-console-stats">
          <div className="mock-stat">
            <span className="mock-stat-label"><span className="callout" style={{ marginRight: '3px', width: '14px', height: '14px', fontSize: '8px' }}>1</span> Market</span>
            <span className="mock-stat-value">ETH/USDC</span>
          </div>
          <div className="mock-stat">
            <span className="mock-stat-label">Price</span>
            <span className="mock-stat-value">$3,245.50</span>
          </div>
          <div className="mock-stat">
            <span className="mock-stat-label"><span className="callout" style={{ marginRight: '3px', width: '14px', height: '14px', fontSize: '8px' }}>2</span> P&L</span>
            <span className="mock-stat-value positive">+$12.50</span>
          </div>
          <div className="mock-stat">
            <span className="mock-stat-label">Fees</span>
            <span className="mock-stat-value">$0.85</span>
          </div>
          <div className="mock-stat">
            <span className="mock-stat-label"><span className="callout" style={{ marginRight: '3px', width: '14px', height: '14px', fontSize: '8px' }}>3</span> Trades</span>
            <span className="mock-stat-value">5</span>
          </div>
        </div>

        {/* Log messages */}
        <div style={{ marginTop: '8px' }}>
          <div className="mock-console-line success">
            <span className="time">14:32:05</span>
            <span className="msg">✓ BUY 0.5 ETH @ $3,245.50</span>
          </div>
          <div className="mock-console-line info">
            <span className="time">14:32:10</span>
            <span className="msg">◐ Waiting for fill...</span>
          </div>
          <div className="mock-console-line success">
            <span className="time">14:33:22</span>
            <span className="msg">✓ SELL 0.5 ETH @ $3,267.80</span>
          </div>
        </div>
      </div>

      {/* Callout explanations */}
      <div className="callout-list">
        <div className="callout-item">
          <span className="callout">1</span>
          <div><strong>{t('console.market_label')} {t('console.price_label')}</strong><p>{t('welcome.market_price_callout')}</p></div>
        </div>
        <div className="callout-item">
          <span className="callout">2</span>
          <div><strong>{t('console.pnl')}</strong><p>{t('welcome.pnl_tracking_callout')}</p></div>
        </div>
        <div className="callout-item">
          <span className="callout">3</span>
          <div><strong>{t('console.trades')}</strong><p>{t('welcome.trade_count_callout')}</p></div>
        </div>
      </div>

      <div className="tip-box" style={{ marginTop: '12px' }}>
        <strong>Tip:</strong> {t('welcome.console_tip')}
      </div>
    </div>
  )
}

function StartSlide({ t }: { t: (key: string) => string }) {
  return (
    <div className="slide">
      <h3 className="slide-title">{t('welcome.quick_start_title')}</h3>
      <p className="slide-subtitle">{t('welcome.quick_start_subtitle')}</p>

      <div className="quick-start-steps">
        <div className="quick-start-step">
          <span className="step-number">1</span>
          <div className="step-content">
            <strong>{t('welcome.step1_title')}</strong>
            <p>{t('welcome.step1_desc')}</p>
            <div className="step-visual">
              <span className="mock-btn mock-btn-primary" style={{ fontSize: '10px' }}>{t('dashboard.deposit_funds')}</span>
            </div>
          </div>
        </div>

        <div className="quick-start-step">
          <span className="step-number">2</span>
          <div className="step-content">
            <strong>{t('welcome.step2_title')}</strong>
            <p>{t('welcome.step2_desc')}</p>
            <div className="step-visual">
              <span className="mock-btn mock-btn-primary" style={{ fontSize: '10px' }}>{t('strategy.create_new')}</span>
            </div>
          </div>
        </div>

        <div className="quick-start-step">
          <span className="step-number">3</span>
          <div className="step-content">
            <strong>{t('welcome.step3_title')}</strong>
            <p>{t('welcome.step3_desc')}</p>
          </div>
        </div>

        <div className="quick-start-step">
          <span className="step-number">4</span>
          <div className="step-content">
            <strong>{t('welcome.step4_title')}</strong>
            <p>{t('welcome.step4_desc')}</p>
            <div className="step-visual">
              <span className="mock-badge mock-badge-active">{t('strategy.active')}</span>
            </div>
          </div>
        </div>

        <div className="quick-start-step">
          <span className="step-number">5</span>
          <div className="step-content">
            <strong>{t('welcome.step5_title')}</strong>
            <p>{t('welcome.step5_desc')}</p>
            <div className="step-visual">
              <span className="mock-btn mock-btn-success" style={{ fontSize: '10px' }}>{t('trading.start_trading')}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="tip-box">
        <strong>Tip:</strong> {t('welcome.tip_start_small')}
      </div>
    </div>
  )
}
