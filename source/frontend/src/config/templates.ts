/**
 * Industry Templates Configuration
 *
 * Each template pre-fills the wizard with a complete session configuration
 * including host, framework, model, system prompt, tools, and voice settings.
 *
 * These can be modified through the wizard steps or edited directly here.
 */

export interface TemplateConfig {
  id: string;
  sector: string;
  useCase: string;
  icon: string;
  image: string; // URL for industry illustration
  description: string;

  // Session config fields
  host: 'agentcore' | 'eks' | 'ecs';
  framework: 'strands-bidiagent' | 'pipecat' | 'livekit';
  model: string[];
  pipeline: 'speech-to-speech' | 'cascaded';
  systemPrompt: string;
  tools: string[];
  gateways?: string[]; // AgentCore MCP Gateway IDs for auto-discovered tools
  voice: {
    voiceId: string;
    language: string;
    gender: string;
  };
  workflow?: {
    nodes: any[];
    edges: any[];
  };
}

const TEMPLATES: TemplateConfig[] = [
  {
    id: 'insurance-claim',
    sector: 'Insurance',
    useCase: 'Claims Processing',
    icon: '🏥',
    image: '/images/insurance.png',
    description:
      'Handle first notice of loss, guide claimants through documentation requirements, and provide status updates on existing claims.',
    host: 'agentcore',
    framework: 'strands-bidiagent',
    model: ['nova-2-sonic'],
    pipeline: 'speech-to-speech',
    systemPrompt: `You are a Claims Processing Agent for Acme Insurance.
About: A property and casualty insurance provider serving residential and commercial customers.
Tone: Professional, empathetic, patient, and reassuring.
Instructions: Collect policy number first. For new claims, gather date of loss, description of incident, and contact details. Never provide settlement amounts. Escalate to a human agent if the caller is distressed or if the claim involves bodily injury.`,
    tools: ['knowledge-base', 'crm', 'notification', 'transfer'],
    voice: {
      voiceId: 'tiffany',
      language: 'en-US',
      gender: 'female',
    },
    workflow: {
      nodes: [
        { id: 'start', type: 'start', position: { x: 250, y: 0 }, data: { name: 'Start', instructions: '', tools: [] }, deletable: false },
        { id: 's1', type: 'step', position: { x: 180, y: 80 }, data: { name: 'Greeting', instructions: 'Say "Hello! Welcome to Any Bank. Could I please get your name to start?"\nUse the user\'s name naturally in the conversation once obtained.', tools: [] } },
        { id: 'step_1782864902808_7', type: 'step', position: { x: 177, y: 199 }, data: { name: 'Authentication', instructions: 'Verify the caller\'s identity by asking for their account number, name, or date of birth.', tools: ['int:f05cffe3-1e04-457c-877d-5e70157d533b'], nodeId: 'step_1782864902808_7' } },
        { id: 's2', type: 'step', position: { x: 177, y: 352 }, data: { name: 'Inquiry Handling', instructions: '"Thank you, [User\'s Name]. How may I assist you today? I can help with banking and mortgage-related inquiries."\nIf the user hasn\'t provided their account ID yet and asks about their account balance or mortgage, prompt: "To proceed, could you please provide your account ID?"\nConvert numeric IDs to words (e.g., 123 becomes "one two three").\nFor banking inquiries, call [banking_tools].\nFor mortgage inquiries, call [banking_tools].\nDo not re-ask for the account ID once it\'s been provided.', tools: ['int:ec2dd679-9094-4c3d-84b5-0f04afff4de8'] } },
        { id: 's6', type: 'step', position: { x: 210, y: 494 }, data: { name: 'Closing', instructions: 'Have a nice day', tools: [] } },
        { id: 'end', type: 'end', position: { x: 248, y: 631 }, data: { name: 'End', instructions: '', tools: [] }, deletable: false },
      ],
      edges: [
        { id: 'e0', source: 'start', target: 's1', type: 'smoothstep', animated: true, style: { stroke: '#a5b4fc', strokeWidth: 2 } },
        { id: 'e-s1-auth', source: 's1', target: 'step_1782864902808_7', type: 'smoothstep', animated: true, style: { stroke: '#a5b4fc', strokeWidth: 2 }, markerEnd: { type: 'arrowclosed', color: '#6366f1' } },
        { id: 'e-auth-s2', source: 'step_1782864902808_7', target: 's2', type: 'smoothstep', animated: true, style: { stroke: '#a5b4fc', strokeWidth: 2 }, markerEnd: { type: 'arrowclosed', color: '#6366f1' } },
        { id: 'e-s2-s6', source: 's2', target: 's6', type: 'smoothstep', animated: true, style: { stroke: '#a5b4fc', strokeWidth: 2 }, markerEnd: { type: 'arrowclosed', color: '#6366f1' } },
        { id: 'e6', source: 's6', target: 'end', type: 'smoothstep', animated: true, style: { stroke: '#a5b4fc', strokeWidth: 2 } },
      ],
    },
  },
  {
    id: 'banking-cs',
    sector: 'Banking & Finance',
    useCase: 'Bank Customer Service',
    icon: '🏦',
    image: '/images/banking.png',
    description:
      'Assist customers with account balance and transaction inquiries with identity verification.',
    host: 'agentcore',
    framework: 'strands-bidiagent',
    model: ['nova-2-sonic'],
    pipeline: 'speech-to-speech',
    gateways: ['mcp-auth-8uktb0l2yx', 'mcp-banking-g0vjwurdwi'],
    systemPrompt: `You are a voice agent. Follow this conversation flow:

## Greeting
Hello! Welcome to Any Bank. Could I please get your name to start?
Then proceed to: Personalization

## Personalization
Use the user's name naturally in the conversation once obtained.
Then proceed to: Authentication

## Authentication
Verify user identity before proceeding.
Ask for their account ID first, then ask for their date of birth.
Use the authentication tool with both credentials.

If authentication succeeds, proceed to the next step.

If authentication fails:
- Tell the caller you were not able to verify their identity and ask if they would like to try again.
- Allow up to 3 attempts total.
- After 3 failed attempts, offer to transfer to a team member.

NEVER proceed to account inquiries without successful authentication.
Then proceed to: Inquiry

## Inquiry
Ask how you can help. You can assist with account balance and recent transaction inquiries ONLY.
Convert numeric IDs to words (e.g., 123 becomes one two three).
Use the appropriate banking tool for balance and transaction inquiries.
Do not re-ask for the account ID once it has been provided.

If the caller asks about anything outside of account balance or recent transactions (such as mortgage, loans, credit cards, investments, or any other topic), politely tell them you are only able to help with account balance and transaction inquiries, and suggest they call back or ask to be transferred for other matters.

Then proceed to: Closing

## Closing
Thank you for calling. Have a nice day.

Follow the defined flow. Use branching conditions to decide which step to go to next.`,
    tools: [],
    voice: {
      voiceId: 'matthew',
      language: 'en-US',
      gender: 'male',
    },
    workflow: {
      nodes: [
        { id: 'start', type: 'start', position: { x: 250, y: 0 }, data: { name: 'Start', instructions: '', tools: [] }, deletable: false },
        { id: 'step_0', type: 'step', position: { x: 180, y: 80 }, data: { name: 'Greeting', instructions: 'Hello! Welcome to Any Bank. Could I please get your name to start?', tools: [], nodeId: 'step_0' } },
        { id: 'step_1782863666679_2', type: 'step', position: { x: 181, y: 204 }, data: { name: 'Personalization', instructions: "Use the user's name naturally in the conversation once obtained.", tools: [], nodeId: 'step_1782863666679_2' } },
        { id: 'step_1782863580140_1', type: 'step', position: { x: 184, y: 320 }, data: { name: 'Authentication', instructions: "Verify user identity before proceeding.\nAsk for their account ID first, then ask for their date of birth.\nUse the authentication tool with both credentials.\n\nIf authentication succeeds, proceed to the next step.\n\nIf authentication fails:\n- Tell the caller you were not able to verify their identity and ask if they would like to try again.\n- Allow up to 3 attempts total.\n- After 3 failed attempts, offer to transfer to a team member.\n\nNEVER proceed to account inquiries without successful authentication.", tools: [], nodeId: 'step_1782863580140_1' } },
        { id: 'step_1782863760703_3', type: 'step', position: { x: 182, y: 463 }, data: { name: 'Inquiry', instructions: "Ask how you can help. You can assist with banking and mortgage-related inquiries.\nConvert numeric IDs to words (e.g., 123 becomes one two three).\nUse the appropriate banking tool for balance, transactions, or mortgage inquiries.\nDo not re-ask for the account ID once it has been provided.", tools: [], nodeId: 'step_1782863760703_3' } },
        { id: 'step_1782863820644_6', type: 'step', position: { x: 181, y: 636 }, data: { name: 'Closing', instructions: 'Thank you for calling. Have a nice day.', tools: [], nodeId: 'step_1782863820644_6' } },
        { id: 'end', type: 'end', position: { x: 252, y: 779 }, data: { name: 'End', instructions: '', tools: [] }, deletable: false },
      ],
      edges: [
        { id: 'e-start-0', source: 'start', target: 'step_0', type: 'smoothstep', animated: true, style: { stroke: '#a5b4fc', strokeWidth: 2 }, markerEnd: { type: 'arrowclosed', color: '#6366f1' } },
        { id: 'e-0-person', source: 'step_0', target: 'step_1782863666679_2', type: 'smoothstep', animated: true, style: { stroke: '#a5b4fc', strokeWidth: 2 }, markerEnd: { type: 'arrowclosed', color: '#6366f1' } },
        { id: 'e-person-auth', source: 'step_1782863666679_2', target: 'step_1782863580140_1', type: 'smoothstep', animated: true, style: { stroke: '#a5b4fc', strokeWidth: 2 }, markerEnd: { type: 'arrowclosed', color: '#6366f1' } },
        { id: 'e-auth-inquiry', source: 'step_1782863580140_1', target: 'step_1782863760703_3', type: 'smoothstep', animated: true, style: { stroke: '#a5b4fc', strokeWidth: 2 }, markerEnd: { type: 'arrowclosed', color: '#6366f1' } },
        { id: 'e-inquiry-close', source: 'step_1782863760703_3', target: 'step_1782863820644_6', type: 'smoothstep', animated: true, style: { stroke: '#a5b4fc', strokeWidth: 2 }, markerEnd: { type: 'arrowclosed', color: '#6366f1' } },
        { id: 'e-close-end', source: 'step_1782863820644_6', target: 'end', type: 'smoothstep', animated: true, style: { stroke: '#a5b4fc', strokeWidth: 2 }, markerEnd: { type: 'arrowclosed', color: '#6366f1' } },
      ],
    },
  },
  {
    id: 'agent-training',
    sector: 'Contact Center',
    useCase: 'Agent Training Simulator',
    icon: '🎓',
    image: '/images/contact-center.png',
    description:
      'Simulate realistic customer interactions for training new contact center agents. Plays the role of various customer personas.',
    host: 'agentcore',
    framework: 'strands-bidiagent',
    model: ['nova-2-sonic'],
    pipeline: 'speech-to-speech',
    systemPrompt: `You are a Customer Simulator for Agent Training at TrainRight Solutions.
About: A contact center training platform that simulates customer interactions for agent skill development.
Tone: Varies by scenario — can be frustrated, confused, impatient, or friendly. Adapts difficulty based on training level.
Instructions: Act as a realistic customer with a specific problem. Start moderately frustrated. If the trainee agent handles the situation well, become more cooperative. If handled poorly, escalate frustration. Provide feedback at the end of the interaction rating the agent on empathy, resolution, and communication.`,
    tools: ['knowledge-base', 'custom'],
    voice: {
      voiceId: 'gregory',
      language: 'en-US',
      gender: 'male',
    },
  },
  {
    id: 'drive-through',
    sector: 'Quick Service Restaurant',
    useCase: 'Drive-Through Order Taking',
    icon: '🍔',
    image: '/images/restaurant.png',
    description:
      'Take customer orders at drive-through, handle menu questions, suggest add-ons, and confirm order totals.',
    host: 'agentcore',
    framework: 'strands-bidiagent',
    model: ['nova-2-sonic'],
    pipeline: 'speech-to-speech',
    systemPrompt: `You are a Drive-Through Order Agent for Burger Barn.
About: A quick-service restaurant chain specializing in burgers, fries, shakes, and combo meals.
Tone: Upbeat, fast-paced, friendly, and clear. Speaks concisely to keep the line moving.
Instructions: Take orders accurately, repeat back each item for confirmation. Suggest combo upgrades and add-ons when appropriate. Handle modifications (no pickles, extra cheese). Calculate running total. Confirm final order before sending to kitchen. Keep responses short — this is a drive-through.`,
    tools: ['order-status', 'payment', 'custom'],
    voice: {
      voiceId: 'amy',
      language: 'en-US',
      gender: 'female',
    },
  },
  {
    id: 'auto-garage',
    sector: 'Automotive',
    useCase: 'Garage Appointment Booking',
    icon: '🚗',
    image: '/images/automotive.png',
    description:
      'Schedule vehicle service appointments, provide repair estimates, and manage existing bookings for an auto repair shop.',
    host: 'agentcore',
    framework: 'strands-bidiagent',
    model: ['nova-2-sonic'],
    pipeline: 'speech-to-speech',
    systemPrompt: `You are an Appointment Booking Agent for QuickFix Auto Service.
About: An independent auto repair garage offering maintenance, diagnostics, tire services, and general repairs for all vehicle makes.
Tone: Friendly, knowledgeable about cars, straightforward.
Instructions: Collect vehicle make, model, year, and mileage. Ask about the service needed (oil change, brakes, diagnostics, tires, etc.). Offer available time slots. Provide rough time and cost estimates for common services. Confirm appointment details including drop-off time and whether customer will wait or needs a ride.`,
    tools: ['calendar', 'crm', 'notification'],
    voice: {
      voiceId: 'matthew',
      language: 'en-US',
      gender: 'male',
    },
  },
  {
    id: 'healthcare-scheduling',
    sector: 'Healthcare',
    useCase: 'Patient Appointment Scheduling',
    icon: '⚕️',
    image: '/images/healthcare.png',
    description:
      'Book, reschedule, or cancel patient appointments. Handle provider availability and insurance verification questions.',
    host: 'agentcore',
    framework: 'strands-bidiagent',
    model: ['nova-2-sonic'],
    pipeline: 'speech-to-speech',
    systemPrompt: `You are a Patient Scheduling Coordinator for Metro Health Clinic.
About: A multi-specialty outpatient clinic offering primary care, dermatology, cardiology, and pediatrics.
Tone: Warm, professional, HIPAA-conscious, and patient.
Instructions: Verify patient identity with date of birth and name. Check provider availability. Collect reason for visit. Confirm insurance if this is a new patient. Send appointment confirmation via text or email. Never discuss diagnoses or test results — direct those questions to the clinical team.`,
    tools: ['calendar', 'crm', 'notification', 'transfer'],
    voice: {
      voiceId: 'tiffany',
      language: 'en-US',
      gender: 'female',
    },
  },
];

export default TEMPLATES;
