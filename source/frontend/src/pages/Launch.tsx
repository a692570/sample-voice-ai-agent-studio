import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWizard, HostType, FrameworkType } from '../context/WizardContext';
import TEMPLATES, { TemplateConfig } from '../config/templates';
import styles from './Launch.module.css';

function Launch() {
  const navigate = useNavigate();
  const { dispatch } = useWizard();

  // Reset wizard state when creating a new agent to avoid overwriting an existing one
  useEffect(() => {
    dispatch({ type: 'RESET' });
    sessionStorage.removeItem('poc_editing_demo_id');
    sessionStorage.removeItem('poc_editing_demo_name');
  }, []);

  const handleSelectTemplate = (template: TemplateConfig) => {
    // Pre-fill all wizard state from the template config
    dispatch({ type: 'SET_HOST', payload: template.host as HostType });
    dispatch({ type: 'SET_FRAMEWORK', payload: template.framework as FrameworkType });
    dispatch({ type: 'SET_MODEL', payload: template.model });
    dispatch({
      type: 'SET_PIPELINE',
      payload: template.pipeline,
    });
    dispatch({
      type: 'SET_VOICE',
      payload: template.voice,
    });
    dispatch({
      type: 'SET_AGENTS',
      payload: { selectedAgents: template.tools },
    });
    dispatch({
      type: 'SET_PROMPT',
      payload: {
        greeting: '',
        instructions: template.systemPrompt,
      },
    });
    if (template.workflow) {
      dispatch({ type: 'SET_WORKFLOW', payload: template.workflow });
    }
    navigate('/home');
  };

  const handleSkip = () => {
    navigate('/start');
  };

  return (
    <div className={styles.container}>
      <div className={styles.hero}>
        <h1 className={styles.title}>Choose an Industry Template</h1>
      </div>

      <div className={styles.grid}>
        {TEMPLATES.map((template) => (
          <button
            key={template.id}
            className={styles.card}
            onClick={() => handleSelectTemplate(template)}
          >
            <div
              className={styles.cardImage}
              style={{ backgroundImage: `url(${template.image})` }}
            >
              <span className={styles.sector}>{template.sector}</span>
              <div className={styles.cardOverlay}>
                <p>{template.description}</p>
              </div>
            </div>
            <div className={styles.cardBody}>
              <h3 className={styles.cardTitle}>{template.useCase}</h3>
              <div className={styles.cardMeta}>
                <span className={styles.metaItem}>{template.host}</span>
                <span className={styles.metaItem}>{template.framework}</span>
              </div>
              <div className={styles.cardMeta}>
                <span className={styles.metaItem}>
                  {template.model.join(', ')}
                </span>
                <span className={styles.metaItem}>
                  {template.tools.length} tools
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className={styles.footer}>
        <button className={styles.skipBtn} onClick={handleSkip}>
          Skip — Start from scratch →
        </button>
      </div>
    </div>
  );
}

export default Launch;
