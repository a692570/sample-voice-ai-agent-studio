import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { WizardProvider } from './context/WizardContext';
import { AutoSaveProvider } from './context/AutoSaveContext';
import { FilterProvider } from './context/FilterContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import OAuthCallback from './pages/OAuthCallback';
import Launch from './pages/Launch';
import Overview from './pages/Overview';
import Home from './pages/Home';
import Voice1S from './pages/Voice1S';
import PipelineSelection from './pages/PipelineSelection';
import SpeechToSpeech from './pages/SpeechToSpeech';
import CascadedSpeech from './pages/CascadedSpeech';
import Agents from './pages/Agents';
import PromptBuilder from './pages/PromptBuilder';
import Summary from './pages/Summary';
import POC from './pages/POC';
import Demos from './pages/Demos';
import AgentDetail from './pages/AgentDetail';
import StartFromScratch from './pages/StartFromScratch';
import RAG from './pages/integrations/RAG';
import Tools from './pages/integrations/Tools';
import Skills from './pages/integrations/Skills';
import SubAgents from './pages/integrations/SubAgents';
import Settings from './pages/Settings';
import PSTN from './pages/telephony/PSTN';
import SIP from './pages/telephony/SIP';
import PhoneNumbers from './pages/telephony/PhoneNumbers';
import EvalSuites from './pages/EvalSuites';
import EvalSuiteDetail from './pages/EvalSuiteDetail';
import EvalSuiteCompare from './pages/EvalSuiteCompare';

function AuthenticatedApp() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <p style={{ color: '#545b64', fontSize: '14px' }}>Loading...</p>
      </div>
    );
  }

  // OAuth callback must be accessible before authentication
  if (window.location.pathname === '/callback') {
    return <OAuthCallback />;
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  return (
    <FilterProvider>
    <WizardProvider>
      <BrowserRouter>
      <AutoSaveProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Overview />} />
            <Route path="/launch" element={<Launch />} />
            <Route path="/start" element={<StartFromScratch />} />
            <Route path="/home" element={<Home />} />
            {/* Path 1: Minimal Effort */}
            <Route path="/voice-1s" element={<Voice1S />} />
            {/* Path 2: Some Technical */}
            <Route path="/pipeline" element={<PipelineSelection />} />
            <Route path="/speech-to-speech" element={<SpeechToSpeech />} />
            <Route path="/cascaded" element={<CascadedSpeech />} />
            {/* Shared */}
            <Route path="/tools-selection" element={<Agents />} />
            <Route path="/prompt-builder" element={<PromptBuilder />} />
            <Route path="/summary" element={<Summary />} />
            <Route path="/poc" element={<POC />} />
            <Route path='/agents' element={<Demos />} />
            <Route path="/agents/:id" element={<AgentDetail />} />
            <Route path="/agents/:id/summary" element={<AgentDetail />} />
            <Route path="/agents/:id/workflow" element={<AgentDetail />} />
            <Route path="/agents/:id/conversations" element={<AgentDetail />} />
            <Route path="/agents/:id/users" element={<AgentDetail />} />
            <Route path="/agents/:id/cost" element={<AgentDetail />} />
            <Route path="/agents/:id/evaluation" element={<AgentDetail />} />
            <Route path="/agents/:id/evaluation/:jobId" element={<AgentDetail />} />
            {/* Integrations */}
            <Route path="/integrations/rag" element={<RAG />} />
            <Route path="/integrations/tools" element={<Tools />} />
            <Route path="/integrations/skills" element={<Skills />} />
            <Route path="/integrations/sub-agents" element={<SubAgents />} />
            {/* Telephony */}
            <Route path="/telephony/twilio" element={<PSTN />} />
            <Route path="/telephony/sip" element={<SIP />} />
            <Route path="/telephony/phone-numbers" element={<PhoneNumbers />} />
            <Route path="/settings" element={<Settings />} />
            {/* Eval Suites */}
            <Route path="/eval-suites" element={<EvalSuites />} />
            <Route path="/eval-suites/:id" element={<EvalSuiteDetail />} />
            <Route path="/eval-suites/:id/compare" element={<EvalSuiteCompare />} />
          </Route>
        </Routes>
      </AutoSaveProvider>
      </BrowserRouter>
    </WizardProvider>
    </FilterProvider>
  );
}

function App() {
  return (
    <AuthProvider>
      <AuthenticatedApp />
    </AuthProvider>
  );
}

export default App;
