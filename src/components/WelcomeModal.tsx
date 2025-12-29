import { useState } from 'react'
import mascotImage from '../assets/mascot.png'
import './WelcomeModal.css'

interface WelcomeModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function WelcomeModal({ isOpen, onClose }: WelcomeModalProps) {
  const [currentSection, setCurrentSection] = useState(0)

  if (!isOpen) return null

  const sections = [
    { id: 'welcome', label: 'Welcome' },
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'strategy', label: 'Strategy' },
    { id: 'console', label: 'Console' },
    { id: 'start', label: 'Start' },
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
          <h2>o2 Trading Bot</h2>
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
          {currentSection === 0 && <WelcomeSlide />}
          {currentSection === 1 && <DashboardSlide />}
          {currentSection === 2 && <StrategySlide />}
          {currentSection === 3 && <ConsoleSlide />}
          {currentSection === 4 && <StartSlide />}
        </div>

        <div className="welcome-footer">
          <button className="btn-skip" onClick={onClose}>
            Skip
          </button>
          <div className="footer-nav">
            {currentSection > 0 && (
              <button className="btn-secondary" onClick={handlePrev}>
                Back
              </button>
            )}
            <button className="btn-primary" onClick={handleNext}>
              {currentSection === sections.length - 1 ? 'Get Started' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function WelcomeSlide() {
  return (
    <div className="slide welcome-slide">
      <div className="welcome-hero">
        <img src={mascotImage} alt="o2 Trading Bot" className="welcome-mascot" />
        <div className="welcome-hero-text">
          <h3 className="slide-title">Welcome to o2 Trading Bot</h3>
          <p className="slide-subtitle">Your automated trading companion for the o2 exchange</p>
          <div className="warning-box-inline">
            This is an experimental alpha release. Only trade with funds you can afford to lose
          </div>
        </div>
      </div>

      {/* Dashboard preview */}
      <div className="mockup-dashboard">
        <div className="mockup-column">
          <div className="mockup-section">
            <div className="mockup-section-header">Trading Controls</div>
            <span className="mock-btn mock-btn-success">Start Trading</span>
          </div>
          <div className="mockup-section">
            <div className="mockup-section-header">Trade Console</div>
            <div style={{ fontSize: '9px', color: 'var(--muted-foreground)' }}>Live execution log...</div>
          </div>
        </div>
        <div className="mockup-column">
          <div className="mockup-section">
            <div className="mockup-section-header">Balances</div>
            <div style={{ fontSize: '9px', color: 'var(--muted-foreground)' }}>ETH, USDC, ...</div>
          </div>
          <div className="mockup-section">
            <div className="mockup-section-header">Strategy Config</div>
            <div style={{ fontSize: '9px', color: 'var(--muted-foreground)' }}>Your strategies...</div>
          </div>
        </div>
      </div>

      <p style={{ fontSize: '12px', color: 'var(--muted-foreground)', margin: 0, textAlign: 'center' }}>
        The dashboard is organized into panels for controls, monitoring, balances, and strategy management.
      </p>
    </div>
  )
}

function DashboardSlide() {
  return (
    <div className="slide">
      <h3 className="slide-title">Dashboard Layout</h3>
      <p className="slide-subtitle">Understanding your trading command center</p>

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
          <div><strong>Trading Controls</strong><p>Start, stop, or resume your automated trading session</p></div>
        </div>
        <div className="callout-item">
          <span className="callout">2</span>
          <div><strong>Trade Console</strong><p>Live feed of all trading activity with P&L tracking</p></div>
        </div>
        <div className="callout-item">
          <span className="callout">3</span>
          <div><strong>Available Markets</strong><p>Browse and select markets to trade</p></div>
        </div>
        <div className="callout-item">
          <span className="callout">4</span>
          <div><strong>Balances</strong><p>View your available and locked funds</p></div>
        </div>
        <div className="callout-item">
          <span className="callout">5</span>
          <div><strong>Strategy Configuration</strong><p>Create and manage your trading strategies</p></div>
        </div>
      </div>
    </div>
  )
}

function StrategySlide() {
  return (
    <div className="slide">
      <h3 className="slide-title">Strategy Configuration</h3>
      <p className="slide-subtitle">How to set up your trading strategy</p>

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
          <div><strong>Market</strong><p>Select which trading pair to use for this strategy</p></div>
        </div>
        <div className="callout-item">
          <span className="callout">2</span>
          <div><strong>Order Type</strong><p>Market for instant execution, Spot for limit orders</p></div>
        </div>
        <div className="callout-item">
          <span className="callout">3</span>
          <div><strong>Side</strong><p>Buy only, Sell only, or Both directions</p></div>
        </div>
        <div className="callout-item">
          <span className="callout">4</span>
          <div><strong>Position Sizing</strong><p>Use % of balance or fixed USD amounts per trade</p></div>
        </div>
        <div className="callout-item">
          <span className="callout">5</span>
          <div><strong>Risk Management</strong><p>Take profit, stop loss, and daily loss limits</p></div>
        </div>
      </div>
    </div>
  )
}

function ConsoleSlide() {
  return (
    <div className="slide">
      <h3 className="slide-title">Trade Console & Monitoring</h3>
      <p className="slide-subtitle">Track your trades in real-time</p>

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
          <div><strong>Market & Price</strong><p>Current market and live price from the exchange</p></div>
        </div>
        <div className="callout-item">
          <span className="callout">2</span>
          <div><strong>P&L Tracking</strong><p>Realized profit/loss and fees for the session</p></div>
        </div>
        <div className="callout-item">
          <span className="callout">3</span>
          <div><strong>Trade Count</strong><p>Number of executed trades in current session</p></div>
        </div>
      </div>

      <div className="tip-box" style={{ marginTop: '12px' }}>
        <strong>Tip:</strong> The console shows color-coded messages — green for successful trades, blue for pending orders, red for errors.
      </div>
    </div>
  )
}

function StartSlide() {
  return (
    <div className="slide">
      <h3 className="slide-title">Quick Start</h3>
      <p className="slide-subtitle">Get trading in 5 steps</p>

      <div className="quick-start-steps">
        <div className="quick-start-step">
          <span className="step-number">1</span>
          <div className="step-content">
            <strong>Check Your Balances</strong>
            <p>Review available funds in the Balances panel. Deposit on o2.app if needed.</p>
            <div className="step-visual">
              <span className="mock-btn mock-btn-primary" style={{ fontSize: '10px' }}>Deposit Funds on o2.app →</span>
            </div>
          </div>
        </div>

        <div className="quick-start-step">
          <span className="step-number">2</span>
          <div className="step-content">
            <strong>Create a Strategy</strong>
            <p>Click the button below and configure your trading parameters.</p>
            <div className="step-visual">
              <span className="mock-btn mock-btn-primary" style={{ fontSize: '10px' }}>Create New Strategy</span>
            </div>
          </div>
        </div>

        <div className="quick-start-step">
          <span className="step-number">3</span>
          <div className="step-content">
            <strong>Configure Risk Settings</strong>
            <p>Set stop loss, take profit, and position limits based on your risk tolerance.</p>
          </div>
        </div>

        <div className="quick-start-step">
          <span className="step-number">4</span>
          <div className="step-content">
            <strong>Activate Your Strategy</strong>
            <p>Toggle your strategy to Active status.</p>
            <div className="step-visual">
              <span className="mock-badge mock-badge-active">Active</span>
            </div>
          </div>
        </div>

        <div className="quick-start-step">
          <span className="step-number">5</span>
          <div className="step-content">
            <strong>Start Trading</strong>
            <p>Click the Start button and watch your strategy execute.</p>
            <div className="step-visual">
              <span className="mock-btn mock-btn-success" style={{ fontSize: '10px' }}>Start Trading</span>
            </div>
          </div>
        </div>
      </div>

      <div className="tip-box">
        <strong>Tip:</strong> Start with small position sizes while learning how the bot behaves with your strategy configuration.
      </div>
    </div>
  )
}
