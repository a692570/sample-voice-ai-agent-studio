import { useNavigate } from 'react-router-dom';
import { useWizard } from '../context/WizardContext';
import PageWrapper from '../components/PageWrapper';
import styles from './PipelineSelection.module.css';

function PipelineSelection() {
  const navigate = useNavigate();
  const { state, dispatch } = useWizard();

  const steps = [
    { label: 'Pipeline', active: true, completed: false },
    { label: 'Model', active: false, completed: false },
    { label: 'Voice', active: false, completed: false },
    { label: 'Flow', active: false, completed: false },
    { label: 'Summary', active: false, completed: false },
    { label: 'POC', active: false, completed: false },
  ];

  const handleNext = () => {
    if (state.pipeline === 'speech-to-speech') {
      navigate('/speech-to-speech');
    } else {
      navigate('/cascaded');
    }
  };

  return (
    <PageWrapper
      title="Pipeline Selection"
      subtitle="Choose the architecture for your voice AI pipeline."
      steps={steps}
      onNext={handleNext}
      onBack={() => navigate('/home')}
      nextDisabled={!state.pipeline}
    >
      <div className={styles.options}>
        <button
          className={`${styles.card} ${
            state.pipeline === 'speech-to-speech' ? styles.selected : ''
          }`}
          onClick={() =>
            dispatch({ type: 'SET_PIPELINE', payload: 'speech-to-speech' })
          }
        >
          <div className={styles.cardHeader}>
            <div className={styles.icon}><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></div>
            <h3 className={styles.cardTitle}>Bidirectional Streaming</h3>
          </div>
          <p className={styles.cardDesc}>
            End-to-end speech model using Amazon Nova Sonic. Lowest latency,
            simplest architecture. Audio & text in → Audio & text out in a single model.
          </p>
          <div className={styles.cardDiagram}>
            <span className={styles.node}>Audio & Text In</span>
            <span className={styles.arrow}>→</span>
            <span className={styles.nodeHighlight}>Nova Sonic</span>
            <span className={styles.arrow}>→</span>
            <span className={styles.node}>Audio & Text Out</span>
          </div>
        </button>

        {/* Cascaded Workflow — temporarily hidden */}
        {/* <button
          className={`${styles.card} ${
            state.pipeline === 'cascaded' ? styles.selected : ''
          }`}
          onClick={() =>
            dispatch({ type: 'SET_PIPELINE', payload: 'cascaded' })
          }
        >
          <div className={styles.cardHeader}>
            <div className={styles.icon}><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg></div>
            <h3 className={styles.cardTitle}>Cascaded Workflow</h3>
          </div>
          <p className={styles.cardDesc}>
            Separate STT → LLM → TTS pipeline. More model flexibility with
            mix-and-match providers. Higher latency but maximum control.
          </p>
          <div className={styles.cardDiagram}>
            <span className={styles.node}>STT</span>
            <span className={styles.arrow}>→</span>
            <span className={styles.node}>LLM</span>
            <span className={styles.arrow}>→</span>
            <span className={styles.node}>TTS</span>
          </div>
        </button> */}
      </div>
    </PageWrapper>
  );
}

export default PipelineSelection;
