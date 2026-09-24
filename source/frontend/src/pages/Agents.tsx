import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWizard } from '../context/WizardContext';
import PageWrapper from '../components/PageWrapper';
import WorkflowCanvas from '../components/WorkflowCanvas';
import type { WorkflowData } from '../components/workflowUtils';
import { generatePromptFromWorkflow } from '../components/workflowUtils';

function Agents() {
  const navigate = useNavigate();
  const { state, dispatch } = useWizard();
  const [workflowData, setWorkflowData] = useState<WorkflowData | null>(null);

  const getSteps = () => {
    if (state.path === 'minimal') {
      return [
        { label: 'Voice', active: false, completed: true },
        { label: 'Flow', active: true, completed: false },
        { label: 'Summary', active: false, completed: false },
        { label: 'Try It', active: false, completed: false },
      ];
    }
    return [
      { label: 'Pipeline', active: false, completed: true },
      { label: 'Model', active: false, completed: true },
      { label: 'Voice', active: false, completed: true },
      { label: 'Flow', active: true, completed: false },
      { label: 'Summary', active: false, completed: false },
      { label: 'Try It', active: false, completed: false },
    ];
  };

  const handleNext = () => {
    // Use user-edited prompt if available, otherwise generate from workflow nodes
    if (workflowData) {
      const prompt = workflowData.editedPrompt ?? generatePromptFromWorkflow(workflowData).prompt;
      const tools = workflowData.editedTools && workflowData.editedTools.length > 0
        ? workflowData.editedTools
        : generatePromptFromWorkflow(workflowData).tools;
      // Merge with any tools already in wizard state (added via prompt tab tool search)
      const existingTools = state.agents.selectedAgents || [];
      const mergedTools = Array.from(new Set([...tools, ...existingTools]));
      dispatch({ type: 'SET_PROMPT', payload: { ...state.prompt, instructions: prompt } });
      dispatch({ type: 'SET_AGENTS', payload: { ...state.agents, selectedAgents: mergedTools } });
      // Save workflow state so nodes/edges (including added tools) persist across navigation
      dispatch({ type: 'SET_WORKFLOW', payload: { nodes: workflowData.nodes, edges: workflowData.edges } });
    }
    navigate('/summary');
  };

  const handleBack = () => {
    navigate('/voice-1s');
  };

  return (
    <PageWrapper
      title="Conversation Flow"
      subtitle="Design the conversation steps your agent follows. Add tools to each step and connect them with conditions."
      steps={getSteps()}
      onNext={handleNext}
      onBack={handleBack}
      nextLabel="Next"
    >
      {/* Agent speaks first toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px', padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '8px' }}>
          <div
            onClick={() => dispatch({ type: 'SET_AGENT_START_FIRST', payload: !state.agentStartFirst })}
            style={{ width: '36px', height: '20px', borderRadius: '10px', background: state.agentStartFirst ? '#6366f1' : '#d1d5db', position: 'relative', cursor: 'pointer', transition: 'background 0.2s' }}
          >
            <div style={{ width: '16px', height: '16px', borderRadius: '50%', background: 'white', position: 'absolute', top: '2px', left: state.agentStartFirst ? '18px' : '2px', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
          </div>
          <span style={{ fontSize: '13px', fontWeight: 500, color: '#334155' }}>Agent speaks first</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '8px' }}>
          <div
            onClick={() => dispatch({ type: 'SET_USE_MOCK', payload: !state.useMock })}
            style={{ width: '36px', height: '20px', borderRadius: '10px', background: state.useMock ? '#f59e0b' : '#d1d5db', position: 'relative', cursor: 'pointer', transition: 'background 0.2s' }}
          >
            <div style={{ width: '16px', height: '16px', borderRadius: '50%', background: 'white', position: 'absolute', top: '2px', left: state.useMock ? '18px' : '2px', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
          </div>
          <span style={{ fontSize: '13px', fontWeight: 500, color: '#334155' }}>Mock tools</span>
          <span style={{ fontSize: '11px', color: '#94a3b8' }}>{state.useMock ? 'Tools return mock responses' : 'Tools call real endpoints'}</span>
        </label>
      </div>
      <WorkflowCanvas
        initialData={state.workflow || null}
        initialPrompt={state.prompt.instructions || null}
        initialTools={state.agents.selectedAgents || null}
        onStateChange={(data: WorkflowData) => setWorkflowData(data)}
      />
    </PageWrapper>
  );
}

export default Agents;
