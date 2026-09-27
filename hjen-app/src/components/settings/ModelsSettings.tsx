import { useEffect, useState } from 'react';
import {
  MODEL_CATALOG, TASKS, resolveModel, taskById,
  loadModelsConfig, saveModelsConfig,
  type Provider, type TaskId, type ModelsConfig,
} from '../../lib/models/registry';

/* ────────────────────────────────────────────────────────────────────────
 *  Models — the text-model dashboard. One row per HJEN task showing which
 *  model MAKES it by default, with a per-task override. Config stays
 *  overrides-only (re-selecting the default deletes the key).
 * ──────────────────────────────────────────────────────────────────────── */

/** Provider → the optgroup label shown in every select. */
const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI · ChatGPT',
  google: 'Google',
};

const PROVIDER_ORDER: Provider[] = ['anthropic', 'openai', 'google'];

/** Key-status strip: each provider + the bridge method the API Keys tab uses. */
const KEY_PROVIDERS: Array<{ provider: Provider; label: string; get: () => Promise<string | null> }> = [
  { provider: 'anthropic', label: 'Anthropic', get: () => window.hjen.getAnthropicKey() },
  { provider: 'openai', label: 'OpenAI', get: () => window.hjen.getApiKey() },
  { provider: 'google', label: 'Google', get: () => window.hjen.getGoogleKey() },
];

export function ModelsSettings() {
  const [cfg, setCfg] = useState<ModelsConfig>({ version: 1, tasks: {} });
  const [keys, setKeys] = useState<Record<Provider, boolean | null>>({ anthropic: null, openai: null, google: null });

  useEffect(() => { void loadModelsConfig().then(setCfg); }, []);
  useEffect(() => {
    let alive = true;
    void Promise.all(KEY_PROVIDERS.map(async k => [k.provider, !!(await k.get())?.trim()] as const))
      .then(pairs => {
        if (!alive) return;
        const next: Record<Provider, boolean | null> = { anthropic: false, openai: false, google: false };
        for (const [p, present] of pairs) next[p] = present;
        setKeys(next);
      });
    return () => { alive = false; };
  }, []);

  const setTaskModel = (task: TaskId, modelId: string) => {
    const nextTasks = { ...cfg.tasks };
    if (modelId === taskById(task).defaultModel) delete nextTasks[task];  // keep config overrides-only
    else nextTasks[task] = modelId;
    const next: ModelsConfig = { version: 1, tasks: nextTasks };
    setCfg(next);
    void saveModelsConfig(next);
  };

  return (
    <>
      <h1 className="settings-page__h1">Models</h1>
      <p className="settings-page__lede" dir="rtl">النماذج — من يشغّل كل مهمة داخل هجين.</p>
      <p className="settings-page__lede">The default text model behind every HJEN task — you pick who makes what.</p>

      <div className="settings-section__label">Provider keys</div>
      <div className="models-keys">
        {KEY_PROVIDERS.map(k => {
          const present = keys[k.provider];
          const state = present == null ? 'load' : present ? 'ok' : 'warn';
          return (
            <span key={k.provider} className={`models-keychip models-keychip--${state}`}>
              <span className="models-keychip__dot" aria-hidden />
              <span className="models-keychip__name">{k.label}</span>
              <span className="models-keychip__hint">
                {state === 'load' ? '…' : state === 'ok' ? 'key set' : 'add in API Keys'}
              </span>
            </span>
          );
        })}
      </div>

      <div className="settings-section__label">Task → model</div>
      <div className="models-table">
        {TASKS.map(task => {
          const current = resolveModel(task.id, cfg);
          const isDefault = current.id === task.defaultModel;
          return (
            <div key={task.id} className="models-row">
              <div className="models-row__info">
                <div className="models-row__name" dir="auto">{task.ar}</div>
                <div className="models-row__sub">
                  <span className="models-row__en">{task.en}</span>
                  <span className="models-row__desc" dir="auto"> · {task.desc}</span>
                  {/* not yet routed through the registry — switching it takes
                      effect when that tool's code path lands on llmForTask */}
                  {!task.routed && <span className="models-soon" dir="auto">قريبًا</span>}
                </div>
              </div>

              <div className="models-row__control">
                {isDefault
                  ? <span className="models-default mono-label">default</span>
                  : <button className="models-reset" onClick={() => setTaskModel(task.id, task.defaultModel)}>reset</button>}
                <select
                  className="models-select"
                  value={current.id}
                  onChange={e => setTaskModel(task.id, e.target.value)}
                >
                  {PROVIDER_ORDER.map(p => {
                    const opts = MODEL_CATALOG.filter(m => m.provider === p);
                    if (!opts.length) return null;
                    return (
                      <optgroup key={p} label={PROVIDER_LABEL[p]}>
                        {opts.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                      </optgroup>
                    );
                  })}
                </select>
              </div>
            </div>
          );
        })}
      </div>

      <div className="setting-footnote mono-label">
        Overrides save to {'{userData}'}/models_config.json — the main process reads the same file, so every tool makes with your choice. Unset rows fall back to the HJEN default.
      </div>
    </>
  );
}
