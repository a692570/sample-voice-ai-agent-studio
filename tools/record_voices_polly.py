"""
Generate voice samples using Amazon Polly for previewing available voices.

Since Nova Sonic is a speech-to-speech model (requires audio input),
this script uses Amazon Polly to generate text-to-speech samples for voice preview.

For Nova Sonic voice preview, the actual voice is heard during live conversation.

Prerequisites:
  pip install boto3

Usage:
  python record_voices.py
  python record_voices.py --all --output-dir ./voice_samples
"""

import argparse
import os

import boto3

# Nova 2 Sonic voices mapped to closest Polly equivalents for preview
# (Nova Sonic voices are not directly callable via TTS — they're S2S only)
VOICES = {
    "tiffany": {"gender": "female", "locale": "en-US", "polly_voice": "Ruth", "polly_engine": "generative"},
    "matthew": {"gender": "male", "locale": "en-US", "polly_voice": "Matthew", "polly_engine": "generative"},
    "amy": {"gender": "female", "locale": "en-GB", "polly_voice": "Amy", "polly_engine": "generative"},
    "olivia": {"gender": "female", "locale": "en-AU", "polly_voice": "Olivia", "polly_engine": "generative"},
    "kiara": {"gender": "female", "locale": "en-IN", "polly_voice": "Kajal", "polly_engine": "generative"},
    "arjun": {"gender": "male", "locale": "en-IN", "polly_voice": "Arjun", "polly_engine": "neural"},
    "ambre": {"gender": "female", "locale": "fr-FR", "polly_voice": "Lea", "polly_engine": "generative"},
    "florian": {"gender": "male", "locale": "fr-FR", "polly_voice": "Remi", "polly_engine": "generative"},
    "beatrice": {"gender": "female", "locale": "it-IT", "polly_voice": "Bianca", "polly_engine": "generative"},
    "lorenzo": {"gender": "male", "locale": "it-IT", "polly_voice": "Adriano", "polly_engine": "generative"},
    "tina": {"gender": "female", "locale": "de-DE", "polly_voice": "Vicki", "polly_engine": "generative"},
    "lennart": {"gender": "male", "locale": "de-DE", "polly_voice": "Daniel", "polly_engine": "generative"},
    "lupe": {"gender": "female", "locale": "es-US", "polly_voice": "Lupe", "polly_engine": "generative"},
    "carlos": {"gender": "male", "locale": "es-US", "polly_voice": "Pedro", "polly_engine": "generative"},
    "carolina": {"gender": "female", "locale": "pt-BR", "polly_voice": "Camila", "polly_engine": "generative"},
    "leo": {"gender": "male", "locale": "pt-BR", "polly_voice": "Thiago", "polly_engine": "generative"},
}

# Sample text translated for each locale
SAMPLE_TEXTS = {
    "en-US": "Hi there. I'm here to help whenever you need me. Just say the word, and we can get started.",
    "en-GB": "Hi there. I'm here to help whenever you need me. Just say the word, and we can get started.",
    "en-AU": "Hi there. I'm here to help whenever you need me. Just say the word, and we can get started.",
    "en-IN": "Hi there. I'm here to help whenever you need me. Just say the word, and we can get started.",
    "fr-FR": "Bonjour. Je suis là pour vous aider quand vous en avez besoin. Dites-le moi, et nous pouvons commencer.",
    "it-IT": "Ciao. Sono qui per aiutarti ogni volta che ne hai bisogno. Basta dire una parola e possiamo iniziare.",
    "de-DE": "Hallo. Ich bin hier, um Ihnen zu helfen, wann immer Sie mich brauchen. Sagen Sie einfach Bescheid, und wir können loslegen.",
    "es-US": "Hola. Estoy aquí para ayudarte cuando lo necesites. Solo dime y podemos empezar.",
    "pt-BR": "Olá. Estou aqui para ajudar sempre que você precisar. É só falar e podemos começar.",
    "hi-IN": "Hi there. I'm here to help whenever you need me. Just say the word, and we can get started.",
}

REGION = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")


def record_voice(voice_id: str, text: str, output_path: str):
    """Generate a voice sample using Amazon Polly and save as MP3."""
    info = VOICES[voice_id]
    polly_voice = info["polly_voice"]
    engine = info["polly_engine"]

    polly = boto3.client("polly", region_name=REGION)

    try:
        response = polly.synthesize_speech(
            Text=text,
            OutputFormat="mp3",
            VoiceId=polly_voice,
            Engine=engine,
        )

        with open(output_path, "wb") as f:
            f.write(response["AudioStream"].read())

        file_size_kb = os.path.getsize(output_path) / 1024
        print(f"    ✓ {voice_id} → Polly:{polly_voice} ({engine}) → {output_path} ({file_size_kb:.1f} KB)")
        return True

    except Exception as e:
        print(f"    ✗ {voice_id}: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Generate voice samples via Amazon Polly")
    parser.add_argument("--voice", type=str, help="Generate for a specific voice ID")
    parser.add_argument("--text", type=str, help="Custom text to speak")
    parser.add_argument("--all", action="store_true", help="Generate all voices")
    parser.add_argument(
        "--output-dir",
        type=str,
        default="./voice_samples",
        help="Output directory (default: ./voice_samples)",
    )
    args = parser.parse_args()

    output_dir = args.output_dir
    os.makedirs(output_dir, exist_ok=True)

    if args.voice:
        if args.voice not in VOICES:
            print(f"Unknown voice: {args.voice}. Available: {', '.join(VOICES.keys())}")
            return
        voices_to_record = {args.voice: VOICES[args.voice]}
    elif args.all:
        voices_to_record = VOICES
    else:
        voices_to_record = {k: v for k, v in VOICES.items() if v["locale"] == "en-US"}

    print(f"Generating {len(voices_to_record)} voice sample(s) to {output_dir}/")
    print(f"Region: {REGION}")
    print(f"Engine: Amazon Polly (closest match to Nova Sonic voices)")
    print()

    success = 0
    for voice_id, info in voices_to_record.items():
        locale = info["locale"]
        text = args.text or SAMPLE_TEXTS.get(locale, SAMPLE_TEXTS["en-US"])
        output_path = os.path.join(output_dir, f"{voice_id}_{locale}.mp3")

        if record_voice(voice_id, text, output_path):
            success += 1

    print(f"\nDone! {success}/{len(voices_to_record)} samples generated in {output_dir}/")


if __name__ == "__main__":
    main()
