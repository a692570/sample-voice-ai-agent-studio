---
name: "Nova 2 Lite Voice Prompt Best Practices"
description: "Best practices for writing system prompts for Amazon Nova Sonic / Nova 2 Lite voice agents in customer service scenarios. Used by the eval prompt optimizer to generate improved prompts."
---

# Nova 2 Lite / Nova Sonic — Voice Prompt Best Practices

When writing or improving system prompts for Nova Sonic voice agents, follow these principles:

## Structure

Organize prompts with clear sections using markdown headers. LLMs parse structured content with headers more reliably than unstructured prose.

Recommended sections:
- `## IDENTITY` — Role, expertise, and personality
- `## RESPONSE BEHAVIOR` — Communication style, tone, and response length
- `## STANDARD PROCEDURES` — Pre-action requirements and task workflows
- `## RESTRICTIONS` — NEVER / ALWAYS / OUT OF SCOPE rules
- `## ESCALATION BOUNDARIES` — Triggers and protocol for human handoff

## Conversational Flow

Guide as a conversation, not step-by-step text instructions. Ask one thing at a time, wait for response, then proceed. Suggest one solution at a time and pause to check understanding before moving on.

Example — BAD: "Verify the user's identity by requesting their username, email, and reservation number."
Example — GOOD: "When asking for verification, request one piece of information at a time. First ask for their name, then wait for their response and confirm it. Next, ask for their email and repeat it back for verification."

## Voice-Friendly Output

- No bullet points, numbered lists, markdown, or formatting that assumes visual reading
- Use natural conversational phrasing
- Keep responses concise — listeners can't "refer back" to previous text
- Focus on one key point at a time, then summarize at the end

Example — BAD: "Your warranty covers: • Parts replacement • Labor costs • Technical support (24/7)"
Example — GOOD: "Your warranty covers three main areas. First, it includes parts replacement. Second, it covers labor costs. And third, you'll have access to technical support around the clock."

## Clarity and Precision

- Request verification one piece at a time (name first, then email, then account number)
- Read back identifiers character-by-character for accuracy
- Seek confirmation before taking action via tools to prevent mishaps
- Avoid assumptions — provide clear, unambiguous guidance

## Strong Directives

Use MUST/NEVER/ALWAYS only for high-stakes items (security, financial, privacy). Don't overuse capitalization — if everything is capitalized, nothing is prioritized.

Example — BAD: "ALWAYS greet the user WARMLY and THANK them for contacting us."
Example — GOOD: "NEVER process a refund without VERIFIED payment status change."

## Conditional Logic

Use if/when/then conditions rather than vague instructions. Clear triggers with specific actions.

Example — BAD: "Help customers with pricing questions and give them the right information."
Example — GOOD: "If the customer asks about pricing but doesn't specify a plan → Ask which plan they're interested in before providing details. When a customer mentions 'billing error' or 'overcharge' → Escalate immediately to the billing team."

## Restrictions

Define NEVER/ALWAYS/OUT OF SCOPE rules explicitly. When restricting a behavior, always provide an alternative action so the agent knows what to do instead.

## Topic Boundaries (Customer Service)

Customer service agents MUST stay on topic and refuse to engage with off-topic requests. Without explicit topic boundaries, the LLM will try to be helpful with anything — including topics outside the agent's domain (general knowledge, personal advice, unrelated products, etc.). This leads to inaccurate responses and liability issues.

Key principles:
- Define the agent's domain explicitly ("I can help with banking and mortgage inquiries")
- Reject off-topic requests politely but firmly
- Never guess or provide information outside the defined scope
- Redirect back to the agent's purpose after declining

### Example: Topic Boundary Instructions

```
## SCOPE

I can ONLY help with:
- Account balance inquiries
- Transaction history
- Card management (lost/stolen, limits)
- Payment scheduling

I CANNOT help with:
- Investment advice or stock recommendations
- Tax preparation or legal questions
- General knowledge or trivia
- Other companies' products or services

When a caller asks about something outside my scope:
- Acknowledge their question politely
- Clearly state that this is outside what I can help with
- Redirect: "Is there anything else related to your bank account I can assist with?"
- If they persist, offer to transfer to a department that might help

Example:
User: "What's the best stock to invest in right now?"
Agent: "I appreciate the question, but I'm only able to help with your bank account — things like checking your balance, reviewing transactions, or managing your card. Is there anything along those lines I can help with today?"
```

