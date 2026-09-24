import { ReactNode, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWizard } from '../context/WizardContext';
import { updateDemo } from '../services/demosApi';
import { notifyAgentListChanged } from '../events/agentEvents';
import styles from './PageWrapper.module.css';

interface PageWrapperProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onNext?: () => void;
  onBack?: () => void;
  nextLabel?: string;
  backLabel?: string;
  nextDisabled?: boolean;
  steps?: { label: string; active: boolean; completed: boolean }[];
}

function PageWrapper({
  title,
  subtitle,
  children,
  onNext,
  onBack,
  nextLabel = 'Continue',
  backLabel = 'Back',
  nextDisabled = false,
  steps,
}: PageWrapperProps) {
  const navigate = useNavigate();
  const { state, dispatch } = useWizard();
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(state.editingDemoName || '');

  const handleNameSave = () => {
    const trimmed = nameValue.trim();
    if (trimmed && trimmed !== state.editingDemoName) {
      dispatch({ type: 'SET_EDITING_DEMO', payload: { id: state.editingDemoId || '', name: trimmed } });
      // Persist to DB if agent already exists
      if (state.editingDemoId) {
        updateDemo(state.editingDemoId, { name: trimmed }).then(() => {
          notifyAgentListChanged();
        }).catch(() => {});
      }
    }
    setEditingName(false);
  };

  return (
    <div className={styles.wrapper}>
      {steps && (
        <div className={styles.steps}>
          {steps.map((step, i) => (
            <div
              key={i}
              className={`${styles.step} ${step.active ? styles.active : ''} ${
                step.completed ? styles.completed : ''
              }`}
            >
              <div className={styles.stepDot}>
                {step.completed ? '✓' : i + 1}
              </div>
              <span className={styles.stepLabel}>{step.label}</span>
              {i < steps.length - 1 && <div className={styles.stepLine} />}
            </div>
          ))}
        </div>
      )}

      {/* Inline editable agent name */}
      <div style={{ padding: '0 0 8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        {editingName ? (
          <input
            autoFocus
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={handleNameSave}
            onKeyDown={(e) => { if (e.key === 'Enter') handleNameSave(); if (e.key === 'Escape') setEditingName(false); }}
            style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a', border: '1px solid #c7d2fe', borderRadius: '4px', padding: '4px 8px', outline: 'none', width: '240px' }}
            placeholder="Agent name"
          />
        ) : (
          <span
            onClick={() => { setNameValue(state.editingDemoName || ''); setEditingName(true); }}
            style={{ fontSize: '14px', fontWeight: 600, color: state.editingDemoName ? '#0f172a' : '#94a3b8', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px', border: '1px solid transparent', transition: 'border-color 0.2s' }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#e2e8f0')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'transparent')}
          >
            {state.editingDemoName || 'Untitled Agent'}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: '6px', opacity: 0.5 }}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </span>
        )}
      </div>

      <div className={styles.content}>
        <div className={styles.header}>
          <h1 className={styles.title}>{title}</h1>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>

        <div className={styles.body}>{children}</div>

        <div className={styles.footer}>
          {onBack && (
            <button className={styles.backBtn} onClick={onBack}>
              ← {backLabel}
            </button>
          )}
          <div className={styles.spacer} />
          {onNext && (
            <button
              className={styles.nextBtn}
              onClick={onNext}
              disabled={nextDisabled}
            >
              {nextLabel} →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default PageWrapper;
