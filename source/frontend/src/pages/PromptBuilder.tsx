import { useNavigate } from 'react-router-dom';
import { useWizard } from '../context/WizardContext';
import PageWrapper from '../components/PageWrapper';
import styles from './PromptBuilder.module.css';

function PromptBuilder() {
  const navigate = useNavigate();
  const { state, dispatch } = useWizard();

  const getSteps = () => {
    if (state.path === 'minimal') {
      return [
        { label: 'Voice', active: false, completed: true },
        { label: 'Flow', active: false, completed: true },
        { label: 'Prompt', active: true, completed: false },
        { label: 'Summary', active: false, completed: false },
        { label: 'Try It', active: false, completed: false },
      ];
    }
    return [
      { label: 'Pipeline', active: false, completed: true },
      { label: 'Model', active: false, completed: true },
      { label: 'Voice', active: false, completed: true },
      { label: 'Flow', active: false, completed: true },
      { label: 'Prompt', active: true, completed: false },
      { label: 'Summary', active: false, completed: false },
      { label: 'Try It', active: false, completed: false },
    ];
  };

  const handleNext = () => {
    navigate('/summary');
  };

  const handleBack = () => {
    navigate('/tools-selection');
  };

  const isValid = state.prompt.instructions.trim() !== '';

  return (
    <PageWrapper
      title="Prompt Builder"
      subtitle="Configure the greeting and system instructions for your voice agent."
      steps={getSteps()}
      onNext={handleNext}
      onBack={handleBack}
      nextDisabled={!isValid}
    >
      <div className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="greeting">
            How should the agent greet callers?
          </label>
          <input
            id="greeting"
            className={styles.input}
            type="text"
            placeholder="e.g. Hi, thank you for calling Acme Healthcare. How can I help you today?"
            value={state.prompt.greeting}
            onChange={(e) =>
              dispatch({
                type: 'SET_PROMPT',
                payload: { greeting: e.target.value },
              })
            }
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>
            Agent speaks first
          </label>
          <div className={styles.toggleRow}>
            <label className={styles.switch}>
              <input
                type="checkbox"
                checked={state.agentStartFirst}
                onChange={(e) =>
                  dispatch({ type: 'SET_AGENT_START_FIRST', payload: e.target.checked })
                }
              />
              <span className={styles.slider} />
            </label>
            <span className={styles.toggleLabel}>
              {state.agentStartFirst
                ? 'Agent will greet the user first when the session starts'
                : 'Agent waits for the user to speak first'}
            </span>
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="instructions">
            System Instructions *
          </label>
          <textarea
            id="instructions"
            className={styles.textarea}
            placeholder="The full system prompt / instructions for how the agent should behave..."
            value={state.prompt.instructions}
            onChange={(e) =>
              dispatch({
                type: 'SET_PROMPT',
                payload: { instructions: e.target.value },
              })
            }
            rows={8}
          />
        </div>

        <div className={styles.preview}>
          <h4 className={styles.previewTitle}>Prompt Preview</h4>
          <pre className={styles.previewContent}>
            {generatePromptPreview(state.prompt)}
          </pre>
        </div>
      </div>
    </PageWrapper>
  );
}

function generatePromptPreview(prompt: {
  greeting: string;
  instructions: string;
}) {
  const parts: string[] = [];

  if (prompt.greeting) {
    parts.push(`Greeting: "${prompt.greeting}"`);
  }

  if (prompt.instructions) {
    parts.push(`\n${prompt.instructions}`);
  }

  return parts.join('\n') || 'Fill in the fields above to generate a prompt...';
}

export default PromptBuilder;
