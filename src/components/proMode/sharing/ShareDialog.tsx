/**
 * Share Dialog Component
 * Export strategies via file download or share code
 */

import { useState } from 'react';
import { CustomStrategy, ExportOptions, DEFAULT_EXPORT_OPTIONS } from '../../../types/proMode';
import { importExportService } from '../../../services/proMode/importExportService';

interface ShareDialogProps {
  strategy: CustomStrategy;
  onClose: () => void;
}

export default function ShareDialog({ strategy, onClose }: ShareDialogProps) {
  const [exportOptions, setExportOptions] = useState<ExportOptions>(DEFAULT_EXPORT_OPTIONS);
  const [shareCode, setShareCode] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExportToFile = async () => {
    setIsExporting(true);
    setError(null);
    try {
      await importExportService.exportToFile(strategy.id, exportOptions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export');
    } finally {
      setIsExporting(false);
    }
  };

  const handleGenerateShareCode = async () => {
    setIsExporting(true);
    setError(null);
    try {
      const code = await importExportService.exportToShareCode(strategy.id, exportOptions);
      if (code) {
        setShareCode(code);
      } else {
        setError('Failed to generate share code');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate share code');
    } finally {
      setIsExporting(false);
    }
  };

  const handleCopyToClipboard = async () => {
    if (!shareCode) return;

    try {
      await navigator.clipboard.writeText(shareCode);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      setError('Failed to copy to clipboard');
    }
  };

  const handleCopyStrategyDirectly = async () => {
    setIsExporting(true);
    setError(null);
    try {
      const success = await importExportService.copyToClipboard(strategy.id);
      if (success) {
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      } else {
        setError('Failed to copy to clipboard');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to copy');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-content share-dialog" onClick={e => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>Share Strategy</h2>
          <button className="dialog-close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="dialog-body">
          <p className="dialog-subtitle">
            Export <strong>{strategy.name}</strong> to share with others
          </p>

          {/* Export Options */}
          <div className="export-options">
            <h3>Export Options</h3>
            <label className="checkbox-option">
              <input
                type="checkbox"
                checked={exportOptions.includeConfigValues}
                onChange={e => setExportOptions({
                  ...exportOptions,
                  includeConfigValues: e.target.checked
                })}
              />
              <span>Include parameter values</span>
            </label>
            <label className="checkbox-option">
              <input
                type="checkbox"
                checked={exportOptions.includeCustomIndicators}
                onChange={e => setExportOptions({
                  ...exportOptions,
                  includeCustomIndicators: e.target.checked
                })}
              />
              <span>Include custom indicators</span>
            </label>
            <label className="checkbox-option">
              <input
                type="checkbox"
                checked={exportOptions.minifyCode}
                onChange={e => setExportOptions({
                  ...exportOptions,
                  minifyCode: e.target.checked
                })}
              />
              <span>Minify code (remove comments)</span>
            </label>
          </div>

          {/* Error Display */}
          {error && (
            <div className="dialog-error">
              {error}
            </div>
          )}

          {/* Share Code Display */}
          {shareCode && (
            <div className="share-code-section">
              <h3>Share Code</h3>
              <div className="share-code-container">
                <textarea
                  readOnly
                  value={shareCode}
                  className="share-code-textarea"
                />
                <button
                  className="copy-code-btn"
                  onClick={handleCopyToClipboard}
                >
                  {copySuccess ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p className="share-code-hint">
                Share this code with others. They can import it using the Import dialog.
              </p>
            </div>
          )}

          {/* Export Actions */}
          <div className="export-actions">
            <button
              className="export-btn"
              onClick={handleExportToFile}
              disabled={isExporting}
            >
              {isExporting ? 'Exporting...' : 'Download JSON File'}
            </button>

            <button
              className="export-btn"
              onClick={handleGenerateShareCode}
              disabled={isExporting}
            >
              {isExporting ? 'Generating...' : 'Generate Share Code'}
            </button>

            <button
              className="export-btn secondary"
              onClick={handleCopyStrategyDirectly}
              disabled={isExporting}
            >
              {copySuccess ? 'Copied!' : 'Copy to Clipboard'}
            </button>
          </div>
        </div>

        <div className="dialog-footer">
          <button className="dialog-btn secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
