import { useEffect, useState } from 'react';
import {
  listPhoneMappings,
  upsertPhoneMapping,
  deletePhoneMapping,
  getTelephonyConfigStatus,
  type PhoneMapping,
  type PhoneProvider,
  type TelephonyConfigStatus,
} from '../../services/phoneMappingsApi';
import { listDemos, type Demo } from '../../services/demosApi';

const PROVIDER_LABELS: Record<PhoneProvider, string> = {
  pstn: 'PSTN (Twilio Conversation Relay)',
  sip: 'SIP Trunk / Chime SDK',
};

const emptyForm = { phoneNumber: '', demoId: '', provider: 'pstn' as PhoneProvider };

function PhoneNumbers() {
  const [mappings, setMappings] = useState<PhoneMapping[]>([]);
  const [agents, setAgents] = useState<Demo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingPhone, setEditingPhone] = useState<string | null>(null);
  const [configStatus, setConfigStatus] = useState<TelephonyConfigStatus>({ pstn: false, sip: false });

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [m, a, status] = await Promise.all([
        listPhoneMappings(),
        listDemos(),
        getTelephonyConfigStatus().catch(() => ({ pstn: false, sip: false })),
      ]);
      setMappings(m);
      setAgents(a);
      setConfigStatus(status);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load phone mappings');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  function resetForm() {
    setForm(emptyForm);
    setEditingPhone(null);
  }

  function startEdit(m: PhoneMapping) {
    setForm({ phoneNumber: m.phoneNumber, demoId: m.demoId, provider: m.provider });
    setEditingPhone(m.phoneNumber);
  }

  async function handleSave() {
    const phone = form.phoneNumber.trim();
    if (!phone || !form.demoId) {
      setError('Phone number and agent are required.');
      return;
    }
    // The provider's bridge must be configured (its Secrets Manager config
    // exists) before a number can be mapped to it.
    if (!configStatus[form.provider]) {
      setError(
        `${form.provider.toUpperCase()} is not configured yet. Run telephony/${form.provider}/configure.sh first, then refresh.`
      );
      return;
    }
    // E.164: a leading "+" followed by 8–15 digits. Rejects the placeholder /
    // half-typed input that would otherwise collide on one key.
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
      setError('Enter a valid phone number in E.164 format, e.g. +15551234567.');
      return;
    }
    // When adding (not editing), block a number that is already mapped so a new
    // entry can't silently overwrite an existing one.
    if (!editingPhone && mappings.some((m) => m.phoneNumber === phone)) {
      setError(`${phone} is already mapped. Edit the existing entry instead.`);
      return;
    }
    // An agent can have at most one number per provider (one PSTN, one SIP).
    // Block adding/reassigning a second number of the same provider to an agent
    // that already has one (ignore the row currently being edited).
    const conflict = mappings.find(
      (m) =>
        m.demoId === form.demoId &&
        m.provider === form.provider &&
        m.phoneNumber !== editingPhone
    );
    if (conflict) {
      const agent = agents.find((a) => a.id === form.demoId);
      setError(
        `${agent?.name || 'This agent'} already has a ${form.provider.toUpperCase()} number (${conflict.phoneNumber}). ` +
          `Only one ${form.provider.toUpperCase()} number is allowed per agent — remove or edit that mapping first.`
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const agent = agents.find((a) => a.id === form.demoId);
      await upsertPhoneMapping(phone, {
        demoId: form.demoId,
        demoName: agent?.name || '',
        provider: form.provider,
        label: PROVIDER_LABELS[form.provider],
      });
      resetForm();
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save mapping');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(phone: string) {
    if (!confirm(`Remove the mapping for ${phone}?`)) return;
    setError(null);
    try {
      await deletePhoneMapping(phone);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete mapping');
    }
  }

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name || id || '—';

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#0f172a' }}>Phone Numbers</h1>
        <button
          onClick={loadAll}
          style={{ padding: '8px 16px', background: '#fff', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
        >
          Refresh
        </button>
      </div>
      <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '24px' }}>
        Map a phone number to a voice agent. Provision the number with your telephony provider (Twilio PSTN
        or a SIP trunk), deploy the telephony bridge separately, then add the mapping here so incoming calls
        route to the right agent.
      </p>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', fontSize: '13px', color: '#b91c1c' }}>
          {error}
        </div>
      )}

      {!loading && !configStatus.pstn && !configStatus.sip && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', fontSize: '13px', color: '#a16207' }}>
          No telephony provider is configured yet. Run <code>telephony/pstn/configure.sh</code> or{' '}
          <code>telephony/sip/configure.sh</code> to set up a bridge, then refresh. You can't map a number to a
          provider until it's configured.
        </div>
      )}

      {/* Add / edit form */}
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', marginBottom: '20px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', marginBottom: '12px' }}>
          {editingPhone ? `Edit mapping for ${editingPhone}` : 'Add phone number mapping'}
        </div>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '12px', color: '#64748b' }}>Phone number (E.164)</label>
            <input
              value={form.phoneNumber}
              onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })}
              placeholder="+15551234567"
              disabled={!!editingPhone}
              style={{ padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '13px', fontFamily: 'monospace', width: '200px', background: editingPhone ? '#f1f5f9' : '#fff' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '12px', color: '#64748b' }}>Provider</label>
            <select
              value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value as PhoneProvider })}
              style={{ padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '13px', background: '#fff' }}
            >
              <option value="pstn">{PROVIDER_LABELS.pstn}{configStatus.pstn ? '' : ' — not configured'}</option>
              <option value="sip">{PROVIDER_LABELS.sip}{configStatus.sip ? '' : ' — not configured'}</option>
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '12px', color: '#64748b' }}>Agent</label>
            <select
              value={form.demoId}
              onChange={(e) => setForm({ ...form, demoId: e.target.value })}
              style={{ padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '13px', background: '#fff', minWidth: '200px' }}
            >
              <option value="">— Select an agent —</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ padding: '8px 16px', background: '#6366f1', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? 'Saving…' : editingPhone ? 'Update' : 'Add'}
          </button>
          {editingPhone && (
            <button
              onClick={resetForm}
              style={{ padding: '8px 16px', background: '#fff', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Mappings table */}
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden', marginBottom: '20px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Phone Number</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Provider</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Agent</th>
              <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} style={{ padding: '16px', fontSize: '13px', color: '#94a3b8' }}>Loading…</td></tr>
            ) : mappings.length === 0 ? (
              <tr><td colSpan={4} style={{ padding: '16px', fontSize: '13px', color: '#94a3b8' }}>No phone numbers mapped yet. Add one above.</td></tr>
            ) : (
              mappings.map((m) => (
                <tr key={m.phoneNumber} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '14px 16px', fontSize: '13px', fontWeight: 500, color: '#0f172a', fontFamily: 'monospace' }}>{m.phoneNumber}</td>
                  <td style={{ padding: '14px 16px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, padding: '3px 8px', borderRadius: '4px', background: '#e0e7ff', color: '#3730a3' }}>
                      {(m.provider || 'pstn').toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: '14px 16px', fontSize: '13px', color: '#475569' }}>{m.demoName || agentName(m.demoId)}</td>
                  <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                    <button
                      onClick={() => startEdit(m)}
                      style={{ padding: '4px 10px', marginRight: '8px', background: '#fff', color: '#4338ca', border: '1px solid #c7d2fe', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(m.phoneNumber)}
                      style={{ padding: '4px 10px', background: '#fff', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Info banner */}
      <div style={{ background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '10px', padding: '16px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '2px' }}>
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <div>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#3730a3', marginBottom: '4px' }}>Telephony is deployed separately</p>
          <p style={{ fontSize: '13px', color: '#4338ca', lineHeight: 1.6 }}>
            The PSTN and SIP bridges are not part of the main deployment (they run outside this stack for
            security isolation). Deploy them first from the <code>telephony/</code> folder and provision your
            number with the provider, then map it to an agent here. The mapping is stored in DynamoDB and read
            by the telephony bridge to route incoming calls.
          </p>
        </div>
      </div>
    </div>
  );
}

export default PhoneNumbers;
