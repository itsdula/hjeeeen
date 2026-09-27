import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { AppearanceSettings } from './settings/AppearanceSettings';
import { ModelsSettings } from './settings/ModelsSettings';
import { TranscriptionSettings } from './settings/TranscriptionSettings';
import { SyncSettings } from './settings/SyncSettings';
import { BrowserSettings } from './settings/BrowserSettings';
import { ToolsSettings } from './settings/ToolsSettings';
import { UpdateCard } from './settings/UpdateCard';
import { PROFILE } from './TopBarMenus';
import { loadUserFonts } from '../lib/userFonts';
import { useLang, useLangMode, type LangMode } from '../lib/lang/translate';
import {
  MODEL_CATALOG, resolveModel, taskById, loadModelsConfig, saveModelsConfig,
  type Provider, type ModelsConfig,
} from '../lib/models/registry';

/* ────────────────────────────────────────────────────────────────────────
 *  Settings — a full page with a tabbed rail, replacing the
 *  old modal. Tabs: Account · General · API Keys · Appearance.
 * ──────────────────────────────────────────────────────────────────────── */

type Tab = 'account' | 'general' | 'keys' | 'models' | 'transcription' | 'sync' | 'browser' | 'tools' | 'fonts' | 'appearance';

// Sync mirrors cloud deliverables into a local folder — meaningless on web
// (there the files already live in the cloud, browsed via Files). The web
// build sets window.hjen.__web; desktop leaves it falsy.
const IS_DESKTOP = !window.hjen?.__web;

const TABS: Array<{ id: Tab; label: string; desktopOnly?: boolean }> = [
  { id: 'account', label: 'Account' },
  { id: 'general', label: 'General' },
  { id: 'keys', label: 'API Keys' },
  { id: 'models', label: 'Models' },
  { id: 'transcription', label: 'Transcription' },
  { id: 'sync', label: 'Sync', desktopOnly: true },
  { id: 'browser', label: 'Browser', desktopOnly: true },
  { id: 'tools', label: 'Tools', desktopOnly: true },
  { id: 'fonts', label: 'Fonts' },
  { id: 'appearance', label: 'Appearance' },
];

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('account');
  const tabs = TABS.filter(t => !t.desktopOnly || IS_DESKTOP);
  return (
    <div className="settings-page">
      <aside className="settings-page__rail">
        <div className="settings-page__railtitle mono-label">Settings</div>
        {tabs.map(t => (
          <button
            key={t.id}
            className={`settings-page__tab ${tab === t.id ? 'settings-page__tab--on' : ''}`}
            onClick={() => setTab(t.id)}
          >{t.label}</button>
        ))}
      </aside>

      <main className="settings-page__main">
        {tab === 'account' && <AccountTab />}
        {tab === 'general' && <GeneralTab />}
        {tab === 'keys' && <KeysTab />}
        {tab === 'models' && <ModelsSettings />}
        {tab === 'transcription' && <TranscriptionSettings />}
        {tab === 'sync' && IS_DESKTOP && <SyncSettings />}
        {tab === 'browser' && IS_DESKTOP && <BrowserSettings />}
        {tab === 'tools' && IS_DESKTOP && <ToolsSettings />}
        {tab === 'fonts' && <FontsTab />}
        {tab === 'appearance' && (
          <>
            <h1 className="settings-page__h1">Appearance</h1>
            <p className="settings-page__lede">Theme, controls, and brand look.</p>
            <div className="settings-page__appearance"><AppearanceSettings /></div>
          </>
        )}
      </main>
    </div>
  );
}

/* ─── Account ─────────────────────────────────────────────────────────── */

function AccountTab() {
  const setActiveView = useStore(s => s.setActiveView);
  return (
    <>
      <h1 className="settings-page__h1">Account</h1>
      <p className="settings-page__lede">Your workspace identity and plan.</p>

      <div className="settings-account-card">
        <span className="account-avatar account-avatar--lg" aria-hidden />
        <div className="settings-account-card__id">
          <div className="settings-account-card__name">
            {PROFILE.name}
            <span className="account-badge account-badge--head">{PROFILE.plan}</span>
          </div>
          <div className="settings-account-card__email">{PROFILE.email}</div>
        </div>
      </div>

      <div className="settings-section__label">Plan &amp; usage</div>
      <div className="settings-linkrow">
        <button className="settings-page-link" onClick={() => setActiveView('usage')}>Usage</button>
        <button className="settings-page-link" onClick={() => setActiveView('pricing')}>Billing</button>
        <button className="settings-page-link" onClick={() => setActiveView('support')}>Support inbox</button>
      </div>
    </>
  );
}

/* ─── General ─────────────────────────────────────────────────────────── */

