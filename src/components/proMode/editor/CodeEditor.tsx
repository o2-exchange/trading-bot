/**
 * Code Editor Component
 * Monaco Editor wrapper for Python strategy editing
 */

import { useRef, useEffect } from 'react';
import Editor, { OnMount, OnChange, Monaco } from '@monaco-editor/react';
import { ValidationResult } from '../../../types/proMode';

// Monaco editor types
type IStandaloneCodeEditor = Parameters<OnMount>[0];
type IMarkerData = {
  severity: number;
  message: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
};

interface CodeEditorProps {
  code: string;
  onChange: (code: string) => void;
  validationResult?: ValidationResult | null;
  readOnly?: boolean;
}

export default function CodeEditor({
  code,
  onChange,
  validationResult,
  readOnly = false,
}: CodeEditorProps) {
  const editorRef = useRef<IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Configure Python language features
    monaco.languages.registerCompletionItemProvider('python', {
      provideCompletionItems: (model: any, position: any) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        const suggestions = [
          // Strategy class methods
          {
            label: 'on_bar',
            kind: monaco.languages.CompletionItemKind.Method,
            insertText: 'def on_bar(self, bar, position, orders):\n\t"""Called on each new bar"""\n\tsignals = []\n\t\n\treturn signals',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Called on each new bar. Returns list of signals.',
            range,
          },
          {
            label: '__init__',
            kind: monaco.languages.CompletionItemKind.Method,
            insertText: 'def __init__(self, context):\n\t"""Initialize strategy"""\n\tself.context = context\n\t',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Strategy initialization method.',
            range,
          },
          // Indicators
          {
            label: 'SMA',
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: 'context.indicators.SMA(period=${1:20})',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Simple Moving Average indicator',
            range,
          },
          {
            label: 'EMA',
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: 'context.indicators.EMA(period=${1:20})',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Exponential Moving Average indicator',
            range,
          },
          {
            label: 'RSI',
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: 'context.indicators.RSI(period=${1:14})',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Relative Strength Index indicator',
            range,
          },
          {
            label: 'MACD',
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: 'context.indicators.MACD(fast_period=${1:12}, slow_period=${2:26}, signal_period=${3:9})',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'MACD indicator',
            range,
          },
          {
            label: 'BOLLINGER',
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: 'context.indicators.BOLLINGER(period=${1:20}, std_dev=${2:2})',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Bollinger Bands indicator',
            range,
          },
          {
            label: 'ATR',
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: 'context.indicators.ATR(period=${1:14})',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Average True Range indicator',
            range,
          },
          // Signal templates
          {
            label: 'buy_signal',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: "signals.append({\n\t'type': 'buy',\n\t'quantity': ${1:1.0},\n\t'order_type': '${2|market,limit|}'\n})",
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Buy signal template',
            range,
          },
          {
            label: 'sell_signal',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: "signals.append({\n\t'type': 'sell',\n\t'quantity': ${1:position.quantity},\n\t'order_type': '${2|market,limit|}'\n})",
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Sell signal template',
            range,
          },
        ];

        return { suggestions };
      },
    });
  };

  const handleChange: OnChange = (value) => {
    if (value !== undefined) {
      onChange(value);
    }
  };

  // Update markers when validation result changes
  useEffect(() => {
    if (editorRef.current && monacoRef.current && validationResult) {
      const model = editorRef.current.getModel();
      if (!model) return;

      const markers: IMarkerData[] = validationResult.errors.map((error) => ({
        severity: monacoRef.current.MarkerSeverity.Error,
        message: error.message,
        startLineNumber: error.line || 1,
        startColumn: error.column || 1,
        endLineNumber: error.line || 1,
        endColumn: (error.column || 1) + 10,
      }));

      validationResult.warnings.forEach((warning) => {
        markers.push({
          severity: monacoRef.current.MarkerSeverity.Warning,
          message: warning.message,
          startLineNumber: warning.line || 1,
          startColumn: 1,
          endLineNumber: warning.line || 1,
          endColumn: 100,
        });
      });

      monacoRef.current.editor.setModelMarkers(model, 'python', markers);
    }
  }, [validationResult]);

  if (!code && readOnly) {
    return (
      <div className="code-editor-wrapper">
        <div className="code-editor-placeholder">
          <h3>No Strategy Selected</h3>
          <p>Create a new strategy or select one from the list</p>
        </div>
      </div>
    );
  }

  return (
    <div className="code-editor-wrapper">
      <Editor
        height="100%"
        defaultLanguage="python"
        value={code}
        onChange={handleChange}
        onMount={handleEditorDidMount}
        theme="vs-dark"
        options={{
          readOnly,
          minimap: { enabled: true },
          fontSize: 14,
          lineNumbers: 'on',
          renderLineHighlight: 'all',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 4,
          insertSpaces: true,
          wordWrap: 'on',
          folding: true,
          foldingStrategy: 'indentation',
          showFoldingControls: 'mouseover',
          bracketPairColorization: { enabled: true },
          guides: {
            bracketPairs: true,
            indentation: true,
          },
          suggest: {
            showMethods: true,
            showFunctions: true,
            showConstructors: true,
            showFields: true,
            showVariables: true,
            showClasses: true,
            showStructs: true,
            showInterfaces: true,
            showModules: true,
            showProperties: true,
            showEvents: true,
            showOperators: true,
            showUnits: true,
            showValues: true,
            showConstants: true,
            showEnums: true,
            showEnumMembers: true,
            showKeywords: true,
            showWords: true,
            showColors: true,
            showFiles: true,
            showReferences: true,
            showFolders: true,
            showTypeParameters: true,
            showSnippets: true,
          },
        }}
      />
    </div>
  );
}
