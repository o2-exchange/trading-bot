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
import './ProModePage.css';

type ProModeTab = 'editor' | 'backtest' | 'results' | 'templates';

export default function ProModePage() {
  // Tab state
  const [activeTab, setActiveTab] = useState<ProModeTab>('editor');

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

  // Load strategies on mount
  useEffect(() => {
    loadStrategies();
    initializePyodide();
  }, []);

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
      setActiveTab('results');

      // For now, show placeholder results
      // TODO: Implement actual backtest execution
      console.log('Running backtest with config:', backtestConfig);

    } catch (error) {
      console.error('Backtest failed:', error);
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
        </div>

        <div className="pro-mode-status">
          <span className={`pyodide-status ${pyodideStatus}`}>
            {pyodideStatus === 'initializing' && 'Loading Python...'}
            {pyodideStatus === 'ready' && 'Python Ready'}
            {pyodideStatus === 'error' && 'Python Error'}
            {pyodideStatus === 'idle' && 'Waiting...'}
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
          />
        )}

        {/* Templates Tab */}
        {activeTab === 'templates' && (
          <TemplateBrowser
            onSelectTemplate={handleSelectTemplate}
          />
        )}
      </div>
    </div>
  );
}
