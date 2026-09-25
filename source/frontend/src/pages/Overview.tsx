import { useNavigate } from 'react-router-dom';

function Overview() {
  const navigate = useNavigate();

  const links = [
    {
      title: 'Build an Agent',
      desc: 'Use the guided wizard to configure a voice agent — model, voice, tools, prompt, and flow.',
      to: '/home',
    },
    {
      title: 'Your Agents',
      desc: 'View, edit, and test the agents you have saved.',
      to: '/agents',
    },
    {
      title: 'Tools',
      desc: 'Define custom tools and integrations (webhooks, Lambda, MCP, sub-agents).',
      to: '/integrations/tools',
    },
    {
      title: 'Evaluations',
      desc: 'Run eval suites against your agents and review scored results.',
      to: '/eval-suites',
    },
  ];

  return (
    <div style={{ width: '100%' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#0f172a' }}>Overview</h1>
        <p style={{ fontSize: '14px', color: '#64748b', marginTop: '4px' }}>
          Design, test, and evaluate real-time voice AI agents powered by Amazon Nova Sonic on Bedrock AgentCore.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px' }}>
        {links.map((card) => (
          <button
            key={card.title}
            onClick={() => navigate(card.to)}
            style={{
              textAlign: 'left',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              padding: '20px',
              cursor: 'pointer',
              transition: 'border-color 0.15s, box-shadow 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#c7d2fe';
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(99,102,241,0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#e2e8f0';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <div style={{ fontSize: '15px', fontWeight: 600, color: '#0f172a' }}>{card.title}</div>
            <div style={{ fontSize: '13px', color: '#64748b', marginTop: '6px', lineHeight: 1.5 }}>{card.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

export default Overview;
