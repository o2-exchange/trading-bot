/**
 * Editor Toolbar Component
 * Actions for save, validate, and run
 */

import { CustomStrategy, ValidationResult } from '../../../types/proMode';

interface EditorToolbarProps {
  strategy: CustomStrategy | null;
  isDirty: boolean;
  isSaving: boolean;
  isValidating: boolean;
  validationResult: ValidationResult | null;
  onSave: () => void;
  onValidate: () => void;
  onRun: () => void;
  pyodideReady: boolean;
}

export default function EditorToolbar({
  strategy,
  isDirty,
  isSaving,
  isValidating,
  validationResult,
  onSave,
  onValidate,
  onRun,
  pyodideReady,
}: EditorToolbarProps) {
  const canValidate = strategy && pyodideReady && !isValidating;
  const canRun = strategy && validationResult?.isValid;

  return (
    <div className="editor-toolbar">
      <div className="editor-toolbar-left">
        {strategy ? (
          <>
            <span className="strategy-name-display">{strategy.name}</span>
            {isDirty && <span className="dirty-indicator">● Unsaved</span>}
          </>
        ) : (
          <span className="strategy-name-display">No strategy selected</span>
        )}
      </div>

      <div className="editor-toolbar-right">
        {/* Validation status */}
        {validationResult && (
          <div className={`validation-indicator ${validationResult.isValid ? 'valid' : 'invalid'}`}>
            {validationResult.isValid ? (
              <>✓ Valid</>
            ) : (
              <>{validationResult.errors.length} error(s)</>
            )}
          </div>
        )}

        {/* Save button */}
        <button
          className="toolbar-btn"
          onClick={onSave}
          disabled={!strategy || !isDirty || isSaving}
          title="Save strategy (Ctrl+S)"
        >
          {isSaving ? '⏳' : '💾'} Save
        </button>

        {/* Validate button */}
        <button
          className="toolbar-btn"
          onClick={onValidate}
          disabled={!canValidate}
          title="Validate Python code"
        >
          {isValidating ? '⏳' : '✓'} Validate
        </button>

        {/* Run Backtest button */}
        <button
          className="toolbar-btn primary"
          onClick={onRun}
          disabled={!canRun}
          title={canRun ? 'Configure and run backtest' : 'Validate your strategy first'}
        >
          ▶ Run Backtest
        </button>
      </div>
    </div>
  );
}
