/**
 * Pro Mode Page
 * Main container for the custom strategy builder, backtester, and results dashboard
 */

import { useState, useEffect, useCallback } from 'react';
import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import CodeEditor from './editor/CodeEditor';
import EditorToolbar from './editor/EditorToolbar';
import StrategyList from './common/StrategyList';
import BacktestConfig from './backtest/BacktestConfig';
import BacktestResults from './backtest/BacktestResults';
import TemplateBrowser from './templates/TemplateBrowser';
import {
  CustomStrategy,
  createEmptyStrategy,
  ValidationResult,
  BacktestResult,
  BacktestConfig as BacktestConfigType,
} from '../../types/proMode';
import { strategyOperations, backtestOperations } from '../../services/proMode/proModeDbService';
import { pyodideService } from '../../services/proMode/pyodideService';
import { backtestEngine } from '../../services/proMode/backtestEngine';
import { externalDataService } from '../../services/proMode/externalDataService';
import ShareDialog from './sharing/ShareDialog';
import ImportDialog from './sharing/ImportDialog';
import { LiveTradingPanel } from './live';
import './ProModePage.css';

type ProModeTab = 'editor' | 'backtest' | 'results' | 'templates' | 'live';

const TAB_STORAGE_KEY = 'promode-active-tab';

export default function ProModePage() {
  // Tab state - restore from localStorage if available
  const [activeTab, setActiveTab] = useState<ProModeTab>(() => {
    const saved = localStorage.getItem(TAB_STORAGE_KEY);
    return (saved as ProModeTab) || 'editor';
  });

  // Strategy state
  const [strategies, setStrategies] = useState<CustomStrategy[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<CustomStrategy | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Editor state
  const [code, setCode] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  // Pyodide state
  const [pyodideStatus, setPyodideStatus] = useState<'idle' | 'initializing' | 'ready' | 'error'>('idle');

  // Backtest state
  const [backtestConfig, setBacktestConfig] = useState<BacktestConfigType | null>(null);
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [isBacktesting, setIsBacktesting] = useState(false);
  const [backtestProgress, setBacktestProgress] = useState(0);
  const [backtestStatusMessage, setBacktestStatusMessage] = useState('');

  // Dialog state
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);

  // Load strategies on mount
  useEffect(() => {
    loadStrategies();
    initializePyodide();
  }, []);

  // Persist tab state to localStorage
  useEffect(() => {
    localStorage.setItem(TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

  // Update code when strategy changes
  useEffect(() => {
    if (selectedStrategy) {
      setCode(selectedStrategy.pythonCode);
      setIsDirty(false);
      setValidationResult(null);
    }
  }, [selectedStrategy?.id]);

  const loadStrategies = async () => {
    try {
      setIsLoading(true);
      const loadedStrategies = await strategyOperations.getAll();
      setStrategies(loadedStrategies);

      // Select first strategy or create new one if none exist
      if (loadedStrategies.length > 0) {
        setSelectedStrategy(loadedStrategies[0]);
      }
    } catch (error) {
      console.error('Failed to load strategies:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const initializePyodide = async () => {
    try {
      setPyodideStatus('initializing');
      await pyodideService.initialize();
      setPyodideStatus('ready');
    } catch (error) {
      console.error('Failed to initialize Pyodide:', error);
      setPyodideStatus('error');
    }
  };

  // Strategy operations
  const handleCreateStrategy = async () => {
    const newStrategy = createEmptyStrategy(`Strategy ${strategies.length + 1}`);
    await strategyOperations.create(newStrategy);
    setStrategies(prev => [newStrategy, ...prev]);
    setSelectedStrategy(newStrategy);
    setCode(newStrategy.pythonCode);
    setIsDirty(false);
  };

  const handleSelectStrategy = (strategy: CustomStrategy) => {
    if (isDirty) {
      const confirm = window.confirm('You have unsaved changes. Discard them?');
      if (!confirm) return;
    }
    setSelectedStrategy(strategy);
  };

  const handleDeleteStrategy = async (strategyId: string) => {
    const confirm = window.confirm('Are you sure you want to delete this strategy?');
    if (!confirm) return;

    await strategyOperations.delete(strategyId);
    setStrategies(prev => prev.filter(s => s.id !== strategyId));

    if (selectedStrategy?.id === strategyId) {
      const remaining = strategies.filter(s => s.id !== strategyId);
      setSelectedStrategy(remaining.length > 0 ? remaining[0] : null);
    }
  };

  const handleCodeChange = (newCode: string) => {
    setCode(newCode);
    setIsDirty(true);
    // Clear validation when code changes
    setValidationResult(null);
  };

  const handleSave = async () => {
    if (!selectedStrategy) return;

    try {
      setIsSaving(true);

      // Update strategy with new code
      const updatedStrategy: CustomStrategy = {
        ...selectedStrategy,
        pythonCode: code,
        updatedAt: Date.now(),
      };

      await strategyOperations.update(selectedStrategy.id, {
        pythonCode: code,
        updatedAt: Date.now(),
      });

      // Update local state
      setStrategies(prev =>
        prev.map(s => (s.id === selectedStrategy.id ? updatedStrategy : s))
      );
      setSelectedStrategy(updatedStrategy);
      setIsDirty(false);
      // Clear validation after successful save (code may need revalidation)
      setValidationResult(null);
    } catch (error) {
      console.error('Failed to save strategy:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleValidate = async () => {
    if (!code) return;

    try {
      setIsValidating(true);
      const result = await pyodideService.validateCode(code);
      setValidationResult(result);

      // Update strategy status if valid
      if (result.isValid && selectedStrategy) {
        await strategyOperations.update(selectedStrategy.id, {
          status: 'validated',
        });
        setSelectedStrategy(prev => prev ? { ...prev, status: 'validated' } : null);
        setStrategies(prev =>
          prev.map(s => (s.id === selectedStrategy.id ? { ...s, status: 'validated' } : s))
        );
      }
    } catch (error) {
      console.error('Validation failed:', error);
      setValidationResult({
        isValid: false,
        errors: [{ type: 'runtime', message: String(error) }],
        warnings: [],
        syntaxCheckPassed: false,
        securityCheckPassed: false,
        interfaceCheckPassed: false,
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleRunBacktest = async () => {
    if (!selectedStrategy || !backtestConfig) return;

    try {
      setIsBacktesting(true);
      setBacktestProgress(0);
      setBacktestStatusMessage('Initializing backtest...');
      setActiveTab('results');

      // First, ensure Pyodide is ready
      if (pyodideStatus !== 'ready') {
        setBacktestStatusMessage('Waiting for Python runtime...');
        await pyodideService.initialize();
      }

      // Fetch historical data based on data source
      setBacktestStatusMessage('Fetching historical data...');
      setBacktestProgress(5);

      const bars = await externalDataService.fetchBars(
        backtestConfig.dataSource,
        {
          startDate: backtestConfig.startDate,
          endDate: backtestConfig.endDate,
          resolution: backtestConfig.barResolution,
          useCache: true,
        }
      );

      if (bars.length === 0) {
        setBacktestStatusMessage('No data available for the selected period');
        setIsBacktesting(false);
        return;
      }

      setBacktestStatusMessage(`Running backtest on ${bars.length} bars...`);
      setBacktestProgress(10);

      // Run the backtest
      const result = await backtestEngine.runBacktest(
        backtestConfig,
        selectedStrategy,
        (progress) => {
          setBacktestProgress(progress);
          if (progress < 50) {
            setBacktestStatusMessage(`Processing bars... ${progress}%`);
          } else if (progress < 90) {
            setBacktestStatusMessage(`Executing strategy... ${progress}%`);
          } else {
            setBacktestStatusMessage(`Calculating metrics... ${progress}%`);
          }
        }
      );

      setBacktestResult(result);
      setBacktestProgress(100);

      if (result.status === 'completed') {
        setBacktestStatusMessage('Backtest completed successfully');

        // Update strategy status
        await strategyOperations.update(selectedStrategy.id, {
          status: 'backtested',
        });
        setSelectedStrategy(prev => prev ? { ...prev, status: 'backtested' } : null);
        setStrategies(prev =>
          prev.map(s => (s.id === selectedStrategy.id ? { ...s, status: 'backtested' } : s))
        );
      } else if (result.status === 'failed') {
        setBacktestStatusMessage(`Backtest failed: ${result.errorMessage || 'Unknown error'}`);
      } else if (result.status === 'cancelled') {
        setBacktestStatusMessage('Backtest was cancelled');
      }

    } catch (error) {
      console.error('Backtest failed:', error);
      setBacktestStatusMessage(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsBacktesting(false);
    }
  };

  const handleSelectTemplate = async (template: CustomStrategy) => {
    // Create a new strategy from template
    const newStrategy = {
      ...template,
      id: crypto.randomUUID(),
      name: `${template.name} (Copy)`,
      isTemplate: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await strategyOperations.create(newStrategy);
    setStrategies(prev => [newStrategy, ...prev]);
    setSelectedStrategy(newStrategy);
    setCode(newStrategy.pythonCode);
    setIsDirty(false);
    setActiveTab('editor');
  };

  const handleRenameStrategy = async (strategyId: string, newName: string) => {
    await strategyOperations.update(strategyId, { name: newName });
    setStrategies(prev =>
      prev.map(s => (s.id === strategyId ? { ...s, name: newName } : s))
    );
    if (selectedStrategy?.id === strategyId) {
      setSelectedStrategy(prev => prev ? { ...prev, name: newName } : null);
    }
  };

  const handleImportSuccess = async (strategyId: string) => {
    // Reload strategies to include the imported one
    await loadStrategies();
    // Select the imported strategy
    const imported = await strategyOperations.getById(strategyId);
    if (imported) {
      setSelectedStrategy(imported);
      setCode(imported.pythonCode);
      setIsDirty(false);
    }
    setShowImportDialog(false);
    setActiveTab('editor');
  };

  return (
    <div className="pro-mode-page">
      {/* Header with tabs */}
      <div className="pro-mode-header">
        <div className="pro-mode-tabs">
          <button
            className={`pro-mode-tab-btn ${activeTab === 'editor' ? 'active' : ''}`}
            onClick={() => setActiveTab('editor')}
          >
            Strategy Editor
          </button>
          <button
            className={`pro-mode-tab-btn ${activeTab === 'backtest' ? 'active' : ''}`}
            onClick={() => setActiveTab('backtest')}
          >
            Backtest
          </button>
          <button
            className={`pro-mode-tab-btn ${activeTab === 'results' ? 'active' : ''}`}
            onClick={() => setActiveTab('results')}
          >
            Results
          </button>
          <button
            className={`pro-mode-tab-btn ${activeTab === 'templates' ? 'active' : ''}`}
            onClick={() => setActiveTab('templates')}
          >
            Templates
          </button>
          <button
            className={`pro-mode-tab-btn ${activeTab === 'live' ? 'active' : ''}`}
            onClick={() => setActiveTab('live')}
          >
            Live Trading
          </button>
        </div>

        <div className="pro-mode-status">
          {/* Import/Export buttons */}
          <button
            className="toolbar-btn"
            onClick={() => setShowImportDialog(true)}
            title="Import strategy"
          >
            Import
          </button>
          <button
            className="toolbar-btn"
            onClick={() => setShowShareDialog(true)}
            disabled={!selectedStrategy}
            title="Export/share strategy"
          >
            Export
          </button>

          <span className={`pyodide-status ${pyodideStatus}`}>
            {pyodideStatus === 'initializing' && 'Loading Python...'}
            {pyodideStatus === 'ready' && 'Python Ready'}
            {pyodideStatus === 'error' && 'Python Error'}
            {pyodideStatus === 'idle' && 'Python Idle'}
          </span>
        </div>
      </div>

      {/* Main content */}
      <div className="pro-mode-content">
        {/* Editor Tab */}
        {activeTab === 'editor' && (
          <Allotment>
            {/* Left sidebar - Strategy list */}
            <Allotment.Pane preferredSize={250} minSize={200} maxSize={400}>
              <StrategyList
                strategies={strategies}
                selectedStrategy={selectedStrategy}
                onSelect={handleSelectStrategy}
                onCreate={handleCreateStrategy}
                onDelete={handleDeleteStrategy}
                onRename={handleRenameStrategy}
                isLoading={isLoading}
              />
            </Allotment.Pane>

            {/* Main editor area */}
            <Allotment.Pane>
              <div className="editor-container">
                <EditorToolbar
                  strategy={selectedStrategy}
                  isDirty={isDirty}
                  isSaving={isSaving}
                  isValidating={isValidating}
                  validationResult={validationResult}
                  onSave={handleSave}
                  onValidate={handleValidate}
                  onRun={() => setActiveTab('backtest')}
                  pyodideReady={pyodideStatus === 'ready'}
                />
                <CodeEditor
                  code={code}
                  onChange={handleCodeChange}
                  validationResult={validationResult}
                  readOnly={!selectedStrategy}
                />
              </div>
            </Allotment.Pane>
          </Allotment>
        )}

        {/* Backtest Tab */}
        {activeTab === 'backtest' && (
          <BacktestConfig
            strategy={selectedStrategy}
            config={backtestConfig}
            onConfigChange={setBacktestConfig}
            onRunBacktest={handleRunBacktest}
            isBacktesting={isBacktesting}
          />
        )}

        {/* Results Tab */}
        {activeTab === 'results' && (
          <BacktestResults
            result={backtestResult}
            isLoading={isBacktesting}
            progress={backtestProgress}
            statusMessage={backtestStatusMessage}
          />
        )}

        {/* Templates Tab */}
        {activeTab === 'templates' && (
          <TemplateBrowser
            onSelectTemplate={handleSelectTemplate}
          />
        )}

        {/* Live Trading Tab */}
        {activeTab === 'live' && (
          <LiveTradingPanel
            strategy={selectedStrategy}
            marketId={backtestConfig?.dataSource?.marketId || 'default'}
          />
        )}
      </div>

      {/* Dialogs */}
      {showShareDialog && selectedStrategy && (
        <ShareDialog
          strategy={selectedStrategy}
          onClose={() => setShowShareDialog(false)}
        />
      )}

      {showImportDialog && (
        <ImportDialog
          onClose={() => setShowImportDialog(false)}
          onImportSuccess={handleImportSuccess}
        />
      )}
    </div>
  );
}
