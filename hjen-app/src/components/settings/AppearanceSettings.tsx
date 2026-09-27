import { useState } from 'react';
import { useStore } from '../../store';
import { BUILTIN_THEMES, DEFAULT_THEME, getBuiltin } from '../../lib/theme/presets';
import { FONT_CHOICES, fontChoiceIdFromStack, resolveHubTiles, type Theme, type LogoMode } from '../../lib/theme/types';
import { hjenFileUrl, BG_SHADE_THEME, bgShadeFromPosition, positionFromBgShade } from '../../lib/theme/apply';
import { detectedTrafficLights, readTrafficLightsPref, setTrafficLightsPref } from '../../lib/trafficLights';

// A browser tab has no native window buttons, so the whole control is desktop-only.
const IS_DESKTOP = !window.hjen?.__web;

/** Coherent surface+ink ramps applied when the user flips the Base switch. */
const DARK_RAMP = {
  bg: '#121212', bgElev: '#141414', bgElev2: '#1D1D1D', topbar: '#1e1e1e',
  ink: '#FFFFFF',
  inkDim: 'rgba(255, 255, 255, 0.72)', inkMuted: 'rgba(255, 255, 255, 0.48)', inkFaint: 'rgba(255, 255, 255, 0.24)',
  line: 'rgba(255, 255, 255, 0.10)', lineStrong: 'rgba(255, 255, 255, 0.22)',
};
const LIGHT_RAMP = {
  bg: '#FFFFFF', bgElev: '#F5F5F5', bgElev2: '#ECECEE', topbar: '#FFFFFF',
  ink: '#0A0A0B',
  inkDim: 'rgba(10, 10, 11, 0.74)', inkMuted: 'rgba(10, 10, 11, 0.52)', inkFaint: 'rgba(10, 10, 11, 0.28)',
  line: 'rgba(10, 10, 11, 0.12)', lineStrong: 'rgba(10, 10, 11, 0.24)',
};

const PRODUCTS: Array<{ id: string; label: string }> = [
  { id: 'frame', label: 'Frame' },
  { id: 'enhancer', label: 'Enhancer' },
  { id: 'node', label: 'Node' },
  { id: 'storyboard', label: 'Storyboard' },
  { id: 'story', label: 'Story' },
  { id: 'video', label: 'Video' },
  { id: 'references', label: 'References' },
  { id: 'shotlist', label: 'Shotlist' },
];

const LOGO_MODES: Array<{ id: LogoMode; label: string }> = [
  { id: 'wordmark', label: 'Wordmark' },
  { id: 'mark', label: 'Mark' },
  { id: 'text', label: 'Text' },
  { id: 'hidden', label: 'Hidden' },
  { id: 'custom', label: 'Custom' },
];

