import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useStore, type DnaPreset } from '../store';
import type { Quality, Resolution, ModelId } from '../types/catalog';
import type { Skill } from '../types/hjen-bridge';
import { MODELS, resolveSize } from '../lib/models';
import { estimateCost, formatUSD } from '../lib/pricing';
import { MentionTextarea } from './MentionTextarea';
import { readCreativeProjection, traceProjectionUse, type ProjectionRead } from '../lib/creativegraph/consumer';
import type { FrameProjection } from '../lib/creativegraph/technicalCompiler';

const QUALITIES: Quality[] = ['LOW', 'MED', 'HIGH'];
const RESOLUTIONS: Resolution[] = ['1MP', '3.7MP', '8.3MP'];

export function BottomDock() {
  const projectId = useStore(s => s.activeProjectId);
  const selections = useStore(s => s.selections);
  const activeJobs = useStore(s => s.jobs.length);
  const setSelection = useStore(s => s.setSelection);
  const dnaPresets = useStore(s => s.dnaPresets);
  const activeDnaPresetId = useStore(s => s.activeDnaPresetId);
  const applyDnaPreset = useStore(s => s.applyDnaPreset);
  const createDnaPreset = useStore(s => s.createDnaPreset);
  const editDnaPreset = useStore(s => s.editDnaPreset);
  const updateDnaPreset = useStore(s => s.updateDnaPreset);
  const deleteDnaPreset = useStore(s => s.deleteDnaPreset);
  const generate = useStore(s => s.generate);
  const enhancing = useStore(s => s.enhancing);
  const enhancePrompt = useStore(s => s.enhancePrompt);
  const undoEnhancement = useStore(s => s.undoEnhancement);
  const redoEnhancement = useStore(s => s.redoEnhancement);
  const lastEnhancement = useStore(s => s.lastEnhancement);
  const layers = useStore(s => s.layers);
  const layerCount = layers.length;
  const resetScene = useStore(s => s.resetScene);
  const dopOpen = useStore(s => s.dopOpen);
  const toggleDop = useStore(s => s.toggleDop);
  const skills = useStore(s => s.skills);
  const loadSkills = useStore(s => s.loadSkills);
  const activeSkillId = useStore(s => s.activeSkillId);
  const setActiveSkill = useStore(s => s.setActiveSkill);
  const setActiveView = useStore(s => s.setActiveView);
  const activeSkill = activeSkillId ? skills.find(s => s.id === activeSkillId) ?? null : null;
  const layerEnabled = useStore(s => s.layerEnabled);
  const setLayerEnabled = useStore(s => s.setLayerEnabled);
  const lastLayerRun = useStore(s => s.lastLayerRun);
  const [creativeRead, setCreativeRead] = useState<ProjectionRead<FrameProjection> | null>(null);

  useEffect(() => {
    let live = true;
    if (!projectId) { setCreativeRead(null); return; }
    void readCreativeProjection<FrameProjection>(projectId, 'frame')
      .then(read => { if (live) setCreativeRead(read); })
      .catch(() => { if (live) setCreativeRead(null); });
    return () => { live = false; };
  }, [projectId]);

  // Count cinematography chips that have a value — shown in the DOP
  // launcher badge so the user knows how locked-in the tech setup is
  // without opening the sidebar.
  const dopActiveCount = [
    selections.angle,
    selections.style_preset === 'MOVIE' ? selections.movie : selections.style_preset === 'PHOTOGRAPHER' ? selections.photographer : null,
    selections.camera,
    selections.lens,
    selections.stock,
    selections.lighting,
    selections.movement,
    selections.focal_mm,
    selections.aperture_f,
  ].filter(Boolean).length;

  const handleNewScene = () => {
    const dirty =
      selections.prompt.trim() ||
      selections.atmosphere.trim() ||
      selections.negative.trim() ||
      layerCount > 0 ||
      dopActiveCount > 0;
    if (!dirty) return;
    if (!confirm('Start a fresh scene?\n\nThis clears the prompt, atmosphere, negative, all references, and resets the DOP panel (camera / lens / film / lighting / movement / framing) back to default.')) return;
    resetScene();
  };

  const openSkillsLibrary = (create = false) => {
    sessionStorage.setItem('hjen:library-mode', 'skills');
    if (create) sessionStorage.setItem('hjen:skill-editor', 'new');
    setActiveView('library');
    window.dispatchEvent(new CustomEvent('hjen:open-skills-library', { detail: { create } }));
  };

  const applyCreativeContract = () => {
    const projection = creativeRead?.node?.payload;
    if (!projection) return;
    const block = [
      projection.firstFrame,
      projection.ideaProof && `IDEA PROOF: ${projection.ideaProof}`,
      projection.visualLaws.length && `VISUAL LAWS: ${projection.visualLaws.join(' · ')}`,
    ].filter(Boolean).join('\n');
    const current = selections.prompt.trim();
    const prompt = current.includes('IDEA PROOF:') ? current : [current, block].filter(Boolean).join('\n\n');
    const negative = Array.from(new Set([
      ...selections.negative.split(',').map(item => item.trim()).filter(Boolean),
      ...projection.refusals,
    ])).join(', ');
    setSelection('prompt', prompt);
    setSelection('negative', negative);
    void traceProjectionUse(creativeRead, 'Frame', 'apply frame handoff', [projection.ideaProof]).catch(() => undefined);
  };

  const mentionItems = useMemo(
    () => layers.map(l => ({
      id: l.id,
      name: l.customName?.trim() || l.name,
      thumbPath: l.thumbPath,
    })),
    [layers],
  );

  const isApplied = !!lastEnhancement && selections.prompt === lastEnhancement.enhancedPrompt;
  const isUndone  = !!lastEnhancement && selections.prompt === lastEnhancement.originalPrompt;

  const sizePreview = resolveSize(selections.model, selections.aspect, selections.resolution);
  const cost = estimateCost({
    model: selections.model,
    quality: selections.quality,
    apiSize: sizePreview.apiSize,
  });

  return (
    <footer className="dock">
      {/* DOP launcher — toggles the left-side Cinematography sidebar. */}
      <div className="dop-wrap">
        <button
          className={`btn-dop ${dopOpen ? 'btn-dop--open' : ''}`}
          onClick={toggleDop}
          title="Open Cinematography panel (perspective, camera, lens, film, lighting, framing)"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1.5" y="4" width="9" height="8" rx="1" />
            <path d="M10.5 6.5l4-2v7l-4-2z" />
            <circle cx="5" cy="8" r="1.6" />
          </svg>
          <span className="btn-dop__label">DOP</span>
          {dopActiveCount > 0 && <span className="btn-dop__count">{dopActiveCount}</span>}
        </button>
      </div>

      <div className="dock__row dock__row--wrap">
        <SegmentedGroup
          label="Model"
          options={(Object.keys(MODELS) as ModelId[]).map(id => ({ value: id, label: MODELS[id].label }))}
          active={selections.model}
          onSelect={v => setSelection('model', v)}
        />
        <SegmentedGroup
          label="Quality"
          options={QUALITIES.map(q => ({ value: q, label: q }))}
          active={selections.quality}
          onSelect={v => setSelection('quality', v)}
        />
        <SegmentedGroup
          label="Resolution"
          options={RESOLUTIONS.map(r => ({ value: r, label: r }))}
          active={selections.resolution}
          onSelect={v => setSelection('resolution', v)}
        />
        <div className="atmosphere-field">
          <div className="seg__label mono-label">Atmosphere</div>
          <input
            className="atmosphere-input"
            placeholder="Optional — e.g. 'Riyadh dust haze, late afternoon'"
            value={selections.atmosphere}
            onChange={e => setSelection('atmosphere', e.target.value)}
          />
        </div>
        {/* Negative — kept as its own field so the exclusion list never bleeds
            into the scene prompt. Assembled as an isolated tail clause by
            buildPrompt (see promptBuilder.ts step 11). */}
        <div className="atmosphere-field">
          <div className="seg__label mono-label">Negative</div>
          <input
            className="atmosphere-input"
            placeholder="Exclude — e.g. 'falcon, desert sunset, white thobe cliché'"
            value={selections.negative}
            onChange={e => setSelection('negative', e.target.value)}
            dir="auto"
          />
        </div>
      </div>

      <MentionTextarea
        className="dock__prompt"
        placeholder="Scene description — frame first, specific, no clichés"
        value={selections.prompt}
        onChange={v => setSelection('prompt', v)}
        rows={2}
        dir="auto"
        items={mentionItems}
      />

      {lastEnhancement && (isApplied || isUndone) && (
        <div className={`enhance-banner ${isUndone ? 'enhance-banner--undone' : ''}`}>
          <span className="mono-label">
            {isApplied ? 'Enhanced by Claude' : 'Original restored'}
          </span>
          <span className="enhance-banner__meta">
            ${lastEnhancement.usd.toFixed(4)} · {lastEnhancement.inputTokens + lastEnhancement.outputTokens} tok
          </span>
          {isApplied ? (
            <button className="enhance-banner__undo" onClick={undoEnhancement} title="Restore the prompt you wrote">
              Undo enhancement
            </button>
          ) : (
            <button className="enhance-banner__undo" onClick={redoEnhancement} title="Re-apply Claude's enhancement (no new API call)">
              Redo enhancement
            </button>
          )}
        </div>
      )}

      <div className="dock__actions dock__actions--simple">
        <button
          className="btn-secondary btn-secondary--danger"
          onClick={handleNewScene}
          title="Clear prompt + atmosphere + negative + all references. Keeps camera / lens / film / lighting."
          disabled={!selections.prompt.trim() && !selections.atmosphere.trim() && !selections.negative.trim() && layerCount === 0}
        >New scene</button>
        {creativeRead?.node && (
          <button
            className="btn-secondary btn-creative-graph"
            onClick={applyCreativeContract}
            title="Append the versioned first-frame contract and its refusals without replacing your scene"
          >Direction · v{creativeRead.node.version}</button>
        )}
        <DnaDropdown
          presets={dnaPresets}
          activePresetId={activeDnaPresetId}
          onApplyPreset={applyDnaPreset}
          onCreatePreset={createDnaPreset}
          onEditPreset={editDnaPreset}
          onUpdatePreset={updateDnaPreset}
          onDeletePreset={deleteDnaPreset}
          skills={skills}
          activeSkillId={activeSkillId}
          onSelectSkill={setActiveSkill}
          onRefreshSkills={loadSkills}
          onOpenSkillsFolder={() => window.hjen.openSkillsFolder()}
          onCreateSkill={() => openSkillsLibrary(true)}
          onManageSkills={() => openSkillsLibrary(false)}
        />
        <LayerDropdown
          enabled={layerEnabled}
          onToggle={setLayerEnabled}
          lastRun={lastLayerRun}
          supersededBySkill={!!activeSkill}
        />
        {/* Enhance is hidden when the textarea already contains an enhanced
            result (preserves the "Enhance only on original text" rule the
            user defined) or when a skill is active (the skill will produce
            a Master Prompt at Generate time, making Enhance redundant). */}
        {!isApplied && !activeSkill && (
          <button
            className={`btn-enhance ${enhancing ? 'btn-enhance--busy' : ''}`}
            onClick={enhancePrompt}
            disabled={enhancing || !selections.prompt.trim()}
            title={layerCount > 0
              ? `Claude reads your prompt + ${layerCount} reference image${layerCount === 1 ? '' : 's'} and rewrites the scene description.`
              : 'Claude rewrites the scene description from your prompt.'}
          >
            {enhancing ? 'Enhancing…' : 'Enhance ✨'}
          </button>
        )}
        <div className="dock__actions-spacer">
          <div className="dock__stat">
            <span className="mono-label">Output</span>
            <code className="dock__output-size">{sizePreview.targetWidth}×{sizePreview.targetHeight} · {sizePreview.finalMP.toFixed(2)} MP</code>
          </div>
          <div className="dock__stat dock__stat--cost" title={cost.breakdown}>
            <span className="mono-label">Cost</span>
            <code className="dock__output-cost">~{formatUSD(cost.usd)}</code>
          </div>
        </div>
        <button
          className={`btn-primary ${activeJobs > 0 ? 'btn-primary--generating' : ''}`}
          onClick={generate}
          disabled={!selections.prompt.trim()}
        >
          {activeJobs > 0
            ? `Making · ${activeJobs} · ~${formatUSD(cost.usd)}`
            : `Make · ~${formatUSD(cost.usd)}`}
        </button>
      </div>
    </footer>
  );
}