### Anti-pattern (BAD — No Topic Boundaries)

```
You are a helpful bank customer service agent. Answer the customer's questions.
```

This allows the agent to answer anything — stock advice, weather, recipes — which is inappropriate for a customer service line.

## Escalation

Define specific triggers and protocol for human handoff. Examples:
- "When caller mentions bodily injury → transfer immediately"
- "If caller requests to speak with a manager after two attempts to resolve → initiate transfer"
- "When claim involves fraud indicators → escalate to fraud prevention team"

## Negative Case Handling

Customer service prompts MUST include handling for negative scenarios. Without explicit negative case instructions, the agent may loop indefinitely or respond inappropriately when a caller is frustrated, uncooperative, or hostile.

Key negative cases to address:
- **Frustrated caller** — Validate feelings, apologize for inconvenience, offer to transfer to a human agent
- **Refuses to provide information** — Explain why it's needed, offer alternatives, but if they persist after 2 attempts, gracefully offer to connect with a human or end the call
- **Repeated failed verification** — After 3 failed attempts, transfer to human agent for security
- **Abusive language** — Issue one warning, then transfer or close gracefully
- **Off-topic/out-of-scope requests** — State limitations clearly, offer to transfer to appropriate department
- **Silence/no response** — Prompt twice, then offer to call back or close

Recommend using tools for these actions:
- `call [transfer_to_agent]` — warm transfer to human with context
- `call [end_call]` — graceful call termination after confirmation

### Example: Negative Case Handling in Prompt

```
## ESCALATION & NEGATIVE CASES

When the caller is frustrated or upset:
- Acknowledge their frustration: "I understand this is frustrating, and I'm sorry for the inconvenience."
- Offer to transfer: "Would you like me to connect you with a specialist who can help further?"
- If they say yes, call [transfer_to_agent].

When the caller refuses to provide required information:
- Explain why it's needed: "I need your account number to look up your information securely."
- If they refuse twice, offer alternatives: "I understand. Would you prefer to speak with a human agent who may be able to help in other ways?"
- If they still refuse, close gracefully: "No problem. You're welcome to call back anytime. Have a good day."

When the caller uses abusive language:
- Respond calmly: "I'm here to help, but I need our conversation to remain respectful."
- If it continues, transfer: "I'm going to connect you with a supervisor."
call [transfer_to_agent]

When there is no response (silence):
- First prompt: "Are you still there? I'm happy to help when you're ready."
- Second prompt (after 10s): "It seems we may have lost connection. I'll end the call now, but please call back anytime."
call [end_call]
```

## Tool Use

- Instruct to verify customer claims with tools before acting — never accept claims at face value
- Use tools for calculations, date arithmetic, and lookups (LLMs are unreliable for these)
- Acknowledge the customer's request before invoking a tool to reduce perceived wait time

## Memory Constraints

- Focus on one key point at a time, then summarize all points together at the end
- Don't reference "sections," "documents," or "paragraphs" — the caller can't see them
- Summarize key numbers or details when transitioning between topics

## Example Interaction Flows

Include example conversations in the prompt to show the model exactly how to behave. This is one of the most effective techniques for Nova Sonic — it learns tone, pacing, tool usage patterns, and conversational style from examples.

Structure examples as:
```
### Example 1: [Scenario Name]
Assistant: [greeting]
User: [request]
Assistant: [response with tool call if needed]
call [tool_name]
Assistant: [response with tool result]
```

Tips for examples:
- Show the complete happy path for the most common scenarios
- Demonstrate how to ask for missing information naturally
- Show tool invocations inline with `call [tool_name]` so the model learns when to use them
- Include at least 2 examples covering the primary use cases
- Keep assistant responses short (1-2 sentences) as they'll be spoken aloud
- Show how to convert numbers to spoken form (e.g., account ID 123 becomes "one two three")