function GeneralTab() {
  const setActiveView = useStore(s => s.setActiveView);
  const projectsRoot = useStore(s => s.projectsRoot);
  const changeProjectsRoot = useStore(s => s.changeProjectsRoot);
  const loadProjects = useStore(s => s.loadProjects);
  const [savedRoot, setSavedRoot] = useState(false);

  const pickRoot = async () => {
    const picked = await window.hjen.pickFolder();
    if (!picked) return;
    await changeProjectsRoot(picked);
    await loadProjects();
    setSavedRoot(true);
  };

  return (
    <>
      <h1 className="settings-page__h1">General</h1>
      <p className="settings-page__lede">Version, storage and quick links.</p>

      {/* First on the page: the version you are running, and the button that
          asks the release feed whether there is a newer one. */}
      <UpdateCard />

      <div className="settings-section__label">Pages</div>
      <div className="settings-linkrow">
        <button className="settings-page-link" onClick={() => setActiveView('library')}>Library</button>
        <button className="settings-page-link" onClick={() => setActiveView('usage')}>Usage</button>
        <button className="settings-page-link" onClick={() => setActiveView('pricing')}>Pricing</button>
        <button className="settings-page-link" onClick={() => setActiveView('support')}>Support inbox</button>
      </div>

      <ContentLanguageSection />

      <div className="settings-section__label">Projects folder — where all projects + frames are stored</div>
      <div className="setting-row">
        <input className="setting-input" value={projectsRoot} readOnly placeholder="(default: ~/Pictures/HJEN Studio)" />
        <button className="btn-primary" onClick={pickRoot}>Choose…</button>
      </div>
      {savedRoot && <div className="setting-saved">Projects root updated. Future frames will save here.</div>}
      <div className="setting-meta">Existing project folders are not moved automatically. Move them manually in Finder if needed.</div>
    </>
  );
}

/* ─── Content language — لغة المحتوى ──────────────────────────────────────
 * English is ALWAYS the source of truth; Arabic is a translation of it, made
 * by the arabic-translate task. Governs Brief Mind canvas nodes + Treatment +
 * Story. (Arabic strings here carry letter-spacing: 0 — the joined-letters law.)
 */

const LANG_OPTIONS: Array<{ v: LangMode; l: string; ar?: boolean }> = [
  { v: 'en', l: 'English' },
  { v: 'ar', l: 'العربية', ar: true },
  { v: 'both', l: 'Both' },
];

/** Provider → optgroup label, mirroring the Models dashboard. */
const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI · ChatGPT',
  google: 'Google',
};
const PROVIDER_ORDER: Provider[] = ['anthropic', 'openai', 'google'];

function ContentLanguageSection() {
  const mode = useLangMode();
  const setMode = useLang(s => s.setMode);
  return (
    <>
      <div className="settings-section__label">
        Content language<span className="settings-section__ar"> — لغة المحتوى</span>
      </div>

      <div className="segmented" role="tablist" aria-label="Content language">
        {LANG_OPTIONS.map(o => (
          <button
            key={o.v}
            role="tab"
            aria-selected={mode === o.v}
            className={`segmented__opt${mode === o.v ? ' segmented__opt--on' : ''}${o.ar ? ' segmented__opt--ar' : ''}`}
            onClick={() => setMode(o.v)}
          >{o.l}</button>
        ))}
      </div>

      <div className="setting-meta setting-meta--ar" dir="rtl">
        الأصل دائمًا إنجليزي — عند اختيار العربية تُترجم النصوص من الأصل بموديل الترجمة.
      </div>

      <div className="settings-lang-model">
        <label className="setting-label">
          Translation model<span className="settings-section__ar"> — موديل الترجمة</span>
        </label>
        <TranslationModelRow />
      </div>

      <div className="setting-meta">
        Applies to the Brief Mind canvas (species · compression · seeds · collider), Treatment, and Story.
      </div>
    </>
  );
}

/** Compact model picker for the arabic-translate task — the ModelsSettings
 *  pattern, overrides-only (choosing the default deletes the key). */
function TranslationModelRow() {
  const [cfg, setCfg] = useState<ModelsConfig>({ version: 1, tasks: {} });
  useEffect(() => { void loadModelsConfig().then(setCfg); }, []);

  const current = resolveModel('arabic-translate', cfg);
  const defaultModel = taskById('arabic-translate').defaultModel;
  const isDefault = current.id === defaultModel;

  const setModel = (id: string) => {
    const nextTasks = { ...cfg.tasks };
    if (id === defaultModel) delete nextTasks['arabic-translate'];
    else nextTasks['arabic-translate'] = id;
    const next: ModelsConfig = { version: 1, tasks: nextTasks };
    setCfg(next);
    void saveModelsConfig(next);
  };

  return (
    <div className="settings-lang-model__row">
      <select
        className="models-select"
        value={current.id}
        onChange={e => setModel(e.target.value)}
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
      {isDefault
        ? <span className="models-default mono-label">default</span>
        : <button className="models-reset" onClick={() => setModel(defaultModel)}>reset</button>}
    </div>
  );
}

