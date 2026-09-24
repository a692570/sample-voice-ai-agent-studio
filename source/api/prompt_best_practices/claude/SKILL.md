---
name: "Claude Prompt Best Practices"
description: "Best practices for writing system prompts for Claude models (Haiku, Sonnet, Opus) used as the reasoning LLM in voice agent Expert Tool mode or as the eval judge model."
---

# Claude (Haiku / Sonnet) — Prompt Best Practices

When writing or improving system prompts for Claude models used in voice agent scenarios (Expert Tool reasoner, eval judge, or cascaded pipeline LLM), follow these principles.

## Be Clear and Direct

Claude responds well to clear, explicit instructions. Think of Claude as a brilliant but new employee who lacks context on your norms and workflows.

- Be specific about the desired output format and constraints
- Provide instructions as sequential steps using numbered lists when order matters
- Show your prompt to a colleague — if they'd be confused, Claude will be too

## Give Claude a Role

Setting a role in the system prompt focuses Claude's behavior and tone. Even a single sentence makes a difference:

```
You are a customer service agent for Acme Insurance, specializing in claims processing.
```

## Use Examples Effectively (Few-Shot)

Examples are one of the most reliable ways to steer output format, tone, and structure. When adding examples:

- Make them relevant to your actual use case
- Cover edge cases and vary enough to avoid unintended patterns
- Wrap examples in `<example>` tags so Claude distinguishes them from instructions
- Include 3-5 examples for best results

## Structure with XML Tags

XML tags help Claude parse complex prompts unambiguously. Wrap each type of content in its own tag:

```
<instructions>
Your task instructions here
</instructions>

<context>
Background information
</context>

<examples>
<example>
User: What's my balance?
Assistant: Let me look that up for you. Your current balance is $1,234.56.
</example>
</examples>
```

## Add Context and Motivation

Explaining WHY a behavior is important helps Claude generalize better than just stating the rule:

```
When verifying customer identity, ask for one piece of information at a time.
This prevents overwhelming callers and reduces errors from mishearing multiple
items spoken at once — which is critical in voice interactions where there's
no visual confirmation.
```

## Tool Use Best Practices

Claude benefits from explicit direction about when to use tools:

- Be explicit: "Use the lookup_account tool to verify the account" rather than "check the account"
- For proactive tool use: "By default, use tools to verify information rather than asking the user"
- For conservative tool use: "Only use tools when explicitly asked or when verification is required"

## Voice-Native Output (Critical)

Claude's responses in this system will be spoken aloud to a caller via TTS. ALL output must be voice-friendly:

- Keep responses to 1-2 sentences maximum — listeners can't scroll back
- NO markdown, bullet points, numbered lists, or any visual formatting
- NO special characters, URLs, or code blocks
- Speak numbers naturally: "one two three" for identifiers, "forty-five dollars" for currency
- Use conversational phrasing, not written prose
- One point at a time — summarize at the end if needed
- Ask one question at a time, wait for the answer
- Read back important details for confirmation ("So that's account number one two three four, correct?")

Example — BAD:
```
Your account has the following details:
- Balance: $1,234.56
- Status: Active
- Last transaction: 07/01/2026
```

Example — GOOD:
```
Your account balance is twelve hundred thirty-four dollars and fifty-six cents. Your account is active, and your last transaction was on July first.
```

## Voice Conversation Flow

Even though Claude receives text input, it must respond as if in a live phone conversation:

- Acknowledge what the caller said before acting ("Got it, let me look that up")
- Provide filler before tool calls ("Just a moment while I check on that")
- Keep turn-taking natural — don't dump large blocks of information
- Use transitional phrases ("Now regarding your second question...")
- Handle interruptions gracefully

## Negative Case Handling (Customer Service)

Include handling for negative voice scenarios:

- Frustrated caller: validate feelings, offer transfer
- Refuses to provide info: explain why needed, offer alternatives, graceful close after 2 attempts
- Abusive language: one calm warning, then transfer
- Silence/no response: prompt twice, then close
- Off-topic requests: state scope clearly, redirect politely

## Topic Boundaries

Customer service agents MUST stay on topic:
- Define the agent's domain explicitly
- Reject off-topic requests politely but firmly
- Never guess or provide information outside defined scope
- Redirect back to the agent's purpose after declining

## Thinking and Reasoning

For complex tasks, Claude can use extended thinking:

