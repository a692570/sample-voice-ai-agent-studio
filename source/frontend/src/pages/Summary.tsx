import { useNavigate } from 'react-router-dom';
import { useWizard } from '../context/WizardContext';
import { listTools } from '../services/toolsApi';
import type { SavedTool } from '../services/toolsApi';
import { createDemo, updateDemo, wizardStateToConfig } from '../services/demosApi';
import { notifyAgentListChanged } from '../events/agentEvents';
import PageWrapper from '../components/PageWrapper';
import styles from './Summary.module.css';
import { useState, useEffect } from 'react';

const AGENT_LABELS: Record<string, string> = {
  'knowledge-base': 'Knowledge Base Lookup',
  calendar: 'Calendar / Scheduling',
  crm: 'CRM Lookup',
  'order-status': 'Order Status',
  transfer: 'Call Transfer',
  payment: 'Payment Processing',
  notification: 'Send Notification',
  custom: 'Custom Tool',
};

function Summary() {
  const navigate = useNavigate();
  const { state } = useWizard();
  const [availableTools, setAvailableTools] = useState<SavedTool[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    listTools().then(setAvailableTools).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      if (state.editingDemoId) {
        // Editing an existing agent — update it in place.
        await updateDemo(state.editingDemoId, { config: wizardStateToConfig(state) });
      } else {
        // New agent — prompt for a name and create it.
        const name = window.prompt('Agent name:', state.editingDemoName || 'My Agent');
        if (!name) {
          setSaving(false);
          return;
        }
        await createDemo({ name, config: wizardStateToConfig(state) });
      }
      setSaved(true);
      notifyAgentListChanged();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save agent');
    } finally {
      setSaving(false);
    }
  };

  const getSteps = () => {
    if (state.path === 'minimal') {
      return [
        { label: 'Voice', active: false, completed: true },
        { label: 'Flow', active: false, completed: true },
        { label: 'Summary', active: true, completed: false },
        { label: 'Try It', active: false, completed: false },
      ];
    }
    return [
      { label: 'Pipeline', active: false, completed: true },
      { label: 'Model', active: false, completed: true },
      { label: 'Voice', active: false, completed: true },
      { label: 'Flow', active: false, completed: true },
      { label: 'Summary', active: true, completed: false },
      { label: 'Try It', active: false, completed: false },
    ];
  };

  const handleBack = () => {
    navigate('/tools-selection');
  };

  return (
    <PageWrapper
      title="Summary"
      subtitle="Review your configuration before deploying the POC."
      steps={getSteps()}
      onNext={() => navigate('/poc')}
      onBack={handleBack}
      nextLabel="Try It Out"
    >
      <div className={styles.sections}>
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Path</h3>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Selected Path</span>
            <span className={styles.rowValue}>
              {state.path === 'minimal'
                ? 'Minimal Effort (Sonic)'
                : 'Some Technical Effort'}
            </span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Pipeline</span>
            <span className={styles.rowValue}>
              {state.pipeline === 'speech-to-speech'
                ? 'Speech-to-Speech (Nova Sonic)'
                : 'Cascaded Workflow'}
            </span>
          </div>
        </div>

        {state.pipeline === 'cascaded' && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Model Configuration</h3>
            <div className={styles.row}>
              <span className={styles.rowLabel}>STT</span>
              <span className={styles.rowValue}>
                {state.cascaded.sttProvider === 'transcribe'
                  ? 'Amazon Transcribe'
                  : 'Deepgram'}
              </span>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>LLM</span>
              <span className={styles.rowValue}>
                {state.cascaded.llmProvider === 'nova-lite'
                  ? 'Amazon Nova Lite (Bedrock)'
                  : 'GPT (via Bedrock)'}
              </span>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>TTS</span>
              <span className={styles.rowValue}>
                {state.cascaded.ttsProvider === 'polly'
                  ? 'Amazon Polly'
                  : 'Eleven Labs'}
              </span>
            </div>
          </div>
        )}

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Voice</h3>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Language</span>
            <span className={styles.rowValue}>{state.voice.language}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Gender</span>
            <span className={styles.rowValue}>{state.voice.gender}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Voice ID</span>
            <span className={styles.rowValue}>
              {state.voice.voiceId || 'Not selected'}
            </span>
          </div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Prompt</h3>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Greeting</span>
            <span className={styles.rowValue}>
              {state.prompt.greeting || '—'}
            </span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Instructions</span>
            <span className={styles.rowValue}>
              {state.prompt.instructions ? state.prompt.instructions.substring(0, 100) + (state.prompt.instructions.length > 100 ? '...' : '') : '—'}
            </span>
          </div>

        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Agent Tools</h3>
          {state.agents.selectedAgents.length > 0 ? (
            <div className={styles.tagList}>
              {state.agents.selectedAgents.map((id) => {
                const tool = availableTools.find((t) => `int:${t.id}` === id || t.id === id);
                const label = tool ? tool.name : (AGENT_LABELS[id] || id.replace('int:', ''));
                return (
                  <span key={id} className={styles.tag}>
                    {label}
                  </span>
                );
              })}
            </div>
          ) : (
            <p className={styles.emptyText}>No tools selected</p>
          )}
        </div>

        {/* Save agent */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', paddingTop: '4px' }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '10px 20px',
              background: saved ? '#059669' : '#6366f1',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Saving…' : saved ? '✓ Saved' : state.editingDemoId ? 'Save Changes' : 'Save Agent'}
          </button>
          {saved && (
            <span style={{ fontSize: '13px', color: '#059669' }}>
              Agent saved. It now appears in your agents list.
            </span>
          )}
          {saveError && (
            <span style={{ fontSize: '13px', color: '#dc2626' }}>{saveError}</span>
          )}
        </div>
      </div>

    </PageWrapper>
  );
}

export default Summary;
