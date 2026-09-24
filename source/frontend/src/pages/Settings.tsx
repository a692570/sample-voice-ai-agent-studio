import { useFilter } from '../context/FilterContext';

function Settings() {
  const { showOnlyMine, setShowOnlyMine } = useFilter();

  return (
    <div style={{ width: '100%' }}>
      <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>Settings</h1>
      <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '28px' }}>
        Manage your workspace preferences.
      </p>

      {/* Display Preferences */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '16px' }}>Display Preferences</div>
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '20px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={showOnlyMine}
              onChange={(e) => setShowOnlyMine(e.target.checked)}
              style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#6366f1' }}
            />
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>Show only my items</div>
              <div style={{ fontSize: '13px', color: '#64748b', marginTop: '2px' }}>Filter all lists (agents, tools, eval suites, etc.) to show only items you created.</div>
            </div>
          </label>
        </div>
      </div>

      {/* Telephony credentials note */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '16px' }}>Telephony &amp; Integrations</div>
        <div style={{ background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '10px', padding: '16px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '2px' }}>
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>
            <p style={{ fontSize: '13px', fontWeight: 600, color: '#3730a3', marginBottom: '4px' }}>Credentials are not stored in the app</p>
            <p style={{ fontSize: '13px', color: '#4338ca', lineHeight: 1.6 }}>
              Provider credentials (Twilio, SIP trunks, and other integrations) are never entered or stored in
              this UI. The telephony bridges are deployed separately and read their configuration from AWS
              Secrets Manager — run <code>telephony/pstn/configure.sh</code> or{' '}
              <code>telephony/sip/configure.sh</code> to set them up. Map numbers to agents on the{' '}
              <a href="/telephony/phone-numbers" style={{ color: '#6366f1', fontWeight: 500 }}>Phone Numbers</a>{' '}
              page.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Settings;
