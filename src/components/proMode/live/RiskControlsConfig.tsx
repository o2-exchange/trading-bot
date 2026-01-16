/**
 * Risk Controls Configuration Component
 * Configure risk limits for live trading
 */

import { RiskLimits, DEFAULT_RISK_LIMITS } from '../../../types/proMode';

interface RiskControlsConfigProps {
  limits: RiskLimits;
  onLimitsChange: (limits: RiskLimits) => void;
  disabled?: boolean;
}

export default function RiskControlsConfig({
  limits,
  onLimitsChange,
  disabled = false,
}: RiskControlsConfigProps) {
  const handleChange = (field: keyof RiskLimits, value: number) => {
    onLimitsChange({
      ...limits,
      [field]: value,
    });
  };

  const handleReset = () => {
    onLimitsChange({ ...DEFAULT_RISK_LIMITS });
  };

  return (
    <div className="config-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h3 style={{ margin: 0 }}>Risk Controls</h3>
        <button
          onClick={handleReset}
          disabled={disabled}
          style={{
            padding: '4px 10px',
            borderRadius: '4px',
            border: '1px solid var(--border)',
            background: 'transparent',
            cursor: disabled ? 'not-allowed' : 'pointer',
            fontSize: '11px',
            color: 'var(--muted-foreground)',
          }}
        >
          Reset to Defaults
        </button>
      </div>

      {/* Position Limits */}
      <div style={{ marginBottom: '12px' }}>
        <h4 style={{ fontSize: '12px', marginBottom: '8px', color: 'var(--muted-foreground)' }}>
          Position Limits
        </h4>
        <div className="config-row">
          <div className="config-field">
            <label>Max Position Size</label>
            <input
              type="number"
              value={limits.maxPositionSize}
              onChange={(e) => handleChange('maxPositionSize', Number(e.target.value))}
              min={0}
              disabled={disabled}
            />
          </div>

          <div className="config-field">
            <label>Max Position Value ($)</label>
            <input
              type="number"
              value={limits.maxPositionValue}
              onChange={(e) => handleChange('maxPositionValue', Number(e.target.value))}
              min={0}
              disabled={disabled}
            />
          </div>

          <div className="config-field">
            <label>Max Total Exposure ($)</label>
            <input
              type="number"
              value={limits.maxTotalExposure}
              onChange={(e) => handleChange('maxTotalExposure', Number(e.target.value))}
              min={0}
              disabled={disabled}
            />
          </div>

          <div className="config-field">
            <label>Max Exposure (%)</label>
            <input
              type="number"
              value={limits.maxTotalExposurePercent}
              onChange={(e) => handleChange('maxTotalExposurePercent', Number(e.target.value))}
              min={0}
              max={100}
              disabled={disabled}
            />
          </div>
        </div>
      </div>

      {/* Loss Limits */}
      <div style={{ marginBottom: '12px' }}>
        <h4 style={{ fontSize: '12px', marginBottom: '8px', color: 'var(--muted-foreground)' }}>
          Loss Limits
        </h4>
        <div className="config-row">
          <div className="config-field">
            <label>Max Daily Loss ($)</label>
            <input
              type="number"
              value={limits.maxDailyLoss}
              onChange={(e) => handleChange('maxDailyLoss', Number(e.target.value))}
              min={0}
              disabled={disabled}
            />
          </div>

          <div className="config-field">
            <label>Max Daily Loss (%)</label>
            <input
              type="number"
              value={limits.maxDailyLossPercent}
              onChange={(e) => handleChange('maxDailyLossPercent', Number(e.target.value))}
              min={0}
              max={100}
              disabled={disabled}
            />
          </div>

          <div className="config-field">
            <label>Max Total Loss ($)</label>
            <input
              type="number"
              value={limits.maxTotalLoss}
              onChange={(e) => handleChange('maxTotalLoss', Number(e.target.value))}
              min={0}
              disabled={disabled}
            />
          </div>

          <div className="config-field">
            <label>Max Total Loss (%)</label>
            <input
              type="number"
              value={limits.maxTotalLossPercent}
              onChange={(e) => handleChange('maxTotalLossPercent', Number(e.target.value))}
              min={0}
              max={100}
              disabled={disabled}
            />
          </div>
        </div>
      </div>

      {/* Drawdown & Order Limits */}
      <div style={{ marginBottom: '12px' }}>
        <h4 style={{ fontSize: '12px', marginBottom: '8px', color: 'var(--muted-foreground)' }}>
          Drawdown & Order Limits
        </h4>
        <div className="config-row">
          <div className="config-field">
            <label>Max Drawdown (%)</label>
            <input
              type="number"
              value={limits.maxDrawdownPercent}
              onChange={(e) => handleChange('maxDrawdownPercent', Number(e.target.value))}
              min={0}
              max={100}
              disabled={disabled}
            />
          </div>

          <div className="config-field">
            <label>Max Orders/Minute</label>
            <input
              type="number"
              value={limits.maxOrdersPerMinute}
              onChange={(e) => handleChange('maxOrdersPerMinute', Number(e.target.value))}
              min={1}
              disabled={disabled}
            />
          </div>

          <div className="config-field">
            <label>Max Order Value ($)</label>
            <input
              type="number"
              value={limits.maxOrderValue}
              onChange={(e) => handleChange('maxOrderValue', Number(e.target.value))}
              min={0}
              disabled={disabled}
            />
          </div>
        </div>
      </div>

      {/* Warning Box */}
      <div style={{
        padding: '8px 10px',
        borderRadius: '6px',
        background: 'rgba(234, 179, 8, 0.1)',
        border: '1px solid rgba(234, 179, 8, 0.3)',
        fontSize: '11px',
        color: '#eab308',
      }}>
        <strong>Important:</strong> Risk controls will automatically halt trading when limits are breached.
      </div>
    </div>
  );
}
