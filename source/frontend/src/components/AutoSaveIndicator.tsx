import { useAutoSaveStatus } from '../context/AutoSaveContext';
import styles from './AutoSaveIndicator.module.css';

/**
 * Small floating indicator that shows auto-save status.
 * Only visible when actively saving, just saved, or on error.
 */
function AutoSaveIndicator() {
  const status = useAutoSaveStatus();

  if (status === 'idle') return null;

  return (
    <div className={`${styles.indicator} ${styles[status]}`}>
      {status === 'saving' && (
        <>
          <span className={styles.spinner} />
          <span>Saving...</span>
        </>
      )}
      {status === 'saved' && (
        <>
          <span className={styles.checkmark}>✓</span>
          <span>Saved</span>
        </>
      )}
      {status === 'error' && (
        <>
          <span className={styles.errorIcon}>⚠</span>
          <span>Save failed</span>
        </>
      )}
    </div>
  );
}

export default AutoSaveIndicator;