/* ─── Fonts ───────────────────────────────────────────────────────────── */

function FontsTab() {
  const [fonts, setFonts] = useState<Array<{ family: string; file: string; path: string }>>([]);
  const [busy, setBusy] = useState(false);

  const refresh = async () => { setFonts((await window.hjen.listFonts()) ?? []); };
  useEffect(() => { void refresh(); }, []);

  const add = async () => {
    setBusy(true);
    try {
      const res = await window.hjen.addFonts();
      if (res?.fonts) setFonts(res.fonts);
      await loadUserFonts();   // register the new families app-wide
    } finally { setBusy(false); }
  };
  const remove = async (file: string) => {
    const res = await window.hjen.removeFont(file);
    if (res?.fonts) setFonts(res.fonts);
    await loadUserFonts();
  };

  return (
    <>
      <h1 className="settings-page__h1">Fonts</h1>
      <p className="settings-page__lede">Add your own fonts. They register with every tool (Pitch, decks, …) and install device-wide.</p>

      <div className="setting-row" style={{ gap: 10 }}>
        <button className="btn-primary" onClick={add} disabled={busy}>{busy ? 'Adding…' : 'Add fonts…'}</button>
        <button className="settings-page-link" onClick={() => window.hjen.openFontsDir()}>Open Fonts folder</button>
      </div>

      <div className="settings-section__label">Installed fonts — {fonts.length}</div>
      {fonts.length === 0 ? (
        <div className="setting-meta">No fonts yet. Add .ttf / .otf / .woff files — each becomes available in the font pickers.</div>
      ) : (
        <div className="settings-fonts">
          {fonts.map(f => (
            <div key={f.file} className="settings-font">
              <span className="settings-font__preview" style={{ fontFamily: `"${f.family}", serif` }}>Abc أبج 123</span>
              <span className="settings-font__name">{f.family}</span>
              <button className="settings-page-link settings-font__del" onClick={() => remove(f.file)}>Remove</button>
            </div>
          ))}
        </div>
      )}
      <div className="setting-meta">Files live in the app's Fonts folder and are copied into your OS user-fonts folder so other apps can use them too.</div>
    </>
  );
}

/* ─── API Keys ────────────────────────────────────────────────────────── */

interface KeyDef {
  label: string;
  placeholder: string;
  get: () => Promise<string | null>;
  set: (v: string) => Promise<boolean>;
  meta?: React.ReactNode;
  noun?: string;
}

function KeysTab() {
  const KEYS: KeyDef[] = [
    {
      label: 'OpenAI API key — for ChatGPT Image 2.0',
      placeholder: 'sk-...',
      get: () => window.hjen.getApiKey(), set: v => window.hjen.setApiKey(v),
    },
    {
      label: 'Google AI API key — for Nano Banana Pro (Imagen)',
      placeholder: 'AIza...',
      get: () => window.hjen.getGoogleKey(), set: v => window.hjen.setGoogleKey(v),
    },
    {
      label: 'Anthropic API key — for the Enhance prompt feature (Claude vision)',
      placeholder: 'sk-ant-...',
      get: () => window.hjen.getAnthropicKey(), set: v => window.hjen.setAnthropicKey(v),
      meta: 'Enhancement reads your prompt + attached references (vision) and rewrites scene-only direction. Camera / lens / film / lighting / style chips are never duplicated in prose.',
    },
    {
      label: 'Replicate API token — for the Enhancer (CodeFormer + Clarity Upscaler)',
      placeholder: 'r8_...', noun: 'token',
      get: () => window.hjen.getReplicateKey(), set: v => window.hjen.setReplicateKey(v),
      meta: 'Face restoration via Replicate-hosted open-source models: sczhou/codeformer and optional philz1337x/clarity-upscaler. Get a token at replicate.com/account.',
    },
    {
      label: 'BytePlus ARK API key — for the Video product (Seedance 2.0)',
      placeholder: 'ark-...',
      get: () => window.hjen.getArkKey(), set: v => window.hjen.setArkKey(v),
      meta: 'Video animates HJEN stills with BytePlus Seedance 2.0 (dreamina-seedance-2-0-260128). Default region: ap-southeast (Singapore). Get a key at console.byteplus.com → ModelArk.',
    },
    {
      label: 'Kling API key — for the Video product (Kling 3.0 family)',
      placeholder: 'Bearer key from Kling console',
      get: () => window.hjen.getKlingKey(), set: v => window.hjen.setKlingKey(v),
      meta: 'Video via Kling (Kuaishou): 3.0 Turbo / 3.0 / 3.0 Omni / O1 / 2.6 / 2.5 Turbo. Create a key at kling.ai/dev/api-key → “+ New API Key” (shown once). Global host: api-singapore.klingai.com.',
    },
  ];

  return (
    <>
      <h1 className="settings-page__h1">API Keys</h1>
      <p className="settings-page__lede">Direct-to-vendor keys. Stored locally, never sent anywhere but the vendor.</p>
      <GatewaySection />
      <div className="settings-section__label" style={{ marginTop: 22 }}>Your own keys</div>
      {KEYS.map((k, i) => <KeyField key={i} def={k} />)}
      <div className="setting-footnote mono-label">
        Config + keys stored at ~/Library/Application Support/HJEN Studio/. Never transmitted except to their respective provider.
      </div>
    </>
  );
}