### Sample: Bank Customer Service Prompt with Examples

```
You are a helpful customer service assistant for a bank. Follow this structured flow:

1. Greeting
"Hello! Welcome to Any Bank. Could I please get your name to start?"

2. Personalization
Use the user's name naturally in the conversation once obtained.

3. Inquiry Handling
"Thank you, [User's Name]. How may I assist you today? I can help with banking and mortgage-related inquiries."
If the user hasn't provided their account ID yet, prompt: "To proceed, could you please provide your account ID?"
Convert numeric IDs to words (e.g., 123 becomes "one two three").
For banking inquiries, call [ac_bank_agent].
For mortgage inquiries, call [ac_mortgage_agent].
Do not re-ask for the account ID once it's been provided.

4. Out of Scope
If the user asks about non-banking topics: "Sorry, I can only help with banking or mortgage-related inquiries."

## Example Interaction Flows

### Example 1: Account Balance Inquiry
Assistant: Hello! Welcome to Any Bank. Could I please get your name to start?
User: My name is Jamie.
Assistant: Thank you, Jamie. How may I assist you today?
User: I need to check my account balance.
Assistant: To proceed, could you please provide your account ID?
User: It's 123.
Assistant: Thank you. Please hold on while I retrieve your account balance.
call [ac_bank_agent]
Assistant: Jamie, your current balance is USD 1600.00 with pending transactions of USD 56.25.

### Example 2: Mortgage Inquiry
Assistant: Hello! Welcome to Any Bank. Could I please get your name to start?
User: I'm Sarah.
Assistant: Thank you, Sarah. How may I assist you today?
User: Can you tell me about mortgage refinancing options?
Assistant: Absolutely, Sarah. Let me look into that for you.
call [ac_mortgage_agent]
Assistant: Here are your mortgage refinance options. Your current mortgage balance is two hundred forty-five thousand dollars with an interest rate of four point eight five percent.
```

## Conversation Closing

Every voice agent prompt MUST include a closing section that defines when and how to end the call. Without this, the agent may hang indefinitely or close abruptly without confirmation.

Two built-in tools are always available:
- `end_call` — Gracefully close the session
- `transfer_to_human` — Escalate to a live agent

### When to End the Call (end_call)

Trigger `end_call` when:
- Customer says "that's all", "thank you, goodbye", "nothing else", or similar
- Customer confirms they don't need further help after being asked
- The conversation has naturally concluded (request fulfilled + customer satisfied)

Before calling `end_call`, always:
1. Ask if there's anything else: "Is there anything else I can help you with today?"
2. If they say no → deliver a warm closing: "Thank you for calling [Company]. Have a great day!"
3. Then invoke `end_call`

### When to Transfer (transfer_to_human)

Trigger `transfer_to_human` when:
- Customer explicitly requests a human agent or manager
- Authentication fails 3 times consecutively
- The issue is outside the agent's capability after 2 attempts to resolve
- Customer becomes abusive (after one warning)
- A safety or fraud concern is detected

Before calling `transfer_to_human`, always:
1. Acknowledge the situation: "I understand. Let me connect you with a team member who can help."
2. Then invoke `transfer_to_human`

### Template: Closing Section for Prompts

```
## CLOSING

After completing the customer's request:
- Ask: "Is there anything else I can help you with today?"
- If yes → handle their next request
- If no → "Thank you for calling, [Name]. Have a wonderful day!"
- Then call [end_call]

## ESCALATION

Transfer to a human agent (call [transfer_to_human]) when:
- Customer requests to speak with a human or manager
- Authentication fails 3 times
- You cannot resolve the issue after 2 attempts
- Customer uses abusive language (after one calm warning)
- A safety concern is detected
```

## References

- https://docs.aws.amazon.com/nova/latest/userguide/prompting-speech-best-practices.html
- https://docs.aws.amazon.com/nova/latest/userguide/prompting.html
