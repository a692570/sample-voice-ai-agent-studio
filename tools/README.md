# Tools

Utility scripts for the Voice AI POC-in-a-Box project.

## record_voices.py

Records voice samples from Amazon Nova 2 Sonic for all available voice IDs. Outputs WAV files (16-bit PCM, 16kHz mono).

### Prerequisites

```bash
pip install strands-agents strands-agents-builder aws-sdk-bedrock-runtime
```

AWS credentials with Bedrock Nova 2 Sonic access required.

### Usage

```bash
# Record default English (US) voices (tiffany, matthew)
python record_voices.py

# Record all voices across all languages
python record_voices.py --all

# Record a specific voice with custom text
python record_voices.py --voice tiffany --text "Welcome to our service!"

# Specify output directory
python record_voices.py --all --output-dir ./my_samples
```

### Available Voices

| Voice ID | Gender | Locale |
|----------|--------|--------|
| tiffany | female | en-US |
| matthew | male | en-US |
| amy | female | en-GB |
| olivia | female | en-AU |
| kiara | female | en-IN |
| arjun | male | en-IN |
| ambre | female | fr-FR |
| florian | male | fr-FR |
| beatrice | female | it-IT |
| lorenzo | male | it-IT |
| tina | female | de-DE |
| lennart | male | de-DE |
| lupe | female | es-US |
| carlos | male | es-US |
| carolina | female | pt-BR |
| leo | male | pt-BR |

### Output

Files are saved as `{voice_id}_{locale}.wav` in the output directory (default: `./voice_samples/`).
