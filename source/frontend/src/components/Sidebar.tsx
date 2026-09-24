import { useState, useEffect, useCallback } from 'react';
import { NavLink, useNavigate, useLocation, Link, useMatch } from 'react-router-dom';
import { listDemos, getDemo } from '../services/demosApi';
import type { Demo } from '../services/demosApi';
import { listEvalSuites } from '../services/evalSuitesApi';
import type { EvalSuite } from '../services/evalSuitesApi';
import { useWizard } from '../context/WizardContext';
import type { HostType, FrameworkType, PipelineType } from '../context/WizardContext';
import { useFilter } from '../context/FilterContext';
import { onAgentListChanged } from '../events/agentEvents';
import styles from './Sidebar.module.css';

interface SidebarProps {
  user?: { email: string; username?: string } | null;
  logout?: () => void;
  onArchOpen?: () => void;
}

function Sidebar({ user, logout, onArchOpen }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [integrationsOpen, setIntegrationsOpen] = useState(true);
  const [telephonyOpen, setTelephonyOpen] = useState(true);
  const [demos, setDemos] = useState<Demo[]>([]);
  const [evalSuites, setEvalSuites] = useState<EvalSuite[]>([]);
  const [showMoreAgents, setShowMoreAgents] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { dispatch } = useWizard();
  const { showOnlyMine } = useFilter();

  const loadAgentIntoWizard = useCallback(async (agentId: string) => {
    try {
      const demo = await getDemo(agentId);
      const config = demo.config;
      dispatch({ type: 'SET_HOST', payload: (config.host || 'agentcore') as HostType });
      dispatch({ type: 'SET_FRAMEWORK', payload: (config.framework || 'strands-bidiagent') as FrameworkType });
      dispatch({ type: 'SET_MODEL', payload: config.model || ['nova-2-sonic'] });
      dispatch({ type: 'SET_PIPELINE', payload: (config.pipeline || 'speech-to-speech') as PipelineType });
      dispatch({ type: 'SET_VOICE', payload: config.voice || { voiceId: '', language: 'en-US', gender: 'female' } });
      dispatch({ type: 'SET_AGENTS', payload: { selectedAgents: config.tools || [], customTools: config.customTools || [] } });
      dispatch({ type: 'SET_PROMPT', payload: config.prompt || { greeting: config.greeting || '', instructions: config.systemPrompt || '' } });
      dispatch({ type: 'SET_TELEPHONY_ENABLED', payload: config.telephonyEnabled ?? false });
      dispatch({ type: 'SET_AGENT_START_FIRST', payload: config.agentStartFirst ?? true });
      dispatch({ type: 'SET_PHONE', payload: config.telephony?.phoneNumber || '' });
      dispatch({ type: 'SET_USE_MOCK', payload: config.useMock ?? true });
    } catch { /* ignore */ }
  }, [dispatch]);

  const refreshDemos = useCallback(() => {
    listDemos().then((data) => {
      // Sort by createdAt descending to match agent list default
      data.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      setDemos(data);
    }).catch(() => {});
  }, []);

  const refreshEvalSuites = useCallback(() => {
    listEvalSuites().then((data) => {
      data.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      setEvalSuites(data);
    }).catch(() => {});
  }, []);

  // Detect if an agent detail page is active — persist when navigating to wizard pages
  const agentMatch = useMatch('/agents/:id/*');
  const [persistedAgentId, setPersistedAgentId] = useState<string | null>(null);
  const activeAgentId = agentMatch?.params.id || persistedAgentId;

  // Track wizard pages that belong to an agent edit session
  const WIZARD_PATHS = ['/voice-1s', '/prompt-builder', '/tools-selection', '/pipeline', '/speech-to-speech', '/summary', '/poc'];
  const isOnWizardPage = WIZARD_PATHS.some(p => location.pathname === p);

  useEffect(() => {
    if (agentMatch?.params.id) {
      setPersistedAgentId(agentMatch.params.id);
    } else if (!isOnWizardPage) {
      // Clear persisted ID when navigating away from both agent and wizard pages
      setPersistedAgentId(null);
    }
  }, [agentMatch?.params.id, isOnWizardPage]);

  const AGENT_TABS = [
    { id: 'summary', label: 'Summary', path: '/summary', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#777" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>', wizardPath: '' },
    { id: 'workflow', label: 'Conversation Flow', path: '/workflow', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#777" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>', wizardPath: '' },
    { id: 'history', label: 'Call History', path: '/conversations', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#777" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>', wizardPath: '' },
  ];

  useEffect(() => {
    refreshDemos();
    refreshEvalSuites();
  }, [location.pathname, refreshDemos, refreshEvalSuites]);

  useEffect(() => {
    return onAgentListChanged(refreshDemos);
  }, [refreshDemos]);

  return (
    <>
      <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`}>
        {/* Logo / Title at top */}
        {!collapsed && (
          <div className={styles.logoSection}>
            <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none', color: 'inherit', flex: 1, minWidth: 0 }}>
              <img src="/favicon.svg" alt="Logo" width="30" height="30" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.3px', lineHeight: 1.3 }}>
                Conversational AI Agent Studio
                {onArchOpen && (
                  <button
                    onClick={(e) => { e.preventDefault(); onArchOpen(); }}
                    title="Architecture Diagram"
                    style={{ background: 'none', border: 'none', padding: '2px', color: '#94a3b8', cursor: 'pointer', verticalAlign: 'middle', marginLeft: '2px', display: 'inline-flex' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
                    </svg>
                  </button>
                )}
              </span>
            </Link>
            <button
              onClick={() => setCollapsed(!collapsed)}
              aria-label="Collapse sidebar"
              style={{ background: 'none', border: 'none', padding: '4px', color: '#94a3b8', cursor: 'pointer', flexShrink: 0 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          </div>
        )}
        {collapsed && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 0', gap: '8px' }}>
            <Link to="/" style={{ display: 'flex', justifyContent: 'center' }}>
              <img src="/favicon.svg" alt="Logo" width="28" height="28" />
            </Link>
            <button
              onClick={() => setCollapsed(!collapsed)}
              aria-label="Expand sidebar"
              style={{ background: 'none', border: 'none', padding: '4px', color: '#94a3b8', cursor: 'pointer' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        )}

        {!collapsed && (
          <nav className={styles.nav}>
            {/* Agents section */}
            <div className={styles.sectionHeader} style={{ cursor: 'pointer' }} onClick={() => navigate('/agents')}>
              <span className={styles.sectionTitle}>Agents</span>
              <NavLink to="/launch" onClick={(e) => e.stopPropagation()} style={{ fontSize: '16px', color: '#888', textDecoration: 'none', lineHeight: 1, width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #ddd', borderRadius: '5px' }} title="Create new agent">+</NavLink>
            </div>
            <div className={styles.sectionContent}>
              {(() => {
                const filtered = showOnlyMine && user?.email ? demos.filter(d => d.userEmail === user.email) : demos;
                if (filtered.length === 0) {
                  return (
                    <NavLink
                      to='/agents'
                      className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
                    >
                      No agents yet
                    </NavLink>
                  );
                }
                const visible = filtered.slice(0, 4);
                const hasMore = filtered.length > 4;
                return (
                  <>
                    {visible.map((demo) => (
                      <NavLink
                        key={demo.id}
                        to={`/agents/${demo.id}/summary`}
                        className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
                        title={demo.name}
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#777" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{demo.name}</span>
                      </NavLink>
                    ))}
                    {hasMore && (
                      <NavLink
                        to="/agents"
                        className={styles.navItem}
                        style={{ color: '#6366f1', fontSize: '12px' }}
                      >
                        View all {filtered.length} agents →
                      </NavLink>
                    )}
                  </>
                );
              })()}
            </div>

            {/* Agent detail sub-tabs — shown when an agent is selected */}
            {activeAgentId && (
              <div className={styles.sectionContent} style={{ marginTop: '-14px', paddingLeft: '12px', borderLeft: '2px solid #e2e8f0', marginLeft: '16px' }}>
                {AGENT_TABS.map((tab) => (
                  tab.id === 'divider' ? (
                    <div key="divider" style={{ height: '1px', background: '#e2e8f0', margin: '6px 0' }} />
                  ) : tab.wizardPath ? (
                    <a
                      key={tab.id}
                      onClick={async (e) => {
                        e.preventDefault();
                        await loadAgentIntoWizard(activeAgentId!);
                        navigate(tab.wizardPath);
                      }}
                      href={tab.wizardPath}
                      className={styles.navItem}
                      style={{ fontSize: '13px', padding: '3px 10px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', textDecoration: 'none', color: 'inherit' }}
                    >
                      <span dangerouslySetInnerHTML={{ __html: tab.icon }} style={{ display: 'flex', flexShrink: 0 }} />
                      {tab.label}
                    </a>
                  ) : (
                    <NavLink
                      key={tab.id}
                      to={`/agents/${activeAgentId}${tab.path}`}
                      end={tab.path === ''}
                      className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
                      style={{ fontSize: '13px', padding: '3px 10px', display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                      <span dangerouslySetInnerHTML={{ __html: tab.icon }} style={{ display: 'flex', flexShrink: 0 }} />
                      {tab.label}
                    </NavLink>
                  )
                ))}
              </div>
            )}

            {/* Eval Suites Section */}
            <div className={styles.sectionHeader} style={{ cursor: 'pointer' }} onClick={() => navigate('/eval-suites')}>
              <span className={styles.sectionTitle}>Eval Suites</span>
            </div>
            <div className={styles.sectionContent}>
              {(() => {
                const filteredSuites = showOnlyMine && user?.email ? evalSuites.filter(s => s.userEmail === user.email) : evalSuites;
                if (filteredSuites.length === 0) {
                  return (
                    <NavLink
                      to='/eval-suites'
                      className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
                    >
                      No suites yet
                    </NavLink>
                  );
                }
                return (
                  <>
                    {filteredSuites.slice(0, 4).map((suite) => (
                      <NavLink
                        key={suite.id}
                        to={`/eval-suites/${suite.id}`}
                        className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
                        title={suite.name}
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#777" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{suite.name}</span>
                      </NavLink>
                    ))}
                    {filteredSuites.length > 4 && (
                      <NavLink
                        to="/eval-suites"
                        className={styles.navItem}
                        style={{ color: '#6366f1', fontSize: '12px' }}
                      >
                        View all {filteredSuites.length} suites →
                      </NavLink>
                    )}
                  </>
                );
              })()}
            </div>

            {/* Integrations Section */}
            <div className={styles.section}>
              <button
                className={styles.sectionHeader}
                onClick={() => setIntegrationsOpen(!integrationsOpen)}
                aria-expanded={integrationsOpen}
              >
                <span className={styles.sectionTitle}>Configure</span>
                <span className={`${styles.chevron} ${integrationsOpen ? styles.chevronOpen : ''}`}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </span>
              </button>
              {integrationsOpen && (
                <div className={styles.sectionContent}>
                  <NavLink
                    to="/integrations/rag"
                    className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#777" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                    Knowledge Bases
                  </NavLink>
                  <NavLink
                    to="/integrations/tools"
                    className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#777" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
                    Tools
                  </NavLink>
                  <NavLink
                    to="/integrations/skills"
                    className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#777" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                    Skills
                  </NavLink>
                  <NavLink
                    to="/integrations/sub-agents"
                    className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#777" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                    Sub Agents
                  </NavLink>
                </div>
              )}
            </div>

            {/* Telephony Section */}
            <div className={styles.section}>
              <button
                className={styles.sectionHeader}
                onClick={() => setTelephonyOpen(!telephonyOpen)}
                aria-expanded={telephonyOpen}
              >
                <span className={styles.sectionTitle}>Telephony</span>
                <span className={`${styles.chevron} ${telephonyOpen ? styles.chevronOpen : ''}`}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </span>
              </button>
              {telephonyOpen && (
                <div className={styles.sectionContent}>
                  <NavLink to="/telephony/twilio" className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#777" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                    PSTN
                  </NavLink>
                  <NavLink to="/telephony/sip" className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#777" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="10" rx="2" ry="2"/><line x1="6" y1="11" x2="6.01" y2="11"/><line x1="10" y1="11" x2="10.01" y2="11"/><line x1="14" y1="11" x2="14.01" y2="11"/></svg>
                    SIP
                  </NavLink>
                  <NavLink to="/telephony/phone-numbers" className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#777" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 2 5a2 2 0 0 1 2-2"/><line x1="15" y1="2" x2="15" y2="8"/><line x1="12" y1="5" x2="18" y2="5"/></svg>
                    Phone Numbers
                  </NavLink>
                </div>
              )}
            </div>

            {/* Settings */}
            <NavLink
              to="/settings"
              className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
              style={{ marginTop: '8px' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#777" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              Settings
            </NavLink>
          </nav>
        )}

        {/* User section at bottom */}
        {!collapsed && user && (
          <div className={styles.userSection}>
            <button
              className={styles.signOutBtn}
              onClick={logout}
              title={`${user.email} — Click to sign out`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
            <span className={styles.userEmail}>{user.username || user.email}</span>
          </div>
        )}
      </aside>
    </>
  );
}

export default Sidebar;
