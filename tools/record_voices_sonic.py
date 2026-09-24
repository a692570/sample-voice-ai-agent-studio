"""
Record voice samples from Amazon Nova 2 Sonic using the raw bidirectional streaming API.

Based on: https://github.com/aws-samples/amazon-nova-samples/tree/main/speech-to-speech/amazon-nova-2-sonic/sample-codes/console-python

Connects directly to Bedrock, sends text input with instruction to speak,
captures audio output, and saves as MP3.

Prerequisites:
  pip install aws-sdk-bedrock-runtime smithy-aws-core

Usage:
  python record_voices_sonic.py --voice tiffany --locale en-US
  python record_voices_sonic.py --all
  python record_voices_sonic.py --all --output-dir ../source/frontend/public/audios/sonic
"""

import argparse
import asyncio
import base64
import json
import os
import subprocess
import uuid
import wave

from aws_sdk_bedrock_runtime.client import BedrockRuntimeClient, InvokeModelWithBidirectionalStreamOperationInput
from aws_sdk_bedrock_runtime.models import InvokeModelWithBidirectionalStreamInputChunk, BidirectionalInputPayloadPart
from aws_sdk_bedrock_runtime.config import Config
from smithy_aws_core.identity.environment import EnvironmentCredentialsResolver

REGION = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
MODEL_ID = "amazon.nova-2-sonic-v1:0"

VOICE_LOCALE_COMBOS = [
    ("tiffany", "en-US"), ("matthew", "en-US"),
    ("amy", "en-GB"),
    ("olivia", "en-AU"),
    ("kiara", "en-IN"), ("arjun", "en-IN"),
    ("tiffany", "fr-FR"), ("matthew", "fr-FR"), ("ambre", "fr-FR"), ("florian", "fr-FR"),
    ("tiffany", "it-IT"), ("matthew", "it-IT"), ("beatrice", "it-IT"), ("lorenzo", "it-IT"),
    ("tiffany", "de-DE"), ("matthew", "de-DE"), ("tina", "de-DE"), ("lennart", "de-DE"),
    ("tiffany", "es-US"), ("matthew", "es-US"), ("lupe", "es-US"), ("carlos", "es-US"),
    ("tiffany", "pt-BR"), ("matthew", "pt-BR"), ("carolina", "pt-BR"), ("leo", "pt-BR"),
    ("tiffany", "hi-IN"), ("matthew", "hi-IN"), ("kiara", "hi-IN"), ("arjun", "hi-IN"),
]

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
    "hi-IN": "नमस्ते। जब भी आपको मेरी ज़रूरत हो, मैं यहाँ मदद के लिए हूँ। बस बोलिए, और हम शुरू कर सकते हैं।",
}


