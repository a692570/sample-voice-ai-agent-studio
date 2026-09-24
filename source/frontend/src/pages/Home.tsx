import { useNavigate } from 'react-router-dom';
import { useWizard } from '../context/WizardContext';
import styles from './Home.module.css';

function Home() {
  const navigate = useNavigate();
  const { dispatch } = useWizard();

  const handleMinimalPath = () => {
    dispatch({ type: 'SET_PATH', payload: 'minimal' });
    dispatch({ type: 'SET_PIPELINE', payload: 'speech-to-speech' });
    navigate('/voice-1s');
  };

  const handleSomeTechnicalPath = () => {
    dispatch({ type: 'SET_PATH', payload: 'some-technical' });
    navigate('/pipeline');
  };

  return (
    <div className={styles.container}>
      <div className={styles.hero}>
        <button className={styles.backLink} onClick={() => navigate('/')}>
          ← Back to Templates
        </button>
        <h1 className={styles.title}>Configure Your Voice Agent</h1>
        <p className={styles.subtitle}>
          Choose a path based on how much control you need over the architecture.
          Both paths produce a working voice agent you can test immediately.
        </p>
      </div>

      <div className={styles.cards}>
        <button className={styles.card} onClick={handleMinimalPath}>
          <span className={styles.cardTag}>Recommended</span>
          <div className={styles.cardHeader}>
            <div className={styles.cardIconWrap}>
              <span className={styles.cardIcon}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></span>
            </div>
            <div className={styles.cardBadges}>
              <span className={styles.badge}>Nova Sonic</span>
              <span className={styles.badge}>5 min</span>
            </div>
          </div>
          <h2 className={styles.cardTitle}>Quick Setup</h2>
          <p className={styles.cardDesc}>
            Deploy a Nova Sonic voice agent with minimal configuration. Pick a voice, 
            select tools, write your prompt — done.
          </p>
          <div className={styles.cardSteps}>
            <span className={styles.step}>Voice</span>
            <span className={styles.stepArrow}>→</span>
            <span className={styles.step}>Tools</span>
            <span className={styles.stepArrow}>→</span>
            <span className={styles.step}>Prompt</span>
            <span className={styles.stepArrow}>→</span>
            <span className={styles.step}>Try It</span>
          </div>
        </button>

        <button className={styles.card} onClick={handleSomeTechnicalPath}>
          <span className={styles.cardTagSecondary}>Advanced</span>
          <div className={styles.cardHeader}>
            <div className={styles.cardIconWrap}>
              <span className={styles.cardIcon}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></span>
            </div>
            <div className={styles.cardBadges}>
              <span className={styles.badge}>Multi-model</span>
              <span className={styles.badge}>Telephony</span>
            </div>
          </div>
          <h2 className={styles.cardTitle}>Custom Pipeline</h2>
          <p className={styles.cardDesc}>
            Choose between Speech-to-Speech or Cascaded (STT → LLM → TTS). 
            Full control over model selection and telephony integration.
          </p>
          <div className={styles.cardSteps}>
            <span className={styles.step}>Pipeline</span>
            <span className={styles.stepArrow}>→</span>
            <span className={styles.step}>Models</span>
            <span className={styles.stepArrow}>→</span>
            <span className={styles.step}>Voice</span>
            <span className={styles.stepArrow}>→</span>
            <span className={styles.step}>Phone</span>
            <span className={styles.stepArrow}>→</span>
            <span className={styles.step}>Try It</span>
          </div>
        </button>
      </div>
    </div>
  );
}

export default Home;
