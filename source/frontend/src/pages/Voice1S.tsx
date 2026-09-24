import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWizard } from '../context/WizardContext';
import { getVoiceConfig } from '../config/voices';
import PageWrapper from '../components/PageWrapper';
import styles from './Voice1S.module.css';

function Voice1S() {
  const navigate = useNavigate();
  const { state, dispatch } = useWizard();
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Stop audio on unmount (navigate away)
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  // Load voice config based on the selected model
  const selectedModel = state.model[0] || 'nova-2-sonic';
  const voiceConfig = getVoiceConfig(selectedModel);

  const getSteps = () => {
    if (state.path === 'minimal') {
      return [
        { label: 'Voice', active: true, completed: false },
        { label: 'Flow', active: false, completed: false },
        { label: 'Summary', active: false, completed: false },
        { label: 'Try It', active: false, completed: false },
      ];
    }
    return [
      { label: 'Pipeline', active: false, completed: true },
      { label: 'Model', active: false, completed: true },
      { label: 'Voice', active: true, completed: false },
      { label: 'Flow', active: false, completed: false },
      { label: 'Summary', active: false, completed: false },
      { label: 'Try It', active: false, completed: false },
    ];
  };

  const handleNext = () => {
    navigate('/tools-selection');
  };

  const handleBack = () => {
    if (state.path === 'minimal') {
      navigate('/home');
    } else {
      navigate('/speech-to-speech');
    }
  };

  // Derive language groups and locales
  const LANGUAGE_GROUPS: Record<string, { label: string; locales: string[] }> = {
    English: { label: 'English', locales: ['en-US', 'en-GB', 'en-AU', 'en-IN'] },
    French: { label: 'French', locales: ['fr-FR'] },
    Italian: { label: 'Italian', locales: ['it-IT'] },
    German: { label: 'German', locales: ['de-DE'] },
    Spanish: { label: 'Spanish', locales: ['es-US'] },
    Portuguese: { label: 'Portuguese', locales: ['pt-BR'] },
    Hindi: { label: 'Hindi', locales: ['hi-IN'] },
  };

  // Filter to only languages that exist in the voice config
  const availableLanguages = Object.entries(LANGUAGE_GROUPS).filter(([, group]) =>
    group.locales.some((loc) => voiceConfig.languages.find((l) => l.id === loc))
  );

  // Determine selected language group
  const selectedLangGroup = availableLanguages.find(([, group]) =>
    group.locales.includes(state.voice.language)
  );
  const selectedLanguageName = selectedLangGroup?.[0] || 'English';

  // Get locales for selected language
  const localesForLanguage = LANGUAGE_GROUPS[selectedLanguageName]?.locales.filter((loc) =>
    voiceConfig.languages.find((l) => l.id === loc)
  ) || [];

  // Get voices for selected locale
  // - en-US: only tiffany & matthew (native en-US voices)
  // - other en-* locales: only voices whose first language matches that locale
  // - non-English: native voices first, then polyglot (tiffany/matthew) at the end
  const voicesForLocale = (() => {
    const locale = state.voice.language;

    if (locale === 'en-US') {
      // Only show tiffany and matthew for en-US
      return voiceConfig.voices.filter((v) => v.id === 'tiffany' || v.id === 'matthew');
    }

    if (locale.startsWith('en-')) {
      // Other English locales: only voices whose FIRST language is this locale
      return voiceConfig.voices.filter((v) => v.languages[0] === locale);
    }

    // Non-English: native voices first (any voice that has this locale but isn't tiffany/matthew),
    // then polyglot (tiffany/matthew)
    const native = voiceConfig.voices.filter(
      (v) => v.languages.includes(locale) && v.id !== 'tiffany' && v.id !== 'matthew'
    );
    const polyglot = voiceConfig.voices.filter(
      (v) => (v.id === 'tiffany' || v.id === 'matthew') && v.languages.includes(locale)
    );
    return [...native, ...polyglot];
  })();

  return (
    <PageWrapper
      title="Voice Selection"
      subtitle="Choose language, locale, and voice for your agent."
      steps={getSteps()}
      onNext={handleNext}
      onBack={handleBack}
      nextDisabled={!state.voice.voiceId}
    >
      <div className={styles.grid}>
        {/* Step 1: Language */}
        <div className={styles.section}>
          <label className={styles.label}>Language</label>
          <div className={styles.options}>
            {availableLanguages.map(([name, group]) => (
              <button
                key={name}
                className={`${styles.option} ${
                  selectedLanguageName === name ? styles.selected : ''
                }`}
                onClick={() =>
                  dispatch({
                    type: 'SET_VOICE',
                    payload: { language: group.locales[0], voiceId: '' },
                  })
                }
              >
                {group.label}
              </button>
            ))}
          </div>
        </div>

        {/* Step 2: Locale */}
        {localesForLanguage.length > 1 && (
          <div className={styles.section}>
            <label className={styles.label}>Locale</label>
            <div className={styles.options}>
              {localesForLanguage.map((loc) => {
                const langInfo = voiceConfig.languages.find((l) => l.id === loc);
                return (
                  <button
                    key={loc}
                    className={`${styles.option} ${
                      state.voice.language === loc ? styles.selected : ''
                    }`}
                    onClick={() =>
                      dispatch({
                        type: 'SET_VOICE',
                        payload: { language: loc, voiceId: '' },
                      })
                    }
                  >
                    <span className={styles.optionLabel}>{langInfo?.label || loc}</span>
                    <span className={styles.optionLocale}>{loc}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 3: Voices */}
        <div className={styles.section}>
          <label className={styles.label}>Voice</label>
          <div className={styles.voiceGrid}>
            {voicesForLocale.map((voice) => (
              <div
                key={voice.id}
                className={`${styles.voiceCard} ${
                  state.voice.voiceId === voice.id ? styles.voiceSelected : ''
                }`}
                onClick={() =>
                  dispatch({
                    type: 'SET_VOICE',
                    payload: { voiceId: voice.id, gender: voice.gender },
                  })
                }
              >
                <div className={styles.voiceHeader}>
                  <div className={styles.voiceName}>{voice.label}</div>
                  <span className={styles.genderBadge}>{voice.gender}</span>
                </div>
                {voice.sampleAudio && (
                  <button
                    className={styles.listenBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (playingVoice === voice.id) {
                        audioRef.current?.pause();
                        setPlayingVoice(null);
                      } else {
                        audioRef.current?.pause();
                        // Try Sonic first, then Polly fallback
                        const sonicSrc = `/audios/sonic/${voice.id}_${state.voice.language}.mp3`;
                        const pollySrc = `/audios/polly/${voice.id}_${state.voice.language}.mp3`;
                        const audio = new Audio(sonicSrc);
                        audioRef.current = audio;
                        audio.onerror = () => {
                          const fallback = new Audio(pollySrc);
                          audioRef.current = fallback;
                          fallback.onerror = () => setPlayingVoice(null);
                          fallback.onended = () => setPlayingVoice(null);
                          fallback.play();
                        };
                        audio.onended = () => setPlayingVoice(null);
                        audio.play();
                        setPlayingVoice(voice.id);
                      }
                    }}
                    title="Listen to sample"
                  >
                    {playingVoice === voice.id ? '⏹ Stop' : '▶ Listen'}
                  </button>
                )}
                {playingVoice === voice.id && (
                  <div className={styles.checkMark}>▶</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Audio player popup */}
      {playingVoice && (() => {
        const voice = voicesForLocale.find((v) => v.id === playingVoice);
        if (!voice) return null;
        return (
          <div className={styles.playerPopupOverlay} onClick={() => { audioRef.current?.pause(); setPlayingVoice(null); }}>
            <div className={styles.playerPopup} onClick={(e) => e.stopPropagation()}>
              <div className={styles.playerPopupWaves}>
                {[0, 0.08, 0.16, 0.04, 0.12, 0.2, 0.1, 0.06, 0.14, 0.18].map((delay, i) => (
                  <div key={i} className={styles.playerPopupWave} style={{ animationDelay: `${delay}s` }} />
                ))}
              </div>
              <div className={styles.playerPopupInfo}>
                <h3>{voice.label}</h3>
                <span>{voice.gender} • {state.voice.language}</span>
              </div>
              <button
                className={styles.playerPopupStop}
                onClick={() => { audioRef.current?.pause(); setPlayingVoice(null); }}
              >
                ⏹ Stop
              </button>
            </div>
          </div>
        );
      })()}
    </PageWrapper>
  );
}

export default Voice1S;
