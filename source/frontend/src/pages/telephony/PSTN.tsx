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

function PSTN() {
  return (
    <div style={{ width: '100%', maxWidth: '860px' }}>
      <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>PSTN (Twilio)</h1>
      <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '24px' }}>
        Connect voice agents to the public telephone network via a Twilio Conversation Relay bridge. The PSTN
        bridge is deployed <strong>separately from the main CDK app</strong> because it provisions an
        internet-facing load balancer. Deploy it yourself, then map your number to an agent on the{' '}
        <a href="/telephony/phone-numbers" style={{ color: '#6366f1', fontWeight: 500 }}>Phone Numbers</a> page.
      </p>

      {/* Why it's separate */}
      <div
        style={{
          background: '#fffbeb',
          border: '1px solid #fde68a',
          borderRadius: '10px',
          padding: '16px',
          display: 'flex',
          gap: '12px',
          alignItems: 'flex-start',
          marginBottom: '24px',
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '2px' }}>
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <div>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#92400e', marginBottom: '4px' }}>Deployed outside the main stack</p>
          <p style={{ fontSize: '13px', color: '#a16207', lineHeight: 1.6 }}>
            The PSTN bridge exposes public network infrastructure and is subject to a higher security review
            bar. It is <strong>not</strong> created by <code>deployment/deploy.sh</code>. Follow the steps below
            to deploy it on your own account.
          </p>
        </div>
      </div>

      {/* Deployment steps */}
      <div style={card}>
        <div style={sectionLabel}>Deployment Steps</div>

        <Step n={1} title="Provision a Twilio number">
          In the Twilio console, buy a voice-capable phone number and note your Account SID and Auth Token.
        </Step>

        <Step n={2} title="Configure the bridge">
          Run the interactive setup. It auto-detects your AgentCore runtime and stores the bridge config in AWS
          Secrets Manager — no secrets on disk. See <code>telephony/pstn/README.md</code>.
          <div style={{ ...codeBlock, marginTop: '10px' }}>{`cd telephony/pstn
./configure.sh`}</div>
        </Step>

        <Step n={3} title="Deploy and run the bridge">
          Deploy the container to your own account, starting it with the secret name from step 2:
          <div style={{ ...codeBlock, marginTop: '10px' }}>{`CONFIG_SECRET_NAME=voice-agent-poc/pstn \\
  uvicorn tac_server:app --host 0.0.0.0 --port 8080`}</div>
          The bridge's IAM role needs <code>secretsmanager:GetSecretValue</code> on that secret.
        </Step>

        <Step n={4} title="Point Twilio at the bridge">
          Set your Twilio number's incoming voice webhook to the bridge's public URL (the Conversation Relay /
          TwiML endpoint).
        </Step>

        <Step n={5} title="Map the number to an agent">
          Open the{' '}
          <a href="/telephony/phone-numbers" style={{ color: '#6366f1', fontWeight: 500 }}>Phone Numbers</a>{' '}
          page, add your Twilio number, choose <strong>PSTN</strong> as the provider, and select the agent it
          should route to. The mapping is stored in DynamoDB and read by the bridge.
        </Step>
      </div>

      {/* How it works */}
      <div style={card}>
        <div style={sectionLabel}>How PSTN Works</div>
        <p style={{ fontSize: '13px', color: '#475569', lineHeight: 1.7, marginBottom: '12px' }}>
          Twilio routes incoming calls to the bridge via Conversation Relay (WebSocket). Multiple agents can
          share one number — callers hear a DTMF menu to pick which agent to talk to. The bridge presigns a
          SigV4 WebSocket to the Bedrock AgentCore runtime.
        </p>
        <div style={codeBlock}>{`Phone -> Twilio PSTN -> Conversation Relay (WS) -> PSTN bridge -> AgentCore`}</div>
      </div>

      {/* Docs */}
      <div style={card}>
        <div style={sectionLabel}>Reference</div>
        <ul style={{ fontSize: '13px', color: '#475569', lineHeight: 1.9, margin: 0, paddingLeft: '18px' }}>
          <li><code>telephony/pstn/README.md</code> — bridge source and deployment</li>
          <li><code>docs/GUIDE-pstn-relay-server.md</code> — design, network architecture, security</li>
        </ul>
      </div>
    </div>
  );
}

export default PSTN;