async def record_voice(voice_id: str, locale: str, text: str, output_path: str) -> bool:
    """Record a voice sample using raw Bedrock bidirectional streaming."""
    print(f"  Recording {voice_id}_{locale}...", end=" ", flush=True)

    prompt_name = str(uuid.uuid4())
    audio_chunks: list[bytes] = []

    # Initialize Bedrock client
    config = Config(
        endpoint_uri=f"https://bedrock-runtime.{REGION}.amazonaws.com",
        region=REGION,
        aws_credentials_identity_resolver=EnvironmentCredentialsResolver(),
    )
    client = BedrockRuntimeClient(config=config)

    try:
        stream_response = await client.invoke_model_with_bidirectional_stream(
            InvokeModelWithBidirectionalStreamOperationInput(model_id=MODEL_ID)
        )

        async def send_event(event_json: str):
            event = InvokeModelWithBidirectionalStreamInputChunk(
                value=BidirectionalInputPayloadPart(bytes_=event_json.encode('utf-8'))
            )
            await stream_response.input_stream.send(event)

        # 1. Session start
        await send_event(json.dumps({"event": {"sessionStart": {"inferenceConfiguration": {"maxTokens": 1024, "topP": 0.9, "temperature": 0.7}}}}))

        # 2. Prompt start with voice config
        await send_event(json.dumps({"event": {"promptStart": {
            "promptName": prompt_name,
            "textOutputConfiguration": {"mediaType": "text/plain"},
            "audioOutputConfiguration": {
                "mediaType": "audio/lpcm",
                "sampleRateHertz": 24000,
                "sampleSizeBits": 16,
                "channelCount": 1,
                "voiceId": voice_id,
                "encoding": "base64",
                "audioType": "SPEECH",
            },
        }}}))

        # 3. System prompt
        sys_content_name = str(uuid.uuid4())
        await send_event(json.dumps({"event": {"contentStart": {"promptName": prompt_name, "contentName": sys_content_name, "role": "SYSTEM", "type": "TEXT", "interactive": False, "textInputConfiguration": {"mediaType": "text/plain"}}}}))
        await send_event(json.dumps({"event": {"textInput": {"promptName": prompt_name, "contentName": sys_content_name, "content": "You are a voice assistant. When the user sends you a message, speak it out loud exactly as written. Do not add anything else."}}}))
        await send_event(json.dumps({"event": {"contentEnd": {"promptName": prompt_name, "contentName": sys_content_name}}}))

        # 4. Start audio content (silence to keep connection alive)
        audio_content_name = str(uuid.uuid4())
        await send_event(json.dumps({"event": {"contentStart": {"promptName": prompt_name, "contentName": audio_content_name, "type": "AUDIO", "interactive": True, "role": "USER", "audioInputConfiguration": {"mediaType": "audio/lpcm", "sampleRateHertz": 16000, "sampleSizeBits": 16, "channelCount": 1, "audioType": "SPEECH", "encoding": "base64"}}}}))

        # 5. Send text input
        text_content_name = str(uuid.uuid4())
        await send_event(json.dumps({"event": {"contentStart": {"promptName": prompt_name, "contentName": text_content_name, "role": "USER", "type": "TEXT", "interactive": True, "textInputConfiguration": {"mediaType": "text/plain"}}}}))
        await send_event(json.dumps({"event": {"textInput": {"promptName": prompt_name, "contentName": text_content_name, "content": text}}}))
        await send_event(json.dumps({"event": {"contentEnd": {"promptName": prompt_name, "contentName": text_content_name}}}))

        # 6. Send silence continuously + collect audio output
        silence = base64.b64encode(b'\x00' * 3200).decode()  # 100ms silence

        async def send_silence():
            for _ in range(100):  # 10 seconds of silence
                await send_event(json.dumps({"event": {"audioInput": {"promptName": prompt_name, "contentName": audio_content_name, "content": silence}}}))
                await asyncio.sleep(0.1)

        async def collect_audio():
            got_audio = False
            silence_count = 0
            while True:
                try:
                    output = await stream_response.await_output()
                    result = await output[1].receive()
                    if result.value and result.value.bytes_:
                        data = json.loads(result.value.bytes_.decode('utf-8'))
                        if 'event' in data and 'audioOutput' in data['event']:
                            audio_bytes = base64.b64decode(data['event']['audioOutput']['content'])
                            audio_chunks.append(audio_bytes)
                            got_audio = True
                            silence_count = 0
                        elif got_audio:
                            silence_count += 1
                            if silence_count > 5:
                                break
                except Exception:
                    break

        # Run silence sending and audio collection concurrently
        await asyncio.gather(
            send_silence(),
            asyncio.wait_for(collect_audio(), timeout=15),
            return_exceptions=True,
        )

        # 7. Close
        await send_event(json.dumps({"event": {"contentEnd": {"promptName": prompt_name, "contentName": audio_content_name}}}))
        await send_event(json.dumps({"event": {"promptEnd": {"promptName": prompt_name}}}))
        await send_event(json.dumps({"event": {"sessionEnd": {}}}))
        await stream_response.input_stream.close()

    except Exception as e:
        if not audio_chunks:
            print(f"⚠ {type(e).__name__}: {e}")
            return False

    if not audio_chunks:
        print("⚠ No audio")
        return False

    # Write WAV (24kHz output from Sonic)
    all_audio = b"".join(audio_chunks)
    wav_path = output_path.replace(".mp3", ".wav")
    with wave.open(wav_path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(24000)
        wf.writeframes(all_audio)

    # Convert to MP3
    try:
        subprocess.run(["ffmpeg", "-y", "-i", wav_path, "-b:a", "128k", output_path], capture_output=True, check=True)
        os.remove(wav_path)
    except (FileNotFoundError, subprocess.CalledProcessError):
        os.rename(wav_path, output_path)

    file_size_kb = os.path.getsize(output_path) / 1024
    print(f"✓ {file_size_kb:.1f} KB")
    return True


async def main():
    parser = argparse.ArgumentParser(description="Record Nova 2 Sonic voice samples")
    parser.add_argument("--voice", type=str)
    parser.add_argument("--locale", type=str)
    parser.add_argument("--text", type=str)
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--output-dir", type=str, default="./voice_samples")
    args = parser.parse_args()

    output_dir = args.output_dir
    os.makedirs(output_dir, exist_ok=True)

    if args.voice and args.locale:
        combos = [(args.voice, args.locale)]
    elif args.voice:
        combos = [(v, l) for v, l in VOICE_LOCALE_COMBOS if v == args.voice]
    elif args.all:
        combos = VOICE_LOCALE_COMBOS
    else:
        combos = [(v, l) for v, l in VOICE_LOCALE_COMBOS if l == "en-US"]

    print(f"Recording {len(combos)} sample(s) to {output_dir}/")
    print(f"Direct Bedrock: {REGION} / {MODEL_ID}")
    print()

    success = 0
    for voice_id, locale in combos:
        text = args.text or SAMPLE_TEXTS.get(locale, SAMPLE_TEXTS["en-US"])
        output_path = os.path.join(output_dir, f"{voice_id}_{locale}.mp3")

        try:
            if await record_voice(voice_id, locale, text, output_path):
                success += 1
        except Exception as e:
            print(f"✗ {voice_id}_{locale}: {e}")

        await asyncio.sleep(2)

    print(f"\nDone! {success}/{len(combos)} samples recorded in {output_dir}/")


if __name__ == "__main__":
    asyncio.run(main())
