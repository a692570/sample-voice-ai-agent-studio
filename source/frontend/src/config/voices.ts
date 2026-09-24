/**
 * Voice configuration for supported speech-to-speech models.
 *
 * Each model has its own set of available voices, languages, and genders.
 * The UI loads from this config to populate voice selection options.
 */

export interface VoiceOption {
  id: string;
  label: string;
  gender: 'female' | 'male';
  languages: string[]; // Language codes this voice supports
  sampleAudio?: string; // Default sample (primary locale)
  sampleAudios?: Record<string, string>; // Locale-specific samples
}

export interface LanguageOption {
  id: string;
  label: string;
}

export interface ModelVoiceConfig {
  modelId: string;
  modelName: string;
  languages: LanguageOption[];
  voices: VoiceOption[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Amazon Nova 2 Sonic
// ─────────────────────────────────────────────────────────────────────────────

export const NOVA_SONIC_CONFIG: ModelVoiceConfig = {
  modelId: 'nova-2-sonic',
  modelName: 'Amazon Nova 2 Sonic',
  languages: [
    { id: 'en-US', label: 'English (US)' },
    { id: 'en-GB', label: 'English (UK)' },
    { id: 'en-AU', label: 'English (Australia)' },
    { id: 'en-IN', label: 'English (India)' },
    { id: 'fr-FR', label: 'French' },
    { id: 'it-IT', label: 'Italian' },
    { id: 'de-DE', label: 'German' },
    { id: 'es-US', label: 'Spanish (US)' },
    { id: 'pt-BR', label: 'Portuguese (Brazil)' },
    { id: 'hi-IN', label: 'Hindi' },
  ],
  voices: [
    // English (US) — Tiffany & Matthew are polyglot (en-US + all non-English languages)
    { id: 'tiffany', label: 'Tiffany', gender: 'female', languages: ['en-US', 'fr-FR', 'it-IT', 'de-DE', 'es-US', 'pt-BR', 'hi-IN'], sampleAudio: '/audios/polly/tiffany_en-US.mp3' },
    { id: 'matthew', label: 'Matthew', gender: 'male', languages: ['en-US', 'fr-FR', 'it-IT', 'de-DE', 'es-US', 'pt-BR', 'hi-IN'], sampleAudio: '/audios/polly/matthew_en-US.mp3' },
    // English (UK) — Amy speaks en-GB + English
    { id: 'amy', label: 'Amy', gender: 'female', languages: ['en-GB', 'en-US'], sampleAudio: '/audios/polly/amy_en-GB.mp3' },
    // English (Australia) — Olivia speaks en-AU + English
    { id: 'olivia', label: 'Olivia', gender: 'female', languages: ['en-AU', 'en-US'], sampleAudio: '/audios/polly/olivia_en-AU.mp3' },
    // English (India) / Hindi — speak en-IN, hi-IN + English
    { id: 'kiara', label: 'Kiara', gender: 'female', languages: ['en-IN', 'hi-IN', 'en-US'], sampleAudio: '/audios/polly/kiara_en-IN.mp3' },
    { id: 'arjun', label: 'Arjun', gender: 'male', languages: ['en-IN', 'hi-IN', 'en-US'], sampleAudio: '/audios/polly/arjun_en-IN.mp3' },
    // French — speak fr-FR + English
    { id: 'ambre', label: 'Ambre', gender: 'female', languages: ['fr-FR', 'en-US'], sampleAudio: '/audios/polly/ambre_fr-FR.mp3' },
    { id: 'florian', label: 'Florian', gender: 'male', languages: ['fr-FR', 'en-US'], sampleAudio: '/audios/polly/florian_fr-FR.mp3' },
    // Italian — speak it-IT + English
    { id: 'beatrice', label: 'Beatrice', gender: 'female', languages: ['it-IT', 'en-US'], sampleAudio: '/audios/polly/beatrice_it-IT.mp3' },
    { id: 'lorenzo', label: 'Lorenzo', gender: 'male', languages: ['it-IT', 'en-US'], sampleAudio: '/audios/polly/lorenzo_it-IT.mp3' },
    // German — speak de-DE + English
    { id: 'tina', label: 'Tina', gender: 'female', languages: ['de-DE', 'en-US'], sampleAudio: '/audios/polly/tina_de-DE.mp3' },
    { id: 'lennart', label: 'Lennart', gender: 'male', languages: ['de-DE', 'en-US'], sampleAudio: '/audios/polly/lennart_de-DE.mp3' },
    // Spanish (US) — speak es-US + English
    { id: 'lupe', label: 'Lupe', gender: 'female', languages: ['es-US', 'en-US'], sampleAudio: '/audios/polly/lupe_es-US.mp3' },
    { id: 'carlos', label: 'Carlos', gender: 'male', languages: ['es-US', 'en-US'], sampleAudio: '/audios/polly/carlos_es-US.mp3' },
    // Portuguese (Brazil) — speak pt-BR + English
    { id: 'carolina', label: 'Carolina', gender: 'female', languages: ['pt-BR', 'en-US'], sampleAudio: '/audios/polly/carolina_pt-BR.mp3' },
    { id: 'leo', label: 'Leo', gender: 'male', languages: ['pt-BR', 'en-US'], sampleAudio: '/audios/polly/leo_pt-BR.mp3' },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI Realtime API
// ─────────────────────────────────────────────────────────────────────────────

export const OPENAI_REALTIME_CONFIG: ModelVoiceConfig = {
  modelId: 'openai-realtime',
  modelName: 'OpenAI Realtime API',
  languages: [
    { id: 'en', label: 'English' },
    { id: 'es', label: 'Spanish' },
    { id: 'fr', label: 'French' },
    { id: 'de', label: 'German' },
    { id: 'it', label: 'Italian' },
    { id: 'pt', label: 'Portuguese' },
    { id: 'ja', label: 'Japanese' },
    { id: 'ko', label: 'Korean' },
    { id: 'zh', label: 'Chinese' },
  ],
  voices: [
    { id: 'alloy', label: 'Alloy', gender: 'female', languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'] },
    { id: 'echo', label: 'Echo', gender: 'male', languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'] },
    { id: 'fable', label: 'Fable', gender: 'male', languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'] },
    { id: 'onyx', label: 'Onyx', gender: 'male', languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'] },
    { id: 'nova', label: 'Nova', gender: 'female', languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'] },
    { id: 'shimmer', label: 'Shimmer', gender: 'female', languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'] },
    { id: 'ash', label: 'Ash', gender: 'male', languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'] },
    { id: 'ballad', label: 'Ballad', gender: 'male', languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'] },
    { id: 'coral', label: 'Coral', gender: 'female', languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'] },
    { id: 'sage', label: 'Sage', gender: 'female', languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'] },
    { id: 'verse', label: 'Verse', gender: 'male', languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'] },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Google Gemini Live
// ─────────────────────────────────────────────────────────────────────────────

export const GEMINI_LIVE_CONFIG: ModelVoiceConfig = {
  modelId: 'gemini-live',
  modelName: 'Gemini Live',
  languages: [
    { id: 'en', label: 'English' },
    { id: 'es', label: 'Spanish' },
    { id: 'fr', label: 'French' },
    { id: 'de', label: 'German' },
    { id: 'it', label: 'Italian' },
    { id: 'pt', label: 'Portuguese' },
    { id: 'ja', label: 'Japanese' },
    { id: 'ko', label: 'Korean' },
    { id: 'zh', label: 'Chinese' },
  ],
  voices: [
    { id: 'Puck', label: 'Puck', gender: 'male', languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'] },
    { id: 'Charon', label: 'Charon', gender: 'male', languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'] },
    { id: 'Kore', label: 'Kore', gender: 'female', languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'] },
    { id: 'Fenrir', label: 'Fenrir', gender: 'male', languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'] },
    { id: 'Aoede', label: 'Aoede', gender: 'female', languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'] },
    { id: 'Leda', label: 'Leda', gender: 'female', languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'] },
    { id: 'Orus', label: 'Orus', gender: 'male', languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'] },
    { id: 'Zephyr', label: 'Zephyr', gender: 'male', languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'] },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Lookup helper
// ─────────────────────────────────────────────────────────────────────────────

const ALL_CONFIGS: Record<string, ModelVoiceConfig> = {
  'nova-2-sonic': NOVA_SONIC_CONFIG,
  'openai-realtime': OPENAI_REALTIME_CONFIG,
  'gemini-live': GEMINI_LIVE_CONFIG,
};

/**
 * Get the voice config for a given model ID.
 * Falls back to Nova Sonic if model not found.
 */
export function getVoiceConfig(modelId: string): ModelVoiceConfig {
  return ALL_CONFIGS[modelId] || NOVA_SONIC_CONFIG;
}
