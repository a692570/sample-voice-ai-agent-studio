import { useNavigate } from 'react-router-dom';
import { useWizard } from '../context/WizardContext';
import PageWrapper from '../components/PageWrapper';
import styles from './CascadedSpeech.module.css';

const PRESETS = [
  {
    id: 'aws-opinionated',
    label: 'AWS Opinionated',
    desc: 'Amazon Transcribe + Nova Lite (Bedrock) + Amazon Polly',
    stt: 'transcribe',
    llm: 'nova-lite',
    tts: 'polly',
  },
  {
    id: '3p-opinionated',
    label: '3P Opinionated',
    desc: 'Deepgram + GPT (Bedrock) + Eleven Labs',
    stt: 'deepgram',
    llm: 'gpt',
    tts: 'eleven-labs',
  },
];

const STT_OPTIONS = [
  { id: 'transcribe', label: 'Amazon Transcribe', provider: 'AWS' },
  { id: 'deepgram', label: 'Deepgram', provider: '3P' },
];

const LLM_OPTIONS = [
  { id: 'nova-lite', label: 'Amazon Nova Lite', provider: 'Bedrock' },
  { id: 'gpt', label: 'GPT (via Bedrock)', provider: 'Bedrock' },
];

const TTS_OPTIONS = [
  { id: 'polly', label: 'Amazon Polly', provider: 'AWS' },
  { id: 'eleven-labs', label: 'Eleven Labs', provider: '3P' },
];

function CascadedSpeech() {
  const navigate = useNavigate();
  const { state, dispatch } = useWizard();

  const steps = [
    { label: 'Pipeline', active: false, completed: true },
    { label: 'Model', active: true, completed: false },
    { label: 'Voice', active: false, completed: false },
    { label: 'Flow', active: false, completed: false },
    { label: 'Summary', active: false, completed: false },
    { label: 'POC', active: false, completed: false },
  ];

  const mapModelIds = (stt: string, llm: string, tts: string) => {
    const sttModel = stt === 'transcribe' ? 'transcribe' : 'deepgram';
    const llmModel = llm === 'nova-lite' ? 'nova-lite' : 'gpt';
    const ttsModel = tts === 'polly' ? 'polly' : '11labs';
    return [sttModel, llmModel, ttsModel];
  };

  const applyPreset = (preset: (typeof PRESETS)[0]) => {
    dispatch({
      type: 'SET_CASCADED',
      payload: {
        preset: preset.id as 'aws-opinionated' | '3p-opinionated',
        sttProvider: preset.stt,
        llmProvider: preset.llm,
        ttsProvider: preset.tts,
      },
    });
    dispatch({
      type: 'SET_MODEL',
      payload: mapModelIds(preset.stt, preset.llm, preset.tts),
    });
  };

  return (
    <PageWrapper
      title="Cascaded Workflow Configuration"
      subtitle="Choose your STT, LLM, and TTS models. Use a preset or customize individually."
      steps={steps}
      onNext={() => navigate('/prompt-builder')}
      onBack={() => navigate('/pipeline')}
    >
      <div className={styles.container}>
        <div className={styles.section}>
          <label className={styles.label}>Quick Presets</label>
          <div className={styles.presets}>
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                className={`${styles.presetCard} ${
                  state.cascaded.preset === preset.id ? styles.selected : ''
                }`}
                onClick={() => applyPreset(preset)}
              >
                <strong>{preset.label}</strong>
                <span>{preset.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={styles.divider}>
          <span>or customize individually</span>
        </div>

        <div className={styles.modelGrid}>
          <div className={styles.modelSection}>
            <label className={styles.label}>
              Speech-to-Text (STT)
            </label>
            <div className={styles.modelOptions}>
              {STT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  className={`${styles.modelBtn} ${
                    state.cascaded.sttProvider === opt.id
                      ? styles.modelSelected
                      : ''
                  }`}
                  onClick={() =>
                    dispatch({
                      type: 'SET_CASCADED',
                      payload: { sttProvider: opt.id, preset: 'custom' },
                    })
                  }
                >
                  <span className={styles.modelLabel}>{opt.label}</span>
                  <span className={styles.providerBadge}>{opt.provider}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={styles.modelSection}>
            <label className={styles.label}>
              Large Language Model (LLM)
            </label>
            <div className={styles.modelOptions}>
              {LLM_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  className={`${styles.modelBtn} ${
                    state.cascaded.llmProvider === opt.id
                      ? styles.modelSelected
                      : ''
                  }`}
                  onClick={() =>
                    dispatch({
                      type: 'SET_CASCADED',
                      payload: { llmProvider: opt.id, preset: 'custom' },
                    })
                  }
                >
                  <span className={styles.modelLabel}>{opt.label}</span>
                  <span className={styles.providerBadge}>{opt.provider}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={styles.modelSection}>
            <label className={styles.label}>
              Text-to-Speech (TTS)
            </label>
            <div className={styles.modelOptions}>
              {TTS_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  className={`${styles.modelBtn} ${
                    state.cascaded.ttsProvider === opt.id
                      ? styles.modelSelected
                      : ''
                  }`}
                  onClick={() =>
                    dispatch({
                      type: 'SET_CASCADED',
                      payload: { ttsProvider: opt.id, preset: 'custom' },
                    })
                  }
                >
                  <span className={styles.modelLabel}>{opt.label}</span>
                  <span className={styles.providerBadge}>{opt.provider}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.pipelinePreview}>
          <span className={styles.pipelineNode}>
            {STT_OPTIONS.find((o) => o.id === state.cascaded.sttProvider)?.label}
          </span>
          <span className={styles.pipelineArrow}>→</span>
          <span className={styles.pipelineNode}>
            {LLM_OPTIONS.find((o) => o.id === state.cascaded.llmProvider)?.label}
          </span>
          <span className={styles.pipelineArrow}>→</span>
          <span className={styles.pipelineNode}>
            {TTS_OPTIONS.find((o) => o.id === state.cascaded.ttsProvider)?.label}
          </span>
        </div>
      </div>
    </PageWrapper>
  );
}

export default CascadedSpeech;
