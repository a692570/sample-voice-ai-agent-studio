import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Sidebar from './Sidebar';
import AutoSaveIndicator from './AutoSaveIndicator';
import styles from './Layout.module.css';

function Layout() {
  const { user, logout } = useAuth();
  const [archOpen, setArchOpen] = useState(false);
  const [archTab, setArchTab] = useState<'solution' | 'stack'>('solution');

  return (
    <div className={styles.layout}>
      <div className={styles.body}>
        <Sidebar user={user} logout={logout} onArchOpen={() => setArchOpen(true)} />
        <main className={styles.main}>
          <Outlet />
        </main>
      </div>
      <AutoSaveIndicator />

      {/* Architecture Diagram Modal */}
      {archOpen && (
        <div className={styles.modal} onClick={() => setArchOpen(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.archTabs}>
                <button
                  className={`${styles.archTab} ${archTab === 'solution' ? styles.archTabActive : ''}`}
                  onClick={() => setArchTab('solution')}
                >
                  Solution Architecture
                </button>
                <button
                  className={`${styles.archTab} ${archTab === 'stack' ? styles.archTabActive : ''}`}
                  onClick={() => setArchTab('stack')}
                >
                  Voice Agent Stack
                </button>
              </div>
              <button className={styles.modalClose} onClick={() => setArchOpen(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className={styles.modalBody}>
              {archTab === 'solution' ? (
                <img
                  src="/images/architecture.png"
                  alt="Solution Architecture Diagram"
                  style={{ width: '100%', height: 'auto', borderRadius: '8px' }}
                />
              ) : (
                <img
                  src="/images/voice-agent-stack.png"
                  alt="Voice Agent Stack Diagram"
                  style={{ width: '100%', height: 'auto', borderRadius: '8px' }}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Layout;