- Prefer general instructions ("think thoroughly") over prescriptive step-by-step plans
- Ask Claude to self-check: "Before you finish, verify your answer against [criteria]"
- For simpler tasks, direct responses without thinking are faster and sufficient

## Haiku vs Sonnet Differences

**Claude Haiku** (faster, cheaper):
- Best for: quick lookups, simple tool orchestration, classification
- Needs more explicit instructions — less inference from context
- Provide more examples and be more prescriptive about steps
- Good for: eval user simulator, simple tool routing

**Claude Sonnet** (more capable):
- Best for: complex reasoning, multi-step tool chains, nuanced judgment
- Can infer intent from less explicit instructions
- Better at handling ambiguous situations
- Good for: eval judge, prompt optimization, complex agent reasoning

## Avoid Common Pitfalls

- Don't over-capitalize: "ALWAYS" and "NEVER" lose impact if overused. Reserve for critical safety rules.
- Don't contradict yourself: review all instructions to ensure rules don't conflict
- Don't be vague: "Help customers" → "Look up the customer's order using the order_status tool, then summarize the delivery date and tracking number"
- Remove anti-laziness prompting if migrating from older models — newer Claude models are proactive by default

## Customer Service Voice Agent (Complete Template)

For customer service voice agents using Claude as the reasoner:

```
<instructions>
You are the reasoning engine for a voice customer service agent.
Your output will be spoken aloud to the caller via text-to-speech.

RESPONSE RULES:
- Keep responses to 1-2 sentences maximum
- Use natural conversational language (no markdown, no lists, no special characters)
- Speak numbers as words when they're identifiers (account "one two three four")
- Use dollar amounts as words ("forty-five dollars and twenty cents")
- Verify information with tools before stating facts
- If unsure, ask one clarifying question rather than guessing
- Acknowledge the caller before taking action ("Let me check on that for you")

CONVERSATION FLOW:
1. Greet and ask how you can help
2. Collect required information one piece at a time
3. Confirm details back to the caller before acting
4. Use tools to look up or process information
5. Summarize the result conversationally
6. Ask if there's anything else

SCOPE:
- Only help with [specific domain]
- Decline off-topic requests: "I can only help with [domain]. Is there anything related to that I can assist with?"
- Transfer to human when: caller requests it, complex issue after 2 attempts, abusive language

ESCALATION:
- If caller is frustrated → validate and offer transfer
- If bodily injury or safety → transfer immediately
- If caller refuses required info after 2 asks → offer alternatives or graceful close
</instructions>

<examples>
<example>
User: I need to check my account balance.
Assistant: Sure, I can help with that. Could you please provide your account number?
User: It's 1234.
Assistant: Thank you. Let me look up account one two three four for you. Just a moment.
[tool call: lookup_account]
Assistant: Your current balance is five hundred twenty-three dollars and forty cents.
</example>

<example>
User: Can you recommend a good restaurant nearby?
Assistant: I appreciate the question, but I'm only able to help with your bank account today. Is there anything account-related I can assist you with?
</example>
</examples>
```

## Conversation Closing

Every voice agent prompt MUST include a closing section. Two built-in tools are always available:
- `end_call` — Gracefully close the session
- `transfer_to_human` — Escalate to a live agent

### When to End the Call (end_call)

Trigger `end_call` when:
- Customer says "that's all", "thank you, goodbye", "nothing else", or similar
- Customer confirms they don't need further help after being asked
- The conversation has naturally concluded (request fulfilled + customer satisfied)

Before calling `end_call`, always deliver a warm closing first, then invoke the tool.

### When to Transfer (transfer_to_human)

Trigger `transfer_to_human` when:
- Customer explicitly requests a human agent or manager
- Authentication fails 3 times consecutively
- The issue is outside the agent's capability after 2 attempts
- Customer becomes abusive (after one warning)
- A safety or fraud concern is detected

### Template: Closing Section (XML format)

```
<closing>
After completing the customer's request:
1. Ask: "Is there anything else I can help you with today?"
2. If yes → handle their next request
3. If no → "Thank you for calling, [Name]. Have a wonderful day!"
4. Then call [end_call]
</closing>

<escalation>
Transfer to a human agent (call [transfer_to_human]) when:
- Customer requests to speak with a human or manager
- Authentication fails 3 times
- You cannot resolve the issue after 2 attempts
- Customer uses abusive language (after one calm warning)
- A safety concern is detected

Before transferring, always acknowledge: "I understand. Let me connect you with a team member who can help."
</escalation>
```

## References

- https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
- https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
