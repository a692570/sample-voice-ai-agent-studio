# Amazon Nova Sonic System Prompt Best Practices

Source: https://docs.aws.amazon.com/nova/latest/userguide/prompting-speech-best-practices.html

## Key Principles

### Clarity and Precision
Instructions that are clear in text may need to be reformulated for speech contexts. Ensure prompts seek confirmation of understanding before taking action through tools.

When asking for verification, request one piece of information at a time. First ask for their name, then wait for response and confirm. Next ask for email and repeat back. Finally ask for booking code, listening for parts separated by dashes. Read back character by character to confirm accuracy.

### Conversational Flow
Prioritize natural dialogue flow over formal instructional structures. Guide the customer through tasks as a conversation. Start by asking what they've already tried, then suggest one simple step at a time. After each step, pause to check if it is clear before moving on.

### Memory Constraints
Spoken interactions have different memory dynamics compared to text. Listeners can't "refer back" to previous text. When explaining policies, focus on one key point at a time. Summarize all points together at the end to reinforce without overwhelming.
