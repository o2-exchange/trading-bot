/**
 * Import Dialog Component
 * Import strategies from file or share code
 */

import { useState, useRef } from 'react';
import { ImportResult, ImportError, ImportWarning } from '../../../types/proMode';
import { importExportService } from '../../../services/proMode/importExportService';

interface ImportDialogProps {
  onClose: () => void;
  onImportSuccess: (strategyId: string) => void;
}

export default function ImportDialog({ onClose, onImportSuccess }: ImportDialogProps) {
  const [activeTab, setActiveTab] = useState<'file' | 'code' | 'clipboard'>('file');
  const [shareCode, setShareCode] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setResult(null);
    }
  };

  const handleImportFromFile = async () => {
    if (!selectedFile) return;

    setIsImporting(true);
    setResult(null);

    try {
      const importResult = await importExportService.importFromFile(selectedFile);
      setResult(importResult);

      if (importResult.success && importResult.strategyId) {
        setTimeout(() => {
          onImportSuccess(importResult.strategyId!);
        }, 1500);
      }
    } catch (err) {
      setResult({
        success: false,
        errors: [{ type: 'format', message: err instanceof Error ? err.message : 'Import failed' }],
        warnings: [],
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportFromCode = async () => {
    if (!shareCode.trim()) return;

    setIsImporting(true);
    setResult(null);

    try {
      const importResult = await importExportService.importFromShareCode(shareCode.trim());
      setResult(importResult);

      if (importResult.success && importResult.strategyId) {
        setTimeout(() => {
          onImportSuccess(importResult.strategyId!);
        }, 1500);
      }
    } catch (err) {
      setResult({
        success: false,
        errors: [{ type: 'format', message: err instanceof Error ? err.message : 'Import failed' }],
        warnings: [],
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportFromClipboard = async () => {
    setIsImporting(true);
    setResult(null);

    try {
      const importResult = await importExportService.importFromClipboard();
      setResult(importResult);

      if (importResult.success && importResult.strategyId) {
        setTimeout(() => {
          onImportSuccess(importResult.strategyId!);
        }, 1500);
      }
    } catch (err) {
      setResult({
        success: false,
        errors: [{ type: 'format', message: err instanceof Error ? err.message : 'Import failed' }],
        warnings: [],
      });
    } finally {
      setIsImporting(false);
    }
  };

  const renderErrors = (errors: ImportError[]) => (
    <div className="import-errors">
      {errors.map((error, i) => (
        <div key={i} className="import-error">
          <span className="error-icon">✗</span>
          <span className="error-type">{error.type}:</span>
          <span className="error-message">{error.message}</span>
        </div>
      ))}
    </div>
  );

  const renderWarnings = (warnings: ImportWarning[]) => (
    <div className="import-warnings">
      {warnings.map((warning, i) => (
        <div key={i} className="import-warning">
          <span className="warning-icon">⚠</span>
          <span className="warning-message">{warning.message}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-content import-dialog" onClick={e => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>Import Strategy</h2>
          <button className="dialog-close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="dialog-body">
          {/* Tab Selector */}
          <div className="import-tabs">
            <button
              className={`import-tab ${activeTab === 'file' ? 'active' : ''}`}
              onClick={() => setActiveTab('file')}
            >
              From File
            </button>
            <button
              className={`import-tab ${activeTab === 'code' ? 'active' : ''}`}
              onClick={() => setActiveTab('code')}
            >
              From Share Code
            </button>
            <button
              className={`import-tab ${activeTab === 'clipboard' ? 'active' : ''}`}
              onClick={() => setActiveTab('clipboard')}
            >
              From Clipboard
            </button>
          </div>

          {/* File Import */}
          {activeTab === 'file' && (
            <div className="import-section">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
              <div
                className="file-drop-zone"
                onClick={() => fileInputRef.current?.click()}
              >
                {selectedFile ? (
                  <div className="selected-file">
                    <span className="file-icon">📄</span>
                    <span className="file-name">{selectedFile.name}</span>
                    <span className="file-size">
                      ({(selectedFile.size / 1024).toFixed(1)} KB)
                    </span>
                  </div>
                ) : (
                  <>
                    <span className="upload-icon">📁</span>
                    <p>Click to select a JSON file</p>
                    <p className="hint">Or drag and drop</p>
                  </>
                )}
              </div>
              <button
                className="import-btn"
                onClick={handleImportFromFile}
                disabled={!selectedFile || isImporting}
              >
                {isImporting ? 'Importing...' : 'Import from File'}
              </button>
            </div>
          )}

          {/* Code Import */}
          {activeTab === 'code' && (
            <div className="import-section">
              <label className="import-label">Paste Share Code</label>
              <textarea
                className="share-code-input"
                value={shareCode}
                onChange={e => setShareCode(e.target.value)}
                placeholder="Paste the share code here..."
                rows={6}
              />
              <button
                className="import-btn"
                onClick={handleImportFromCode}
                disabled={!shareCode.trim() || isImporting}
              >
                {isImporting ? 'Importing...' : 'Import from Code'}
              </button>
            </div>
          )}

          {/* Clipboard Import */}
          {activeTab === 'clipboard' && (
            <div className="import-section">
              <div className="clipboard-info">
                <span className="clipboard-icon">📋</span>
                <p>Click the button below to import a strategy from your clipboard.</p>
                <p className="hint">
                  Make sure you have a valid share code copied.
                </p>
              </div>
              <button
                className="import-btn"
                onClick={handleImportFromClipboard}
                disabled={isImporting}
              >
                {isImporting ? 'Importing...' : 'Import from Clipboard'}
              </button>
            </div>
          )}

          {/* Import Result */}
          {result && (
            <div className={`import-result ${result.success ? 'success' : 'error'}`}>
              {result.success ? (
                <>
                  <div className="result-header success">
                    <span className="result-icon">✓</span>
                    <span>Strategy imported successfully!</span>
                  </div>
                  {result.warnings.length > 0 && renderWarnings(result.warnings)}
                </>
              ) : (
                <>
                  <div className="result-header error">
                    <span className="result-icon">✗</span>
                    <span>Import failed</span>
                  </div>
                  {result.errors.length > 0 && renderErrors(result.errors)}
                </>
              )}
            </div>
          )}
        </div>

        <div className="dialog-footer">
          <button className="dialog-btn secondary" onClick={onClose}>
            {result?.success ? 'Done' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}
