/**
 * Strategy List Component
 * Sidebar list of user strategies
 */

import { useState } from 'react';
import { CustomStrategy } from '../../../types/proMode';

interface StrategyListProps {
  strategies: CustomStrategy[];
  selectedStrategy: CustomStrategy | null;
  onSelect: (strategy: CustomStrategy) => void;
  onCreate: () => void;
  onDelete: (strategyId: string) => void;
  onRename: (strategyId: string, newName: string) => void;
  isLoading: boolean;
}

export default function StrategyList({
  strategies,
  selectedStrategy,
  onSelect,
  onCreate,
  onDelete,
  onRename,
  isLoading,
}: StrategyListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const handleStartRename = (strategy: CustomStrategy, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(strategy.id);
    setEditName(strategy.name);
  };

  const handleFinishRename = (strategyId: string) => {
    if (editName.trim()) {
      onRename(strategyId, editName.trim());
    }
    setEditingId(null);
    setEditName('');
  };

  const handleKeyDown = (e: React.KeyboardEvent, strategyId: string) => {
    if (e.key === 'Enter') {
      handleFinishRename(strategyId);
    } else if (e.key === 'Escape') {
      setEditingId(null);
      setEditName('');
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString();
  };

  if (isLoading) {
    return (
      <div className="strategy-list">
        <div className="strategy-list-header">
          <h3>Strategies</h3>
        </div>
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="strategy-list">
      <div className="strategy-list-header">
        <h3>Strategies</h3>
        <button className="new-strategy-btn" onClick={onCreate} title="New strategy">
          +
        </button>
      </div>

      <div className="strategy-list-items">
        {strategies.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📝</div>
            <h3>No Strategies</h3>
            <p>Create your first strategy to get started</p>
            <button className="toolbar-btn primary" onClick={onCreate}>
              + New Strategy
            </button>
          </div>
        ) : (
          strategies.map((strategy) => (
            <div
              key={strategy.id}
              className={`strategy-item ${selectedStrategy?.id === strategy.id ? 'selected' : ''}`}
              onClick={() => onSelect(strategy)}
            >
              <div className="strategy-item-info">
                {editingId === strategy.id ? (
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => handleFinishRename(strategy.id)}
                    onKeyDown={(e) => handleKeyDown(e, strategy.id)}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                    className="strategy-name-input"
                  />
                ) : (
                  <div className="strategy-item-name">{strategy.name}</div>
                )}
                <div className="strategy-item-meta">
                  <span className={`strategy-status ${strategy.status}`}>
                    {strategy.status}
                  </span>
                  <span>{formatDate(strategy.updatedAt)}</span>
                </div>
              </div>

              <div className="strategy-item-actions">
                <button
                  className="strategy-action-btn"
                  onClick={(e) => handleStartRename(strategy, e)}
                  title="Rename"
                >
                  ✏️
                </button>
                <button
                  className="strategy-action-btn delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(strategy.id);
                  }}
                  title="Delete"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
