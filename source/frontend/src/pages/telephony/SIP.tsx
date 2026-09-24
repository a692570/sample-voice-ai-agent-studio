const card: React.CSSProperties = {
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '10px',
  padding: '20px',
  marginBottom: '20px',
};

const sectionLabel: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
  color: '#94a3b8',
  textTransform: 'uppercase',
  letterSpacing: '0.3px',
  marginBottom: '12px',
};

const codeBlock: React.CSSProperties = {
  background: '#0f172a',
  color: '#e2e8f0',
  borderRadius: '8px',
  padding: '14px 16px',
  fontFamily: 'monospace',
  fontSize: '12.5px',
  lineHeight: 1.7,
  overflowX: 'auto',
  whiteSpace: 'pre',
};

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '14px', marginBottom: '18px' }}>
      <div
        style={{
          flexShrink: 0,
          width: '26px',
          height: '26px',
          borderRadius: '50%',
          background: '#6366f1',
          color: 'white',
          fontSize: '13px',
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {n}
      </div>
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a', marginBottom: '6px' }}>{title}</p>
        <div style={{ fontSize: '13px', color: '#475569', lineHeight: 1.6 }}>{children}</div>
      </div>
    </div>
  );
}

function SIP() {
  return (
    <div style={{ width: '100%', maxWidth: '860px' }}>
      <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>SIP</h1>
      <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '24px' }}>
        Connect voice agents to enterprise contact center platforms via a direct SIP trunk — Genesys Cloud,
        Five9, NICE CXone, Twilio, Vonage, or Amazon Connect (via Chime SDK Voice Connector). The SIP relay is
        deployed <strong>separately from the main CDK app</strong>. Deploy it yourself, then map your number to
        an agent on the{' '}
        <a href="/telephony/phone-numbers" style={{ color: '#6366f1', fontWeight: 500 }}>Phone Numbers</a> page.
      </p>

      {/* Why it's separate */}
      <div
        style={{
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '10px',
          padding: '16px',
          display: 'flex',
          gap: '12px',
          alignItems: 'flex-start',
          marginBottom: '24px',
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '2px' }}>
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <div>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#991b1b', marginBottom: '4px' }}>Deployed outside the main stack</p>
          <p style={{ fontSize: '13px', color: '#b91c1c', lineHeight: 1.6 }}>
            The SIP relay opens public UDP ports (SIP 5060 + RTP 20000-20100) and has a large security surface.
            It is <strong>not</strong> created by <code>deployment/deploy.sh</code>. Deploy it on your own
            account, hardened per your security requirements, using the steps below.
          </p>
        </div>
      </div>

      {/* Deployment steps */}
      <div style={card}>
        <div style={sectionLabel}>Deployment Steps</div>

        <Step n={1} title="Set up a SIP trunk">
          Provision a SIP trunk with your provider (Twilio Elastic SIP Trunk, Amazon Chime SDK Voice Connector,
          Genesys, etc.) and obtain a phone number. See the provider setup guides under <code>docs/</code>.
        </Step>

        <Step n={2} title="Configure the bridge">
          Run the interactive setup. It generates a random webhook secret and stores the bridge config in AWS
          Secrets Manager — no secrets on disk. See <code>telephony/sip/README.md</code>.
          <div style={{ ...codeBlock, marginTop: '10px' }}>{`cd telephony/sip
./configure.sh`}</div>
        </Step>

        <Step n={3} title="Deploy and run the relay">
          Deploy the drachtio + rtpengine + bridge stack, starting the bridge with the secret name from step 2:
          <div style={{ ...codeBlock, marginTop: '10px' }}>{`CONFIG_SECRET_NAME=voice-agent-poc/sip node index.js`}</div>
          The bridge's IAM role needs <code>secretsmanager:GetSecretValue</code> on that secret.
        </Step>

        <Step n={4} title="Point the trunk at the relay">
          Configure your SIP trunk's termination/origination to route to the relay's public NLB address.
        </Step>

        <Step n={5} title="Map the number to an agent">
          Open the{' '}
          <a href="/telephony/phone-numbers" style={{ color: '#6366f1', fontWeight: 500 }}>Phone Numbers</a>{' '}
          page, add your SIP number, choose <strong>SIP</strong> as the provider, and select the agent it
          should route to. The SIP relay supports one active agent per trunk.
        </Step>
      </div>

      {/* How it works */}
      <div style={card}>
        <div style={sectionLabel}>How SIP Works</div>
        <p style={{ fontSize: '13px', color: '#475569', lineHeight: 1.7, marginBottom: '12px' }}>
          The trunk routes calls to the SIP relay (drachtio SIP proxy + rtpengine for RTP), which bridges audio
          to the Bedrock AgentCore runtime over a SigV4-presigned WebSocket. Both Twilio and Chime paths share
          the same relay backend and use G.711 μ-law audio.
        </p>
        <div style={codeBlock}>{`Twilio: Phone -> Twilio PSTN -> SIP Trunk -> NLB -> drachtio -> bridge -> AgentCore
Chime:  Phone -> Chime PSTN -> SMA Lambda -> Voice Connector -> NLB -> drachtio -> bridge -> AgentCore`}</div>
        <p style={{ marginTop: '10px', fontSize: '12px', color: '#64748b' }}>
          One call at a time is supported (fixed RTP port).
        </p>
      </div>

      {/* Docs */}
      <div style={card}>
        <div style={sectionLabel}>Reference</div>
        <ul style={{ fontSize: '13px', color: '#475569', lineHeight: 1.9, margin: 0, paddingLeft: '18px' }}>
          <li><code>telephony/sip/README.md</code> — relay source and deployment</li>
          <li><code>docs/GUIDE-sip-server.md</code> — design, network architecture, production security</li>
          <li><code>docs/SETUP-twilio-sip.md</code> — Twilio Elastic SIP Trunk setup</li>
          <li><code>docs/SETUP-chime-sdk-sip.md</code> — Amazon Chime SDK Voice Connector setup</li>
          <li><code>docs/GUIDE-genesys-sip-integration.md</code> — Genesys Cloud CX integration</li>
          <li><code>docs/GUIDE-connect-integration.md</code> — Amazon Connect integration</li>
        </ul>
      </div>
    </div>
  );
}

export default SIP;
