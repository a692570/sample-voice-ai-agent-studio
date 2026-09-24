# Claude Platform Prompting Best Practices

Source: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices

## Key Principles (All Claude Models)

### Be Clear and Direct
- Show your prompt to a colleague with minimal context — if they'd be confused, Claude will be too
- Be specific about desired output format and constraints
- Provide sequential steps using numbered lists when order matters

### Use Examples (Few-Shot)
- 3-5 examples for best results
- Make them relevant, diverse, and structured
- Wrap in `<example>` tags to distinguish from instructions

### XML Tags for Structure
- Use consistent, descriptive tag names
- Nest tags when content has natural hierarchy
- Reduces misinterpretation in complex prompts

### Give Claude a Role
- Even a single sentence in the system prompt focuses behavior
- "You are a helpful coding assistant specializing in Python."

### Long Context
- Put longform data at the top (above query/instructions)
- Queries at the end improve response quality by up to 30%
- Use XML tags for multi-document structure

## Tool Use

- Be explicit about when to use tools
- Claude runs independent tool calls in parallel
- If overtriggering: use normal language instead of "CRITICAL: You MUST use this tool"
- If undertriggering: be more explicit about desired action

## Output Control

- Tell Claude what TO DO instead of what NOT to do
- Match your prompt style to desired output style
- Use XML format indicators for specific formatting

## Agentic Systems

- Claude handles long-horizon reasoning with strong state tracking
- Use git for state tracking across sessions
- Encourage incremental progress over attempting everything at once
- Balance autonomy and safety with explicit guidance on reversibility