/**
 * HJEN DNA / Skills dropdown.
 *
 * Two compact searchable selectors in one menu:
 *   • Presets — persisted Frame looks with identical edit/update/delete
 *     behavior, including the initially seeded Clay & Basil look.
 *   • Skills  — user-imported Anthropic-style markdown skills. The searchable
 *     list is intentionally virtualisation-ready in shape and stays usable as
 *     the local library grows beyond one hundred entries.
 *
 * Active skill is shown as a chip on the trigger so the user always knows
 * a master-prompt transformation will happen at Generate time.
 */
function DnaChevronIcon() {
  return (
    <svg className="dna-dropdown__icon dna-dropdown__icon--chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

function DnaSearchIcon() {
  return (
    <svg className="dna-dropdown__icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="7" cy="7" r="4" /><path d="m10 10 3 3" />
    </svg>
  );
}

function DnaCheckIcon() {
  return (
    <svg className="dna-dropdown__icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3 8 3 3 7-7" />
    </svg>
  );
}

function DnaInfoIcon() {
  return (
    <svg className="dna-dropdown__icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="6" /><path d="M8 7v4M8 4.5h.01" />
    </svg>
  );
}

type PresetEditor = {
  mode: 'create' | 'edit';
  id?: string;
  name: string;
  description: string;
  captureCurrent: boolean;
};

type PresetOption = {
  id: string | null;
  name: string;
  description: string;
  preset?: DnaPreset;
};

function presetSettingsSummary(preset: DnaPreset): string {
  const settings = preset.settings;
  const camera = settings.camera || 'No camera';
  const stock = settings.stock || settings.movie || settings.photographer || 'No film look';
  return `${camera} · ${stock} · ${settings.aspect}`;
}

function DnaDropdown({
  presets, activePresetId, onApplyPreset, onCreatePreset, onEditPreset, onUpdatePreset, onDeletePreset,
  skills, activeSkillId, onSelectSkill, onRefreshSkills, onOpenSkillsFolder, onCreateSkill, onManageSkills,
}: {
  presets: DnaPreset[];
  activePresetId: string | null;
  onApplyPreset: (id: string | null) => void;
  onCreatePreset: (name: string, description: string) => string;
  onEditPreset: (id: string, patch: { name: string; description: string; captureCurrent?: boolean }) => void;
  onUpdatePreset: (id: string) => void;
  onDeletePreset: (id: string) => void;
  skills: Skill[];
  activeSkillId: string | null;
  onSelectSkill: (id: string | null) => void;
  onRefreshSkills: () => Promise<void>;
  onOpenSkillsFolder: () => Promise<{ ok: boolean; path: string; error?: string }>;
  onCreateSkill: () => void;
  onManageSkills: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [openSelector, setOpenSelector] = useState<'presets' | 'skills' | null>(null);
  const [search, setSearch] = useState('');
  const [activeOptionIndex, setActiveOptionIndex] = useState(0);
  const [previewSkillId, setPreviewSkillId] = useState<string | null>(null);
  const [presetEditor, setPresetEditor] = useState<PresetEditor | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const presetListId = `${useId()}-presets`;
  const skillsListId = `${useId()}-skills`;
  const activeSkill = activeSkillId ? skills.find(s => s.id === activeSkillId) ?? null : null;
  const previewSkill = previewSkillId ? skills.find(s => s.id === previewSkillId) ?? null : null;
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const presetOptions = useMemo<PresetOption[]>(() => [
    { id: null, name: 'None preset', description: 'Clear the applied look and return Frame controls to defaults' },
    ...presets.map(preset => ({
      id: preset.id,
      name: preset.name,
      description: preset.description || presetSettingsSummary(preset),
      preset,
    })),
  ], [presets]);
  const filteredPresets = useMemo(() => {
    if (!normalizedSearch) return presetOptions;
    return presetOptions.filter(option => (
      `${option.name} ${option.description} ${option.id ?? 'none'}`.toLocaleLowerCase().includes(normalizedSearch)
    ));
  }, [normalizedSearch, presetOptions]);
  const activePreset = presetOptions.find(option => option.id === activePresetId) ?? presetOptions[0];
  const filteredSkills = useMemo(() => {
    if (!normalizedSearch) return skills;
    return skills.filter(skill => (
      `${skill.name} ${skill.description} ${skill.id}`.toLocaleLowerCase().includes(normalizedSearch)
    ));
  }, [normalizedSearch, skills]);

  const closeMenu = () => {
    setOpen(false);
    setOpenSelector(null);
    setSearch('');
    setPreviewSkillId(null);
    setPresetEditor(null);
  };

  const toggleSelector = (selector: 'presets' | 'skills') => {
    setOpenSelector(current => current === selector ? null : selector);
    setSearch('');
    setActiveOptionIndex(0);
    setPreviewSkillId(null);
  };

  const chooseSkill = (skillId: string | null) => {
    onSelectSkill(skillId);
    closeMenu();
  };

  const choosePreset = (id: string | null) => {
    onApplyPreset(id);
    closeMenu();
  };

  const openCreatePreset = () => {
    setPresetEditor({
      mode: 'create',
      name: '',
      description: '',
      captureCurrent: true,
    });
  };

  const openEditPreset = (preset: DnaPreset) => {
    setPresetEditor({ mode: 'edit', id: preset.id, name: preset.name, description: preset.description, captureCurrent: false });
  };

  const savePresetEditor = () => {
    if (!presetEditor?.name.trim()) return;
    if (presetEditor.mode === 'create') onCreatePreset(presetEditor.name, presetEditor.description);
    else if (presetEditor.id) onEditPreset(presetEditor.id, {
      name: presetEditor.name,
      description: presetEditor.description,
      captureCurrent: presetEditor.captureCurrent,
    });
    setPresetEditor(null);
  };

  const deletePreset = (preset: DnaPreset) => {
    if (!confirm(`Delete “${preset.name}”?\n\nThis removes the saved preset. Your current Frame controls stay unchanged.`)) return;
    onDeletePreset(preset.id);
  };

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (presetEditor) setPresetEditor(null);
        else if (previewSkillId) setPreviewSkillId(null);
        else if (openSelector) {
          setOpenSelector(null);
          setSearch('');
        } else closeMenu();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, openSelector, presetEditor, previewSkillId]);

  // Move directly into search when either compact selector opens.
  useEffect(() => {
    if (!openSelector) return;
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [openSelector]);

  useEffect(() => {
    const optionCount = openSelector === 'skills' ? filteredSkills.length + 1 : filteredPresets.length;
    setActiveOptionIndex(index => Math.min(index, Math.max(optionCount - 1, 0)));
  }, [filteredPresets.length, filteredSkills.length, openSelector]);

  useEffect(() => {
    if (!openSelector) return;
    const listId = openSelector === 'skills' ? skillsListId : presetListId;
    document.getElementById(`${listId}-${activeOptionIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeOptionIndex, openSelector, presetListId, skillsListId]);

  // The folder is the source of truth. Refresh when the dropdown opens and
  // again when Finder hands focus back after the user adds/removes a skill.
  useEffect(() => {
    if (!open) return;
    void onRefreshSkills();
    const refreshOnFocus = () => { void onRefreshSkills(); };
    window.addEventListener('focus', refreshOnFocus);
    return () => window.removeEventListener('focus', refreshOnFocus);
  }, [open, onRefreshSkills]);

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const optionCount = openSelector === 'skills' ? filteredSkills.length + 1 : filteredPresets.length;
    if (optionCount <= 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveOptionIndex(index => (index + 1) % optionCount);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveOptionIndex(index => (index - 1 + optionCount) % optionCount);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (openSelector === 'presets') {
        const preset = filteredPresets[activeOptionIndex];
        if (preset) choosePreset(preset.id);
      }
      if (openSelector === 'skills') {
        if (activeOptionIndex === 0) chooseSkill(null);
        else {
          const skill = filteredSkills[activeOptionIndex - 1];
          if (skill) chooseSkill(skill.id);
        }
      }
    }
  };

  return (
    <div className="dna-dropdown" ref={wrapRef}>
      <button
        className={`btn-secondary dna-dropdown__trigger ${activeSkill ? 'dna-dropdown__trigger--has-skill' : ''}`}
        onClick={() => open ? closeMenu() : setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={activeSkill
          ? `Skill active: ${activeSkill.name}. Click to change.`
          : 'HJEN DNA presets + Skills'}
      >
        <span>HJEN DNA</span>
        {activeSkill && (
          <span className="dna-dropdown__chip" dir="auto" title={activeSkill.description || activeSkill.name}>
            {activeSkill.name}
          </span>
        )}
        <span className={`dna-dropdown__chevron ${open ? 'dna-dropdown__chevron--open' : ''}`}><DnaChevronIcon /></span>
      </button>

      {open && (
        <div className="dna-dropdown__menu" role="dialog" aria-label="HJEN DNA presets and skills">
          <div className="dna-dropdown__section">
            <div className="dna-dropdown__section-head-row">
              <div className="mono-label dna-dropdown__section-head">Presets</div>
              <div className="dna-dropdown__section-tools">
                <span className="dna-dropdown__section-count">{presets.length} look{presets.length === 1 ? '' : 's'}</span>
                <button className="dna-dropdown__add" onClick={() => openCreatePreset()} title="Save the current Frame controls as a preset">
                  <span aria-hidden="true">+</span> Save current
                </button>
              </div>
            </div>
            <button
              className={`dna-dropdown__select ${openSelector === 'presets' ? 'dna-dropdown__select--open' : ''}`}
              onClick={() => toggleSelector('presets')}
              aria-haspopup="dialog"
              aria-expanded={openSelector === 'presets'}
              aria-controls={presetListId}
            >
              <span className="dna-dropdown__select-copy">
                <span className="dna-dropdown__select-value" dir="auto">{activePreset.name}</span>
                <span className="dna-dropdown__select-detail" dir="auto">{activePreset.description}</span>
              </span>
              <span className="dna-dropdown__select-end">
                <span className="dna-dropdown__selected-label">{activePresetId ? 'Active' : 'Off'}</span>
                <span className={`dna-dropdown__chevron ${openSelector === 'presets' ? 'dna-dropdown__chevron--open' : ''}`}><DnaChevronIcon /></span>
              </span>
            </button>

            {openSelector === 'presets' && (
              <div className="dna-dropdown__selector-panel">
                <label className="dna-dropdown__search">
                  <DnaSearchIcon />
                  <input
                    ref={searchRef}
                    value={search}
                    onChange={event => { setSearch(event.target.value); setActiveOptionIndex(0); }}
                    onKeyDown={onSearchKeyDown}
                    placeholder="Search presets"
                    aria-label="Search presets"
                    aria-controls={presetListId}
                  />
                  {search && <button type="button" className="dna-dropdown__search-clear" onClick={() => setSearch('')} aria-label="Clear preset search">×</button>}
                </label>
                <div id={presetListId} className="dna-dropdown__options dna-dropdown__options--presets" role="list" aria-label="Presets">
                  {filteredPresets.map((option, index) => {
                    const selected = option.id === activePresetId;
                    return (
                      <div
                        key={option.id ?? 'none'}
                        className={`dna-dropdown__option-row ${selected ? 'dna-dropdown__option-row--selected' : ''} ${activeOptionIndex === index ? 'dna-dropdown__option-row--active' : ''}`}
                        onMouseEnter={() => setActiveOptionIndex(index)}
                        role="listitem"
                      >
                        <button
                          id={`${presetListId}-${index}`}
                          className="dna-dropdown__option dna-dropdown__option--preset"
                          onClick={() => choosePreset(option.id)}
                          aria-current={selected ? 'true' : undefined}
                          title={option.id ? `Apply ${option.name}` : 'Clear the applied preset'}
                        >
                          <span className="dna-dropdown__option-mark">{selected && <DnaCheckIcon />}</span>
                          <span className="dna-dropdown__option-copy">
                            <span className="dna-dropdown__option-title" dir="auto">{option.name}</span>
                            <span className="dna-dropdown__option-description" dir="auto">{option.description}</span>
                          </span>
                        </button>
                        {option.preset && (
                          <div className="dna-dropdown__preset-actions" aria-label={`${option.name} preset actions`}>
                            <button onClick={() => openEditPreset(option.preset!)} title={`Edit ${option.name}`}>Edit</button>
                            <button
                              onClick={() => {
                                if (confirm(`Update “${option.name}” with the current Frame controls?`)) onUpdatePreset(option.preset!.id);
                              }}
                              title={`Replace ${option.name}'s saved settings with the current Frame controls`}
                            >Update</button>
                            <button className="dna-dropdown__preset-delete" onClick={() => deletePreset(option.preset!)} title={`Delete ${option.name}`}>Delete</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {filteredPresets.length === 0 && (
                    <div className="dna-dropdown__empty">No presets match “{search.trim()}”.</div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="dna-dropdown__divider" />

          <div className="dna-dropdown__section">
            <div className="dna-dropdown__section-head-row">
              <div className="mono-label dna-dropdown__section-head">Skills</div>
              <button
                className="dna-dropdown__add"
                onClick={() => { closeMenu(); onCreateSkill(); }}
                title="Create a skill inside HJEN"
              ><span aria-hidden="true">+</span> Add skill</button>
            </div>

            <div className={`dna-dropdown__select-group ${openSelector === 'skills' ? 'dna-dropdown__select-group--open' : ''}`}>
              <button
                className={`dna-dropdown__select dna-dropdown__select--skill ${openSelector === 'skills' ? 'dna-dropdown__select--open' : ''}`}
                onClick={() => toggleSelector('skills')}
                aria-haspopup="listbox"
                aria-expanded={openSelector === 'skills'}
                aria-controls={skillsListId}
              >
                <span className="dna-dropdown__select-copy">
                  <span className="dna-dropdown__select-value" dir="auto">{activeSkill?.name || 'None'}</span>
                  <span className="dna-dropdown__select-detail" dir="auto">
                    {activeSkill?.description || (skills.length ? `${skills.length} installed · Choose the craft layer for this frame` : 'No skill will shape the prompt')}
                  </span>
                </span>
                <span className={`dna-dropdown__chevron ${openSelector === 'skills' ? 'dna-dropdown__chevron--open' : ''}`}><DnaChevronIcon /></span>
              </button>
              {activeSkill && (
                <button
                  className="dna-dropdown__select-info"
                  onClick={() => setPreviewSkillId(id => id === activeSkill.id ? null : activeSkill.id)}
                  aria-label={`Preview ${activeSkill.name}`}
                  title="Preview selected skill"
                ><DnaInfoIcon /></button>
              )}
            </div>

            {openSelector === 'skills' && (
              <div className="dna-dropdown__selector-panel">
                <label className="dna-dropdown__search">
                  <DnaSearchIcon />
                  <input
                    ref={searchRef}
                    value={search}
                    onChange={event => { setSearch(event.target.value); setActiveOptionIndex(0); }}
                    onKeyDown={onSearchKeyDown}
                    placeholder="Search skills"
                    aria-label="Search skills"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-controls={skillsListId}
                    aria-expanded="true"
                    aria-activedescendant={`${skillsListId}-${activeOptionIndex}`}
                  />
                  {search && <button type="button" className="dna-dropdown__search-clear" onClick={() => setSearch('')} aria-label="Clear skill search">×</button>}
                </label>
                <div id={skillsListId} className="dna-dropdown__options dna-dropdown__options--skills" role="listbox" aria-label="Skills">
                  <button
                    id={`${skillsListId}-0`}
                    className={`dna-dropdown__option ${!activeSkillId ? 'dna-dropdown__option--selected' : ''} ${activeOptionIndex === 0 ? 'dna-dropdown__option--active' : ''}`}
                    onClick={() => chooseSkill(null)}
                    onMouseEnter={() => setActiveOptionIndex(0)}
                    role="option"
                    aria-selected={!activeSkillId}
                  >
                    <span className="dna-dropdown__option-mark">{!activeSkillId && <DnaCheckIcon />}</span>
                    <span className="dna-dropdown__option-copy">
                      <span className="dna-dropdown__option-title">None</span>
                      <span className="dna-dropdown__option-description">Use the scene prompt without a skill</span>
                    </span>
                  </button>

                  {filteredSkills.map((skill, index) => {
                    const optionIndex = index + 1;
                    const selected = activeSkillId === skill.id;
                    return (
                      <div
                        key={skill.id}
                        className={`dna-dropdown__option-row ${selected ? 'dna-dropdown__option-row--selected' : ''} ${activeOptionIndex === optionIndex ? 'dna-dropdown__option-row--active' : ''} ${previewSkillId === skill.id ? 'dna-dropdown__option-row--previewing' : ''}`}
                        onMouseEnter={() => setActiveOptionIndex(optionIndex)}
                        role="presentation"
                      >
                        <button
                          id={`${skillsListId}-${optionIndex}`}
                          className="dna-dropdown__option dna-dropdown__option--skill"
                          onClick={() => chooseSkill(skill.id)}
                          role="option"
                          aria-selected={selected}
                          title={`Use ${skill.name}`}
                        >
                          <span className="dna-dropdown__option-mark">{selected && <DnaCheckIcon />}</span>
                          <span className="dna-dropdown__option-copy">
                            <span className="dna-dropdown__option-title" dir="auto">{skill.name}</span>
                            <span className="dna-dropdown__option-description" dir="auto">{skill.description || `${(skill.bytes / 1024).toFixed(1)} KB skill`}</span>
                          </span>
                        </button>
                        <button
                          className="dna-dropdown__skill-info"
                          onClick={() => setPreviewSkillId(id => id === skill.id ? null : skill.id)}
                          title={`Preview ${skill.name}`}
                          aria-label={`Preview ${skill.name}`}
                        ><DnaInfoIcon /></button>
                      </div>
                    );
                  })}

                  {skills.length === 0 && (
                    <div className="dna-dropdown__empty">No skills installed. Add one here or drop it into the folder.</div>
                  )}
                  {skills.length > 0 && filteredSkills.length === 0 && (
                    <div className="dna-dropdown__empty">No skills match “{search.trim()}”.</div>
                  )}
                </div>
              </div>
            )}

            <div className="dna-dropdown__folder-note">
              <span>Local Markdown skills · .md or skill/SKILL.md</span>
              <div className="dna-dropdown__folder-actions">
                <button onClick={() => { void onOpenSkillsFolder(); }}>Folder</button>
                <button onClick={() => { closeMenu(); onManageSkills(); }}>Manage</button>
              </div>
            </div>
          </div>

          {presetEditor && (
            <aside className="dna-dropdown__preset-editor" role="dialog" aria-modal="true" aria-labelledby="dna-preset-editor-title">
              <form onSubmit={event => { event.preventDefault(); savePresetEditor(); }}>
                <header className="dna-dropdown__preview-head">
                  <div className="dna-dropdown__preview-title">
                    <div className="mono-label dna-dropdown__section-head">Preset</div>
                    <h4 id="dna-preset-editor-title">{presetEditor.mode === 'create' ? 'Save current look' : 'Edit preset'}</h4>
                  </div>
                  <button type="button" className="dna-dropdown__preview-close" onClick={() => setPresetEditor(null)} aria-label="Close preset editor">×</button>
                </header>
                <label className="dna-dropdown__editor-field">
                  <span className="mono-label">Name</span>
                  <input
                    autoFocus
                    value={presetEditor.name}
                    onChange={event => setPresetEditor(editor => editor ? { ...editor, name: event.target.value } : editor)}
                    placeholder="e.g. Riyadh Night Exterior"
                    dir="auto"
                    maxLength={80}
                    required
                  />
                </label>
                <label className="dna-dropdown__editor-field">
                  <span className="mono-label">Description</span>
                  <textarea
                    value={presetEditor.description}
                    onChange={event => setPresetEditor(editor => editor ? { ...editor, description: event.target.value } : editor)}
                    placeholder="What this look is for"
                    dir="auto"
                    rows={3}
                    maxLength={180}
                  />
                </label>
                {presetEditor.mode === 'edit' && (
                  <label className="dna-dropdown__editor-capture">
                    <input
                      type="checkbox"
                      checked={presetEditor.captureCurrent}
                      onChange={event => setPresetEditor(editor => editor ? { ...editor, captureCurrent: event.target.checked } : editor)}
                    />
                    <span>
                      <strong>Replace saved settings</strong>
                      <small>Capture the current camera, film, light and output controls when saving.</small>
                    </span>
                  </label>
                )}
                <p className="dna-dropdown__editor-note">
                  Presets save Frame controls only. Scene, atmosphere and negative copy stay with the frame.
                </p>
                <footer className="dna-dropdown__editor-actions">
                  <button type="button" className="btn-secondary" onClick={() => setPresetEditor(null)}>Cancel</button>
                  <button type="submit" className="btn-primary" disabled={!presetEditor.name.trim()}>
                    {presetEditor.mode === 'create' ? 'Save preset' : 'Save changes'}
                  </button>
                </footer>
              </form>
            </aside>
          )}

          {previewSkill && (
            <aside className="dna-dropdown__preview" onClick={e => e.stopPropagation()}>
              <header className="dna-dropdown__preview-head">
                <div className="dna-dropdown__preview-title">
                  <div className="mono-label dna-dropdown__section-head">Skill preview</div>
                  <h4>{previewSkill.name}</h4>
                </div>
                <button
                  className="dna-dropdown__preview-close"
                  onClick={() => setPreviewSkillId(null)}
                  aria-label="Close preview"
                >×</button>
              </header>
              <div className="dna-dropdown__preview-meta mono-label">
                {previewSkill.version ? `v${previewSkill.version} · ` : ''}
                {(previewSkill.bytes / 1024).toFixed(1)} KB
              </div>
              {previewSkill.description && (
                <p className="dna-dropdown__preview-desc">{previewSkill.description}</p>
              )}
              <div className="dna-dropdown__preview-body">
                <pre>{previewSkill.body}</pre>
              </div>
              <footer className="dna-dropdown__preview-foot">
                <button
                  className="btn-primary dna-dropdown__preview-use"
                  onClick={() => chooseSkill(previewSkill.id)}
                >Use skill</button>
              </footer>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Saudi DNA Layer — the transparent-inspectable control.
 *
 * The layer runs automatically on every Make (unless a Skill is active,
 * which supersedes it). This button shows its state and opens the
 * «ماذا فعلت الطبقة» panel: original → compiled prompt, the knowledge cards
 * used, the Arabic-text plan, and the on/off switch. Reuses the
 * dna-dropdown popover styling so it reads as part of the same family.
 */
function LayerDropdown({ enabled, onToggle, lastRun, supersededBySkill }: {
  enabled: boolean;
  onToggle: (on: boolean) => void;
  lastRun: import('../lib/compiler').LayerRun | null;
  supersededBySkill: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const statusDot = supersededBySkill ? '◌' : enabled ? '●' : '○';
  return (
    <div className="dna-dropdown" ref={wrapRef}>
      <button
        className={`btn-secondary dna-dropdown__trigger ${enabled && !supersededBySkill ? 'dna-dropdown__trigger--has-skill' : ''}`}
        onClick={() => setOpen(o => !o)}
        title={supersededBySkill
          ? 'Skill نشط — الطبقة متوقفة مؤقتاً (الـ Skill يتقدم عليها)'
          : enabled ? 'الطبقة السعودية تعمل — اضغط للفحص' : 'الطبقة متوقفة — اضغط للتشغيل'}
      >
        <span>{statusDot} الطبقة</span>
      </button>

      {open && (
        <div className="dna-dropdown__menu" dir="rtl" style={{ minWidth: 340, maxWidth: 460 }}>
          <div className="dna-dropdown__section">
            <div className="dna-dropdown__section-head-row">
              <div className="mono-label dna-dropdown__section-head">ماذا فعلت الطبقة</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={e => onToggle(e.target.checked)}
                />
                تعمل تلقائياً
              </label>
            </div>
            {supersededBySkill && (
              <div className="dna-dropdown__empty">Skill نشط الآن — الطبقة تتنحى له في هذا الـ Make.</div>
            )}
            {!lastRun ? (
              <div className="dna-dropdown__empty">لم تشتغل الطبقة بعد — اكتب مشهدك واصنع.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 2px' }}>
                {lastRun.notesAr && (
                  <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>{lastRun.notesAr}</p>
                )}
                {lastRun.usedCards.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {lastRun.usedCards.map(c => (
                      <span key={c.id} className="mono-label" title={c.ar}
                        style={{ border: '1px solid currentColor', borderRadius: 10, padding: '1px 8px', fontSize: 10, opacity: 0.8 }}>
                        {c.dimension}
                      </span>
                    ))}
                  </div>
                )}
                {lastRun.textPlan.mode !== 'none' && (
                  <div style={{ fontSize: 12, opacity: 0.85 }}>
                    {lastRun.textPlan.mode === 'overlay'
                      ? <>خطة النص: كتابة حقيقية فوق الصورة بعد الصنع{lastRun.textPlan.content ? <> — «{lastRun.textPlan.content}»</> : null}</>
                      : <>خطة النص: داخل الموديل حرفياً — «{lastRun.textPlan.content}»</>}
                  </div>
                )}
                {lastRun.suggestModel && (
                  <div style={{ fontSize: 12, opacity: 0.85 }}>
                    ترشيح: بدّل الموديل إلى Nano Banana Pro — الأدق في رسم الحرف العربي.
                  </div>
                )}
                {lastRun.ocr && (
                  <div style={{ fontSize: 12, opacity: 0.85 }}>
                    {lastRun.ocr.match
                      ? <>فحص النص: ✓ الحروف سليمة</>
                      : <>فحص النص: ✗ الموديل خربش{lastRun.ocr.seen ? <> (قرأنا: «{lastRun.ocr.seen}»)</> : null}{lastRun.ocr.retook ? ' — أعدنا الصنع تلقائياً مرة واحدة' : ''}</>}
                  </div>
                )}
                <details>
                  <summary className="mono-label" style={{ cursor: 'pointer', fontSize: 10 }}>البرومبت المُجمّع</summary>
                  <div className="dna-dropdown__preview-body" style={{ maxHeight: 180 }}>
                    <pre dir="ltr" style={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>{lastRun.compiledPrompt}</pre>
                  </div>
                </details>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SegmentedGroup<T extends string>({ label, options, active, onSelect }: {
  label: string;
  options: Array<{ value: T; label: string }>;
  active: T;
  onSelect: (v: T) => void;
}) {
  return (
    <div className="seg">
      <div className="seg__label mono-label">{label}</div>
      <div className="seg__group">
        {options.map(o => (
          <button
            key={o.value}
            className={`seg__btn ${active === o.value ? 'seg__btn--active' : ''}`}
            onClick={() => onSelect(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
