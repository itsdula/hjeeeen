import { useEffect, useState } from 'react';

/* ────────────────────────────────────────────────────────────────────────
 *  Transcription (ASR) — the engine that hears the ad's dialogue/VO for the
 *  BREAKDOWN "content understanding" layer. Arabic-first. Swappable:
 *    · Local whisper (whisper.cpp) — offline, no middlemen (Anwar's default)
 *    · OpenAI Whisper API — works today, strong on Arabic
 *    · Custom — any OpenAI-compatible /audio/transcriptions (e.g. WhisperFlow)
 *  Config lives in settings.json via hjen:transcription-config-{read,write}.
 * ──────────────────────────────────────────────────────────────────────── */

type Engine = 'local-whisper' | 'openai' | 'custom';
interface TxConfig { engine: Engine; model: string; language: string; endpoint?: string }

const ENGINES: Array<{ v: Engine; l: string }> = [
  { v: 'local-whisper', l: 'Local whisper' },
  { v: 'openai', l: 'OpenAI' },
  { v: 'custom', l: 'Custom API' },
];
const LANGS: Array<{ v: string; l: string; ar?: boolean }> = [
  { v: 'auto', l: 'Auto' },
  { v: 'ar', l: 'العربية', ar: true },
  { v: 'en', l: 'English' },
];
// Sensible per-engine model default so switching engine offers the right hint.
const MODEL_HINT: Record<Engine, string> = {
  'local-whisper': 'large-v3',   // Arabic-capable — never "base"
  openai: 'whisper-1',
  custom: 'whisper-1',
};

export function TranscriptionSettings() {
  const [cfg, setCfg] = useState<TxConfig | null>(null);

  useEffect(() => {
    let alive = true;
    void window.hjen.transcriptionConfigRead().then(r => { if (alive) setCfg(r.config as TxConfig); });
    return () => { alive = false; };
  }, []);

  const patch = (p: Partial<TxConfig>) => {
    setCfg(prev => {
      const next = { ...(prev as TxConfig), ...p };
      void window.hjen.transcriptionConfigWrite({ config: next });
      return next;
    });
  };

  if (!cfg) return <div className="settings-page__lede">Loading…</div>;

  return (
    <>
      <h1 className="settings-page__h1">Transcription</h1>
      <p className="settings-page__lede" dir="rtl">التفريغ الصوتي — المحرّك الذي يسمع حوار الإعلان لطبقة الفهم. العربية أولاً.</p>
      <p className="settings-page__lede">The engine that transcribes an ad's dialogue/VO for BREAKDOWN. Runs on any film — including uploads with no subtitles.</p>

      <div className="settings-section__label">Engine<span className="settings-section__ar"> — المحرّك</span></div>
      <div className="segmented" role="tablist" aria-label="ASR engine">
        {ENGINES.map(e => (
          <button
            key={e.v}
            role="tab"
            aria-selected={cfg.engine === e.v}
            className={`segmented__opt${cfg.engine === e.v ? ' segmented__opt--on' : ''}`}
            onClick={() => patch({ engine: e.v, model: MODEL_HINT[e.v] })}
          >{e.l}</button>
        ))}
      </div>
      <div className="setting-meta">
        {cfg.engine === 'local-whisper'
          ? 'Offline · no middlemen. Needs whisper.cpp + a ggml model installed. If it isn’t found, a run falls back to the OpenAI API (when a key is set).'
          : cfg.engine === 'openai'
            ? 'Direct to OpenAI’s Whisper API — works today with your OpenAI key, strong on Arabic.'
            : 'Any OpenAI-compatible /audio/transcriptions endpoint (e.g. WhisperFlow). Uses your OpenAI key unless the endpoint needs none.'}
      </div>

      <div className="settings-section__label">Language<span className="settings-section__ar"> — اللغة</span></div>
      <div className="segmented" role="tablist" aria-label="Transcription language">
        {LANGS.map(o => (
          <button
            key={o.v}
            role="tab"
            aria-selected={cfg.language === o.v}
            className={`segmented__opt${cfg.language === o.v ? ' segmented__opt--on' : ''}${o.ar ? ' segmented__opt--ar' : ''}`}
            onClick={() => patch({ language: o.v })}
          >{o.l}</button>
        ))}
      </div>
      <div className="setting-meta setting-meta--ar" dir="rtl">
        «تلقائي» يكشف اللغة (يناسب الإعلانات ثنائية اللغة). اختر «العربية» لفرضها على إعلان سعودي/خليجي واضح.
      </div>

      <div className="settings-section__label">Model<span className="settings-section__ar"> — النموذج</span></div>
      <input
        className="setting-input"
        value={cfg.model}
        placeholder={MODEL_HINT[cfg.engine]}
        onChange={e => patch({ model: e.target.value })}
        spellCheck={false}
      />
      <div className="setting-meta">
        {cfg.engine === 'local-whisper'
          ? 'ggml model name — large-v3 / medium give real Arabic; avoid base (weak on Arabic).'
          : 'API model name — e.g. whisper-1, or gpt-4o-transcribe.'}
      </div>

      {cfg.engine === 'custom' && (
        <>
          <div className="settings-section__label">Endpoint<span className="settings-section__ar"> — العنوان</span></div>
          <input
            className="setting-input"
            value={cfg.endpoint || ''}
            placeholder="https://…/v1/audio/transcriptions"
            onChange={e => patch({ endpoint: e.target.value })}
            spellCheck={false}
          />
          <div className="setting-meta">OpenAI-compatible transcription endpoint. Sends the audio as multipart, expects verbose_json segments.</div>
        </>
      )}
    </>
  );
}