export function AppearanceSettings() {
  const activeThemeId = useStore(s => s.activeThemeId);
  const customThemes = useStore(s => s.customThemes);
  const appearance = useStore(s => s.appearance);
  const setAppearance = useStore(s => s.setAppearance);
  const hubTiles = useStore(s => s.hubTiles);
  const setHubTiles = useStore(s => s.setHubTiles);
  const bgShade = useStore(s => s.bgShade);
  const setBgShade = useStore(s => s.setBgShade);
  const setActiveTheme = useStore(s => s.setActiveTheme);
  const effectiveTiles = resolveHubTiles(appearance, hubTiles);
  const [lights, setLights] = useState(readTrafficLightsPref);
  const detected = detectedTrafficLights();
  const shadeOn = bgShade !== BG_SHADE_THEME;
  const updateActiveTheme = useStore(s => s.updateActiveTheme);
  const duplicateTheme = useStore(s => s.duplicateTheme);
  const renameTheme = useStore(s => s.renameTheme);
  const deleteTheme = useStore(s => s.deleteTheme);
  const importThemeFromFile = useStore(s => s.importThemeFromFile);
  const exportThemeToFile = useStore(s => s.exportThemeToFile);

  const allThemes: Theme[] = [...BUILTIN_THEMES, ...customThemes];
  const active = getBuiltin(activeThemeId) || customThemes.find(t => t.id === activeThemeId) || DEFAULT_THEME;
  const editable = !active.builtin;

  return (
    <>
      {/* Interface mode — Classic (default) / Pro re-skin. Orthogonal to the
          theme below; applies live and persists across restarts. */}
      <div className="appearance-mode">
        <div className="appearance-mode__copy">
          <span className="mono-label">Interface</span>
          <p className="appearance-mode__lede">
            <strong>Pro</strong> gives the professional-tool feel — dense layout,
            hard edges, flat industrial controls, recessed inputs. It changes
            structure only; colours stay yours (theme, editor, and shade below).
          </p>
        </div>
        <div className="appearance-mode__pick" role="tablist" aria-label="Interface mode">
          {([
            { v: 'classic', l: 'Classic', d: 'The signature look' },
            { v: 'pro', l: 'Pro', d: 'Dense · sharp · flat' },
          ] as const).map(o => (
            <button
              key={o.v}
              role="tab"
              aria-selected={appearance === o.v}
              className={`appearance-mode__opt ${appearance === o.v ? 'appearance-mode__opt--on' : ''}`}
              onClick={() => setAppearance(o.v)}
            >
              <span className="appearance-mode__opt-name">{o.l}</span>
              <span className="appearance-mode__opt-desc">{o.d}</span>
            </button>
          ))}
        </div>

        <div className="appearance-mode__rule" />

        {/* Hub tiles — how the Studio product cards are coloured. Independent of
            the interface mode; defaults follow it (identity in Classic,
            industrial in Pro) until the user picks explicitly. */}
        <div className="appearance-mode__copy">
          <span className="mono-label">Hub tiles</span>
          <p className="appearance-mode__lede">
            How the Studio cards read — the product's registered colour, a full
            neutral graphite plate, or a faint tint over graphite.
          </p>
        </div>
        <div className="appearance-mode__pick appearance-mode__pick--three" role="tablist" aria-label="Hub tiles">
          {([
            { v: 'industrial', l: 'Industrial', d: 'Graphite · icon-led' },
            { v: 'identity', l: 'Identity', d: 'Product colour' },
            { v: 'faint', l: 'Faint', d: 'Quiet tint' },
          ] as const).map(o => (
            <button
              key={o.v}
              role="tab"
              aria-selected={effectiveTiles === o.v}
              className={`appearance-mode__opt ${effectiveTiles === o.v ? 'appearance-mode__opt--on' : ''}`}
              onClick={() => setHubTiles(o.v)}
            >
              <span className="appearance-mode__opt-name">{o.l}</span>
              <span className="appearance-mode__opt-desc">{o.d}</span>
            </button>
          ))}
        </div>

        <div className="appearance-mode__rule" />

        {/* Background shade — a neutral-grey --bg override; surfaces derive from
            it. Most at home in Pro (industrial darkness), but works in any mode.
            "Theme default" leaves the active theme's background untouched. */}
        <div className="appearance-mode__copy">
          <span className="mono-label">Background shade</span>
          <p className="appearance-mode__lede">
            How dark the workspace sits, on a neutral grey scale — panels and bars
            derive from it. Keep the theme's own background, or dial it in.
          </p>
        </div>
        <div className="appearance-shade">
          <button
            className={`appearance-shade__default ${!shadeOn ? 'is-on' : ''}`}
            onClick={() => setBgShade(BG_SHADE_THEME)}
          >Theme default</button>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round((shadeOn ? positionFromBgShade(bgShade) : 0.5) * 100)}
            className="appearance-shade__range"
            aria-label="Background shade"
            onChange={e => setBgShade(bgShadeFromPosition(Number(e.target.value) / 100))}
          />
          <span
            className="appearance-shade__swatch"
            style={{ background: shadeOn ? bgShade : 'var(--bg)' }}
            title={shadeOn ? bgShade : 'theme default'}
          />
        </div>

        {/* Window buttons — desktop only; a browser tab has none to work around. */}
        {IS_DESKTOP && (
          <>
            <div className="appearance-mode__rule" />
            <div className="appearance-mode__copy">
              <span className="mono-label">Window buttons</span>
              <p className="appearance-mode__lede">
                macOS puts close, minimise and full screen on the right instead of the left when the
                system language reads right to left. The top bar leaves them room on that side —
                detected as <strong>{detected}</strong> here. Set it yourself if the gap is on the
                wrong side.
              </p>
            </div>
            <div className="appearance-mode__pick appearance-mode__pick--three" role="tablist" aria-label="Window buttons">
              {([
                { v: 'auto', l: 'Automatic', d: `Follow macOS · ${detected}` },
                { v: 'left', l: 'Left', d: 'Room kept on the left' },
                { v: 'right', l: 'Right', d: 'Room kept on the right' },
              ] as const).map(o => (
                <button
                  key={o.v}
                  role="tab"
                  aria-selected={lights === o.v}
                  className={`appearance-mode__opt ${lights === o.v ? 'appearance-mode__opt--on' : ''}`}
                  onClick={() => { setTrafficLightsPref(o.v); setLights(o.v); }}
                >
                  <span className="appearance-mode__opt-name">{o.l}</span>
                  <span className="appearance-mode__opt-desc">{o.d}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="modal__body appearance">
      {/* Left rail — theme list */}
      <aside className="appearance__list">
        <div className="appearance__list-head">
          <span className="mono-label">Themes</span>
          <div className="appearance__list-actions">
            <button className="appearance__mini-btn" onClick={() => duplicateTheme(activeThemeId)} title="New theme from current">+ New</button>
            <button className="appearance__mini-btn" onClick={() => importThemeFromFile()} title="Import a theme JSON">Import</button>
          </div>
        </div>
        <div className="appearance__cards">
          {allThemes.map(t => (
            <button
              key={t.id}
              className={`theme-card ${t.id === activeThemeId ? 'theme-card--active' : ''}`}
              onClick={() => setActiveTheme(t.id)}
            >
              <span className="theme-card__swatch" style={{ background: t.tokens.bg }}>
                <span className="theme-card__dot" style={{ background: t.tokens.accent }} />
                <span className="theme-card__dot" style={{ background: t.tokens.ink }} />
                <span className="theme-card__dot" style={{ background: t.tokens.bgElev2 }} />
              </span>
              <span className="theme-card__meta">
                <span className="theme-card__name">{t.name}</span>
                <span className="theme-card__tag">{t.builtin ? 'Built-in' : 'Custom'}</span>
              </span>
              {t.id === activeThemeId && <span className="theme-card__check">✓</span>}
            </button>
          ))}
        </div>
      </aside>

      {/* Right — editor */}
      <section className="appearance__editor">
        {!editable ? (
          <div className="appearance__readonly">
            <p className="setting-meta" style={{ marginTop: 0 }}>
              <strong>{active.name}</strong> is a built-in theme and can't be edited directly.
              Duplicate it to create an editable copy.
            </p>
            <button className="btn-primary" onClick={() => duplicateTheme(active.id)}>Duplicate to edit</button>
            <ThemePreviewStrip />
          </div>
        ) : (
          <EditableTheme
            theme={active}
            onPatch={updateActiveTheme}
            onRename={(name) => renameTheme(active.id, name)}
            onDelete={() => deleteTheme(active.id)}
            onExport={() => exportThemeToFile(active.id)}
          />
        )}
      </section>
      </div>
    </>
  );
}

function EditableTheme(props: {
  theme: Theme;
  onPatch: (p: any) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onExport: () => void;
}) {
  const { theme, onPatch, onRename, onDelete, onExport } = props;
  const setError = useStore(s => s.setError);
  const fontId = fontChoiceIdFromStack(theme.tokens.fontSans);
  const cardRadius = parseInt(theme.tokens.rCard, 10) || 0;

  const pickImage = async (title: string): Promise<string | null> => {
    try { return await window.hjen.pickImage({ title }); }
    catch { setError('Could not open the image picker.'); return null; }
  };

  const setBase = (base: 'dark' | 'light') => {
    onPatch({ base, tokens: base === 'light' ? LIGHT_RAMP : DARK_RAMP });
  };

  return (
    <div className="appearance__editor-scroll">
      {/* Header: name + actions */}
      <div className="appearance__editor-head">
        <input
          className="appearance__name-input"
          value={theme.name}
          onChange={e => onRename(e.target.value)}
          spellCheck={false}
        />
        <div className="appearance__head-actions">
          <button className="appearance__mini-btn" onClick={onExport}>Export</button>
          <button className="appearance__mini-btn appearance__mini-btn--danger" onClick={onDelete}>Delete</button>
        </div>
      </div>

      <ThemePreviewStrip />

      {/* Base */}
      <Section title="Base">
        <Segmented
          value={theme.base}
          options={[{ v: 'dark', l: 'Dark' }, { v: 'light', l: 'Light' }]}
          onChange={(v) => setBase(v as 'dark' | 'light')}
        />
        <p className="appearance__hint">Switching base resets the surface + text ramp to sensible values. Fine-tune below.</p>
      </Section>

      {/* Colors */}
      <Section title="Colors">
        <div className="appearance__grid">
          <ColorField label="Background" value={theme.tokens.bg} onChange={v => onPatch({ tokens: { bg: v } })} />
          <ColorField label="Surface" value={theme.tokens.bgElev} onChange={v => onPatch({ tokens: { bgElev: v } })} />
          <ColorField label="Surface 2" value={theme.tokens.bgElev2} onChange={v => onPatch({ tokens: { bgElev2: v } })} />
          <ColorField label="Top bar" value={theme.tokens.topbar || theme.tokens.bg} onChange={v => onPatch({ tokens: { topbar: v } })} />
          <ColorField label="Text" value={theme.tokens.ink} onChange={v => onPatch({ tokens: { ink: v } })} />
          <ColorField label="Accent" value={theme.tokens.accent} onChange={v => onPatch({ tokens: { accent: v } })} />
          <ColorField label="Accent hover" value={theme.tokens.accentHover} onChange={v => onPatch({ tokens: { accentHover: v } })} />
          <ColorField label="On accent" value={theme.tokens.onAccent} onChange={v => onPatch({ tokens: { onAccent: v } })} />
        </div>
      </Section>

      {/* Typography */}
      <Section title="Typography">
        <label className="setting-label">Font family</label>
        <div className="appearance__chips">
          {FONT_CHOICES.map(f => (
            <button
              key={f.id}
              className={`appearance__chip ${f.id === fontId ? 'appearance__chip--on' : ''}`}
              onClick={() => onPatch({ tokens: { fontSans: f.sans, fontSerif: f.serif } })}
            >{f.label}</button>
          ))}
        </div>
      </Section>

      {/* Shape */}
      <Section title="Buttons & text boxes">
        <label className="setting-label">Button corners</label>
        <Segmented
          value={theme.controls.buttonShape}
          options={[{ v: 'pill', l: 'Pill' }, { v: 'rounded', l: 'Rounded' }, { v: 'square', l: 'Square' }]}
          onChange={v => onPatch({ controls: { buttonShape: v } })}
        />
        <label className="setting-label" style={{ marginTop: 16 }}>Button fill</label>
        <Segmented
          value={theme.controls.buttonFill}
          options={[{ v: 'solid', l: 'Solid' }, { v: 'outline', l: 'Outline' }, { v: 'ghost', l: 'Ghost' }]}
          onChange={v => onPatch({ controls: { buttonFill: v } })}
        />
        <label className="setting-label" style={{ marginTop: 16 }}>Text box style</label>
        <Segmented
          value={theme.controls.inputStyle}
          options={[{ v: 'soft', l: 'Soft' }, { v: 'underline', l: 'Underline' }, { v: 'outline', l: 'Outline' }, { v: 'filled', l: 'Filled' }]}
          onChange={v => onPatch({ controls: { inputStyle: v } })}
        />
        <label className="setting-label" style={{ marginTop: 16 }}>Card / panel radius — {cardRadius}px</label>
        <input
          type="range" min={0} max={24} value={cardRadius}
          className="appearance__range"
          onChange={e => onPatch({ tokens: { rCard: `${e.target.value}px` } })}
        />
      </Section>

      {/* Brand */}
      <Section title="Logo & background">
        <label className="setting-label">Logo display</label>
        <div className="appearance__chips">
          {LOGO_MODES.map(m => (
            <button
              key={m.id}
              className={`appearance__chip ${theme.brand.logoMode === m.id ? 'appearance__chip--on' : ''}`}
              onClick={() => onPatch({ brand: { logoMode: m.id } })}
            >{m.label}</button>
          ))}
        </div>
        {theme.brand.logoMode === 'custom' && (
          <div className="appearance__upload">
            {theme.brand.logoCustomPath
              ? <img className="appearance__upload-thumb" src={hjenFileUrl(theme.brand.logoCustomPath)} alt="" />
              : <span className="appearance__upload-empty mono-label">No logo</span>}
            <button className="appearance__mini-btn" onClick={async () => {
              const p = await pickImage('Choose a logo image');
              if (p) onPatch({ brand: { logoCustomPath: p } });
            }}>Upload logo</button>
            {theme.brand.logoCustomPath && (
              <button className="appearance__mini-btn" onClick={() => onPatch({ brand: { logoCustomPath: undefined } })}>Reset</button>
            )}
          </div>
        )}

        <label className="setting-label" style={{ marginTop: 16 }}>Loading / boot background</label>
        <div className="appearance__upload">
          {theme.brand.bootBgPath
            ? <img className="appearance__upload-thumb" src={hjenFileUrl(theme.brand.bootBgPath)} alt="" />
            : <span className="appearance__upload-empty mono-label">None</span>}
          <button className="appearance__mini-btn" onClick={async () => {
            const p = await pickImage('Choose a boot background image');
            if (p) onPatch({ brand: { bootBgPath: p } });
          }}>Upload</button>
          {theme.brand.bootBgPath && (
            <button className="appearance__mini-btn" onClick={() => onPatch({ brand: { bootBgPath: undefined } })}>Reset</button>
          )}
        </div>
      </Section>

      {/* Product images */}
      <Section title="Product hub images">
        <div className="appearance__products">
          {PRODUCTS.map(p => {
            const override = theme.images.products[p.id];
            return (
              <div key={p.id} className="appearance__product-row">
                <span className="appearance__product-name">{p.label}</span>
                {override
                  ? <img className="appearance__product-thumb" src={hjenFileUrl(override)} alt="" />
                  : <span className="appearance__product-thumb appearance__product-thumb--empty mono-label">default</span>}
                <button className="appearance__mini-btn" onClick={async () => {
                  const img = await pickImage(`Choose an image for ${p.label}`);
                  if (img) onPatch({ images: { products: { [p.id]: img } } });
                }}>Change</button>
                {override && (
                  // Empty string signals "use the bundled default" to the consumer.
                  <button className="appearance__mini-btn" onClick={() => onPatch({ images: { products: { [p.id]: '' } } })}>Reset</button>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {/* Download / export action */}
      <Section title="Download action">
        <label className="appearance__toggle">
          <input
            type="checkbox"
            checked={theme.actions.showExport}
            onChange={e => onPatch({ actions: { showExport: e.target.checked } })}
          />
          <span>Show the export action in the image preview</span>
        </label>
        <label className="setting-label" style={{ marginTop: 16 }}>Action label</label>
        <input
          className="setting-input"
          value={theme.actions.exportLabel}
          onChange={e => onPatch({ actions: { exportLabel: e.target.value } })}
          placeholder="Reveal"
        />
      </Section>
    </div>
  );
}

/* ---------- small building blocks ---------- */

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <div className="appearance__section">
      <div className="appearance__section-title mono-label">{props.title}</div>
      {props.children}
    </div>
  );
}

function ColorField(props: { label: string; value: string; onChange: (v: string) => void }) {
  // <input type=color> needs a #rrggbb value; fall back to #000 for rgba()/named.
  const hex = /^#[0-9a-fA-F]{6}$/.test(props.value) ? props.value : '#000000';
  return (
    <label className="color-field">
      <span className="color-field__label">{props.label}</span>
      <span className="color-field__row">
        <input
          type="color"
          className="color-field__swatch"
          value={hex}
          onChange={e => props.onChange(e.target.value)}
        />
        <input
          type="text"
          className="color-field__hex"
          value={props.value}
          spellCheck={false}
          onChange={e => props.onChange(e.target.value)}
        />
      </span>
    </label>
  );
}

function Segmented(props: { value: string; options: Array<{ v: string; l: string }>; onChange: (v: string) => void }) {
  return (
    <div className="segmented">
      {props.options.map(o => (
        <button
          key={o.v}
          className={`segmented__opt ${props.value === o.v ? 'segmented__opt--on' : ''}`}
          onClick={() => props.onChange(o.v)}
        >{o.l}</button>
      ))}
    </div>
  );
}

/** Live sample of the current theme's chrome. Reflects edits instantly
 *  because applyTheme() writes to :root, which these classes inherit. */
function ThemePreviewStrip() {
  return (
    <div className="appearance__preview">
      <button className="btn-primary">Primary</button>
      <button className="btn-secondary">Secondary</button>
      <input className="setting-input" defaultValue="Sample text box" />
      <div className="appearance__preview-card">Card</div>
    </div>
  );
}
