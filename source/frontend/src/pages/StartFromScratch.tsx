import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWizard } from '../context/WizardContext';
import type { HostType, FrameworkType, PipelineType } from '../context/WizardContext';
import { generateAgentConfig } from '../services/generateAgent';
import styles from './StartFromScratch.module.css';

function StartFromScratch() {
  const navigate = useNavigate();
  const { dispatch } = useWizard();
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset wizard state when starting a new agent from scratch
  useEffect(() => {
    dispatch({ type: 'RESET' });
  }, []);

  const handleGenerate = async () => {
    if (!description.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const config = await generateAgentConfig(description.trim());

      // Reset wizard state first to clear any previous template data
      dispatch({ type: 'RESET' });

      // Populate wizard state with generated config
      dispatch({ type: 'SET_HOST', payload: config.host as HostType });
      dispatch({ type: 'SET_FRAMEWORK', payload: config.framework as FrameworkType });
      dispatch({ type: 'SET_MODEL', payload: config.model });
      dispatch({ type: 'SET_PIPELINE', payload: (config.pipeline || 'speech-to-speech') as PipelineType });
      dispatch({ type: 'SET_VOICE', payload: config.voice });
      dispatch({ type: 'SET_AGENTS', payload: { selectedAgents: config.tools || [] } });
      dispatch({ type: 'SET_PROMPT', payload: config.prompt });
      dispatch({ type: 'SET_WORKFLOW', payload: null });

      navigate('/voice-1s');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate configuration');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleGenerate();
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Describe Your Agent</h1>
        <p className={styles.subtitle}>
          Tell us about your use case and we'll auto-generate a complete agent configuration using AI.
        </p>
      </div>

      <div className={styles.inputSection}>
        <textarea
          className={styles.textarea}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. I need a voice agent for a dental clinic that books appointments, answers questions about services and pricing, and can transfer to a live receptionist if the caller is upset..."
          rows={6}
          disabled={loading}
        />
        <div className={styles.inputFooter}>
          <span className={styles.hint}>⌘+Enter to generate</span>
          <span className={styles.charCount}>{description.length} characters</span>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.actions}>
        <button
          className={styles.generateBtn}
          onClick={handleGenerate}
          disabled={!description.trim() || loading}
        >
          {loading ? (
            <>
              <span className={styles.spinner} />
              Generating configuration...
            </>
          ) : (
            'Generate Agent Configuration'
          )}
        </button>
        <button className={styles.skipBtn} onClick={() => navigate('/home')}>
          Skip — configure manually
        </button>
      </div>

      <div className={styles.examples}>
        <p className={styles.examplesTitle}>Example prompts:</p>
        <div className={styles.exampleChips}>
          <button
            className={styles.chip}
            onClick={() => setDescription('A customer service agent for an e-commerce company that handles order status inquiries, returns, and refund requests. It should be polite and efficient, and escalate to a human for complaints about damaged items.')}
          >
            E-commerce support
          </button>
          <button
            className={styles.chip}
            onClick={() => setDescription('A receptionist for a veterinary clinic that schedules pet appointments, provides information about services (vaccines, dental, surgery), and collects pet and owner details for new patients.')}
          >
            Vet clinic receptionist
          </button>
          <button
            className={styles.chip}
            onClick={() => setDescription('A restaurant reservation agent that takes bookings, handles dietary requirements, answers questions about the menu and specials, and can modify or cancel existing reservations.')}
          >
            Restaurant reservations
          </button>
        </div>
      </div>
    </div>
  );
}

export default StartFromScratch;
