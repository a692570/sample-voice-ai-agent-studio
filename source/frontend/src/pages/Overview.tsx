import { useState } from 'react';

function Overview() {
  const [chartMetric, setChartMetric] = useState<'conversations' | 'agents' | 'cost' | 'avgDuration'>('conversations');

  // Dummy aggregate data across all agents
  const chartData = {
    conversations: [45, 62, 78, 55, 98, 84, 72, 110, 65, 89, 102, 95],
    agents: [2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6],
    cost: [4.5, 6.2, 7.8, 5.5, 9.8, 8.4, 7.2, 11.0, 6.5, 8.9, 10.2, 9.5],
    avgDuration: [2.1, 2.4, 2.8, 2.3, 2.6, 2.9, 2.5, 3.1, 2.4, 2.7, 2.8, 2.6],
  };
  const chartLabels = ['Jul 25', 'Aug 25', 'Sep 25', 'Oct 25', 'Nov 25', 'Dec 25', 'Jan 26', 'Feb 26', 'Mar 26', 'Apr 26', 'May 26', 'Jun 26'];
  const chartUnits = { conversations: '', agents: '', cost: '$', avgDuration: ' min' };
  const maxVal = Math.max(...chartData[chartMetric]);

  return (
    <div style={{ width: '100%' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#0f172a' }}>Overview</h1>
        <p style={{ fontSize: '14px', color: '#64748b', marginTop: '4px' }}>Aggregate metrics across all voice agents.</p>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', marginBottom: '24px' }}>
        {[
          { label: 'Total Agents', value: '6', note: '+1 this month' },
          { label: 'Total Conversations', value: '955', note: '↑ 12% from last month' },
          { label: 'Avg Success Rate', value: '89%', note: '↑ 3% improvement' },
          { label: 'Total Cost', value: '$95.50', note: 'This billing period' },
        ].map((metric) => (
          <div key={metric.label} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '18px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{metric.label}</div>
            <div style={{ fontSize: '28px', fontWeight: 700, color: '#0f172a', marginTop: '8px' }}>{metric.value}</div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '8px' }}>{metric.note}</div>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '20px', marginBottom: '24px' }}>
        {/* Metric tabs on top */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '16px' }}>
          {([
            { id: 'conversations', label: 'Conversations' },
            { id: 'agents', label: 'Active Agents' },
            { id: 'cost', label: 'Total Cost' },
            { id: 'avgDuration', label: 'Avg Duration' },
          ] as const).map((m) => (
            <button
              key={m.id}
              onClick={() => setChartMetric(m.id)}
              style={{
                padding: '6px 14px', background: chartMetric === m.id ? '#eef2ff' : 'none', border: 'none',
                borderBottom: chartMetric === m.id ? '2px solid #6366f1' : '2px solid transparent',
                fontSize: '13px', fontWeight: chartMetric === m.id ? 600 : 450,
                color: chartMetric === m.id ? '#6366f1' : '#64748b', cursor: 'pointer',
                borderRadius: '4px 4px 0 0', transition: 'all 0.15s',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
        {/* Line chart */}
        <div style={{ position: 'relative', height: '140px' }}>
            <svg width="100%" height="100%" viewBox="0 0 600 140" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
              {[0, 1, 2, 3].map((i) => (
                <line key={i} x1="0" y1={i * 35 + 25} x2="600" y2={i * 35 + 25} stroke="#e2e8f0" strokeWidth="0.5" />
              ))}
              <polyline
                fill="none"
                stroke="#6366f1"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={chartData[chartMetric].map((val, i) => `${(i / 11) * 580 + 10},${125 - (val / maxVal) * 95}`).join(' ')}
              />
              <polygon
                fill="url(#overviewGradient)"
                opacity="0.15"
                points={`10,125 ${chartData[chartMetric].map((val, i) => `${(i / 11) * 580 + 10},${125 - (val / maxVal) * 95}`).join(' ')} 590,125`}
              />
              {chartData[chartMetric].map((val, i) => (
                <g key={i}>
                  <circle cx={(i / 11) * 580 + 10} cy={125 - (val / maxVal) * 95} r="3" fill="#6366f1" />
                  <text x={(i / 11) * 580 + 10} y={125 - (val / maxVal) * 95 - 8} textAnchor="middle" fontSize="9" fill="#64748b">
                    {chartUnits[chartMetric] === '$' ? `$${val.toFixed(1)}` : `${val}${chartUnits[chartMetric]}`}
                  </text>
                </g>
              ))}
              <defs>
                <linearGradient id="overviewGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
              {chartLabels.map((label, i) => (
                <span key={i} style={{ fontSize: '9px', color: '#94a3b8', textAlign: 'center', flex: 1 }}>{label}</span>
              ))}
            </div>
        </div>
      </div>

      {/* Agent performance table */}
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '20px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '14px' }}>Agent Performance</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Agent</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Conversations</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Success Rate</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Avg Duration</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Cost</th>
            </tr>
          </thead>
          <tbody>
            {[
              { name: 'Customer Support', conversations: 312, success: '92%', duration: '2.4 min', cost: '$31.20' },
              { name: 'Sales Assistant', conversations: 245, success: '87%', duration: '3.1 min', cost: '$24.50' },
              { name: 'Appointment Scheduler', conversations: 189, success: '95%', duration: '1.8 min', cost: '$18.90' },
              { name: 'Order Status Bot', conversations: 134, success: '91%', duration: '1.2 min', cost: '$13.40' },
              { name: 'Billing Inquiry', conversations: 52, success: '78%', duration: '4.2 min', cost: '$5.20' },
              { name: 'Technical Support', conversations: 23, success: '82%', duration: '5.8 min', cost: '$2.30' },
            ].map((agent) => (
              <tr key={agent.name} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '10px 12px', fontSize: '14px', fontWeight: 500, color: '#0f172a' }}>{agent.name}</td>
                <td style={{ padding: '10px 12px', fontSize: '14px', color: '#475569', textAlign: 'right' }}>{agent.conversations}</td>
                <td style={{ padding: '10px 12px', fontSize: '14px', color: '#475569', textAlign: 'right' }}>{agent.success}</td>
                <td style={{ padding: '10px 12px', fontSize: '14px', color: '#475569', textAlign: 'right' }}>{agent.duration}</td>
                <td style={{ padding: '10px 12px', fontSize: '14px', color: '#475569', textAlign: 'right' }}>{agent.cost}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default Overview;