// Cloud connection: paste an HJEN invite link → the app routes every make
// through HJEN's server (no personal keys needed). Clearing it returns to
// your own keys above. This is the packaged app's opt-in to the cloud gateway.
function GatewaySection() {
  const [link, setLink] = useState('');
  const [active, setActive] = useState<{ url: string } | null>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => { window.hjen.getGateway?.().then((g: any) => { if (g?.url) setActive({ url: g.url }); }); }, []);

  // Accept a full magic link (https://demo.hjen.ai/s/<token>) and split it.
  function parse(raw: string): { url: string; token: string } | null {
    try {
      const u = new URL(raw.trim());
      const m = u.pathname.match(/\/s\/([^/?#]+)/);
      if (!m) return null;
      return { url: `${u.protocol}//${u.host}`, token: m[1] };
    } catch { return null; }
  }

  async function connect() {
    const cfg = parse(link);
    if (!cfg) { setMsg('Paste a full invite link like https://demo.hjen.ai/s/…'); return; }
    const ok = await window.hjen.setGateway?.(cfg);
    if (ok) { setActive({ url: cfg.url }); setLink(''); setMsg('Connected — restart to apply everywhere.'); }
    else setMsg('Could not save. Try again.');
  }
  async function disconnect() {
    await window.hjen.setGateway?.(null);
    setActive(null); setMsg('Disconnected — using your own keys. Restart to apply.');
  }

  return (
    <div className="settings-gateway">
      <div className="settings-section__label">HJEN cloud connection</div>
      {active ? (
        <div className="settings-linkrow" style={{ alignItems: 'center', gap: 12 }}>
          <span className="account-badge account-badge--head">Connected</span>
          <span className="settings-account-card__email">{active.url}</span>
          <button className="settings-page-link" onClick={disconnect}>Disconnect</button>
        </div>
      ) : (
        <div className="settings-linkrow" style={{ gap: 8 }}>
          <input
            className="setting-input"
            style={{ flex: 1 }}
            placeholder="Paste your HJEN invite link — https://demo.hjen.ai/s/…"
            value={link}
            onChange={e => setLink(e.target.value)}
          />
          <button className="settings-page-link" onClick={connect}>Connect</button>
        </div>
      )}
      <div className="setting-footnote mono-label">
        With a cloud connection, HJEN runs makes on our servers with metered quota — no personal keys needed. Without one, the app uses your own keys below.
      </div>
      {msg && <div className="setting-footnote" style={{ color: 'var(--accent, #e0a449)' }}>{msg}</div>}
    </div>
  );
}

function KeyField({ def }: { def: KeyDef }) {
  const [val, setVal] = useState('');
  const [has, setHas] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const noun = def.noun ?? 'key';

  useEffect(() => { def.get().then(setHas); }, []);

  const save = async () => {
    if (!val.trim()) return;
    await def.set(val.trim());
    setHas(val.trim());
    setSaved(true);
    setVal('');
  };

  return (
    <div className="settings-key">
      <label className="setting-label">{def.label}</label>
      <div className="setting-row">
        <input
          type="password"
          className="setting-input"
          placeholder={has ? '••••••••••••••••' : def.placeholder}
          value={val}
          onChange={e => { setVal(e.target.value); setSaved(false); }}
        />
        <button className="btn-primary" onClick={save} disabled={!val.trim()}>Save</button>
      </div>
      {saved && <div className="setting-saved">Saved.</div>}
      {has && !saved && <div className="setting-meta">A {noun} is configured.</div>}
      {def.meta && <div className="setting-meta">{def.meta}</div>}
    </div>
  );
}
