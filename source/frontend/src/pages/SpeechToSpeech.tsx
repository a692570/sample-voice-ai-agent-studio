import { useNavigate } from 'react-router-dom';
import { useWizard } from '../context/WizardContext';
import PageWrapper from '../components/PageWrapper';
import styles from './SpeechToSpeech.module.css';

const MODELS = [
  {
    id: 'nova-2-sonic',
    name: 'Amazon Nova 2 Sonic',
    provider: 'AWS Bedrock',
    desc: 'Native bidirectional streaming model. Low latency, multilingual, tool use. No API key needed.',
    icon: 'mic',
    requiresKey: false,
  },
  {
    id: 'openai-realtime',
    name: 'OpenAI Realtime API',
    provider: 'OpenAI',
    desc: 'GPT-4o realtime voice model. Requires OpenAI API key.',
    icon: 'cpu',
    requiresKey: true,
    keyField: 'openai' as const,
  },
  {
    id: 'gemini-live',
    name: 'Gemini Live',
    provider: 'Google',
    desc: 'Gemini multimodal live API. Requires Google AI API key.',
    icon: 'diamond',
    requiresKey: true,
    keyField: 'gemini' as const,
  },
];

function SpeechToSpeech() {
  const navigate = useNavigate();
  const { state, dispatch } = useWizard();

  const selectedModel = state.model[0] || 'nova-2-sonic';

  const steps = [
    { label: 'Pipeline', active: false, completed: true },
    { label: 'Model', active: true, completed: false },
    { label: 'Voice', active: false, completed: false },
    { label: 'Flow', active: false, completed: false },
    { label: 'Summary', active: false, completed: false },
    { label: 'Try It', active: false, completed: false },
  ];

  const currentModel = MODELS.find((m) => m.id === selectedModel);
  const needsApiKey =
    currentModel?.requiresKey &&
    currentModel.keyField &&
    !state.apiKeys[currentModel.keyField];

  return (
    <PageWrapper
      title="Bidirectional Streaming Model"
      subtitle="Choose the real-time voice model for your agent. Third-party models require an API key."
      steps={steps}
      onNext={() => {
        dispatch({ type: 'SET_MODEL', payload: [selectedModel] });
        navigate('/voice-1s');
      }}
      onBack={() => navigate('/pipeline')}
      nextDisabled={!!needsApiKey}
    >
      <div className={styles.container}>
        <div className={styles.modelList}>
          {MODELS.map((model) => (
            <button
              key={model.id}
              className={`${styles.modelCard} ${
                selectedModel === model.id ? styles.modelSelected : ''
              }`}
              onClick={() =>
                dispatch({ type: 'SET_MODEL', payload: [model.id] })
              }
            >
              <div className={styles.modelIcon}>
                {model.icon === 'mic' && <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>}
                {model.icon === 'cpu' && <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>}
                {model.icon === 'diamond' && <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12l4 6-10 13L2 9z"/><path d="M2 9h20"/><path d="M12 22L6 9"/><path d="M12 22l6-13"/><path d="M10 3l-4 6"/><path d="M14 3l4 6"/></svg>}
              </div>
              <div className={styles.modelInfo}>
                <h3 className={styles.modelName}>{model.name}</h3>
                <span className={styles.modelProvider}>{model.provider}</span>
                <p className={styles.modelDesc}>{model.desc}</p>
              </div>
              {selectedModel === model.id && (
                <div className={styles.badge}>Selected</div>
              )}
            </button>
          ))}
        </div>

        {/* API Key input for OpenAI */}
        {selectedModel === 'openai-realtime' && (
          <div className={styles.apiKeySection}>
            <label className={styles.apiKeyLabel} htmlFor="openaiKey">
              OpenAI API Key
            </label>
            <input
              id="openaiKey"
              className={styles.apiKeyInput}
              type="password"
              placeholder="sk-..."
              value={state.apiKeys.openai}
              onChange={(e) =>
                dispatch({
                  type: 'SET_API_KEYS',
                  payload: { openai: e.target.value },
                })
              }
            />
            <span className={styles.apiKeyHint}>
              Your key is sent securely to the agent server and not stored.
            </span>
          </div>
        )}

        {/* API Key input for Gemini */}
        {selectedModel === 'gemini-live' && (
          <div className={styles.apiKeySection}>
            <label className={styles.apiKeyLabel} htmlFor="geminiKey">
              Google AI API Key
            </label>
            <input
              id="geminiKey"
              className={styles.apiKeyInput}
              type="password"
              placeholder="AIza..."
              value={state.apiKeys.gemini}
              onChange={(e) =>
                dispatch({
                  type: 'SET_API_KEYS',
                  payload: { gemini: e.target.value },
                })
              }
            />
            <span className={styles.apiKeyHint}>
              Your key is sent securely to the agent server and not stored.
            </span>
          </div>
        )}

        <div className={styles.infoBox}>
          <strong><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '4px' }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>How it works</strong>
          <p>
            All models use Strands BidiAgent for orchestration. Nova Sonic uses
            Bedrock directly (no key needed). OpenAI and Gemini require your own
            API key which is passed to the agent at session start.
          </p>
        </div>
      </div>
    </PageWrapper>
  );
}

export default SpeechToSpeech;
