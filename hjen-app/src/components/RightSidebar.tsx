import { memo, useState } from 'react';
import { useStore, MAX_LAYERS, LAYER_CATEGORIES } from '../store';
import type { LibCategory } from '../types/hjen-bridge';
import type { Layer } from '../store';
import { LayerPreviewModal, type PreviewTarget } from './LayerPreviewModal';

/** Shared chevron — rotates 90° when its parent has the
 *  `*--collapsed` modifier removed (i.e. is expanded). */
function TreeCaret() {
  return (
    <svg className="tree-caret" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 1.5l3 3-3 3" />
    </svg>
  );
}

function fileUrl(absPath?: string): string | undefined {
  if (!absPath) return undefined;
  return `hjen-file://${encodeURI(absPath)}`;
}

// Sub-categories allowed under a character subject.
// Wardrobe stays nested (clothes belong to a person). Pose/Expression are
// per-character references that guide the model's framing + face beat.
const CHARACTER_CHILD_CATEGORIES: LibCategory[] = ['wardrobe', 'pose', 'expression'];
const CHARACTER_CHILD_LABELS: Record<LibCategory, string> = {
  wardrobe: 'Wardrobe',
  pose: 'Pose',
  expression: 'Expression',
  character: 'Character',
  composition: 'Composition',
  prop: 'Prop',
  location: 'Set',
  general: 'General',
  audio: 'Audio',
  movement: 'Movement',
};

export function RightSidebar() {
  const layers = useStore(s => s.layers);
  const openLibraryFor = useStore(s => s.openLibraryFor);
  const removeLayer = useStore(s => s.removeLayer);
  const renameLayer = useStore(s => s.renameLayer);
  const clearLayers = useStore(s => s.clearLayers);

  // Each section folder (characters + the flat categories) can be
  // collapsed independently. State key = category id; `null` means
  // characters because it's hardcoded above the flat list.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleSection = (id: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const isCollapsed = (id: string) => collapsed.has(id);

  // Layer-thumbnail preview modal. Click any thumb → open the asset at
  // ~50vw × 50vh with a 50%-dimmed backdrop. Close via X / Esc / backdrop.
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);
  const openPreview = (l: Layer) => setPreviewTarget({
    filePath: l.filePath,
    name: l.customName?.trim() || l.name,
  });

  // Split layers into 3 buckets:
  //   - characters: top-level subjects (category === 'character' && !parentLayerId)
  //   - childrenByParent: layers attached to a character (parentLayerId set)
  //   - flatByCategory: ungrouped layers in non-character categories
  const characters = layers.filter(l => l.category === 'character' && !l.parentLayerId);
  const childrenByParent = new Map<string, Layer[]>();
  for (const l of layers) {
    if (l.parentLayerId) {
      const arr = childrenByParent.get(l.parentLayerId) || [];
      arr.push(l);
      childrenByParent.set(l.parentLayerId, arr);
    }
  }
  const flatCats = LAYER_CATEGORIES.filter(c => c.id !== 'character').map(c => ({
    ...c,
    items: layers.filter(l => l.category === c.id && !l.parentLayerId),
  }));

  return (
    <aside className="right-sidebar">
      <header className="right-sidebar__header">
        <div className="right-sidebar__title">
          <span className="mono-label">Layers</span>
          <span className={`right-sidebar__count ${layers.length >= MAX_LAYERS ? 'right-sidebar__count--full' : ''}`}>
            {layers.length}/{MAX_LAYERS}
          </span>
        </div>
        {layers.length > 0 && (
          <button className="right-sidebar__clear" onClick={clearLayers}>Clear</button>
        )}
      </header>

      <div className="right-sidebar__body">
        {/* === Characters as subjects, each with nested wardrobe/prop slots === */}
        <section className={`layer-group ${isCollapsed('character') ? 'layer-group--collapsed' : ''}`}>
          <header className="layer-group__header">
            <button
              className="layer-group__toggle"
              onClick={() => toggleSection('character')}
            >
              <TreeCaret />
              <span className="mono-label">Characters</span>
              {characters.length > 0 && <span className="layer-group__count">{characters.length}</span>}
            </button>
            <button
              className="layer-group__add"
              onClick={(e) => { e.stopPropagation(); openLibraryFor('character'); }}
              disabled={layers.length >= MAX_LAYERS}
              title={layers.length >= MAX_LAYERS ? `${MAX_LAYERS}-reference cap reached` : 'Add character (creates a new subject)'}
            >+</button>
          </header>
          {!isCollapsed('character') && (
            characters.length === 0 ? (
              <div className="layer-group__empty">— no subjects yet</div>
            ) : (
              <div className="character-list">
                {characters.map(char => (
                  <CharacterCard
                    key={char.id}
                    character={char}
                    children={childrenByParent.get(char.id) || []}
                    layerCap={layers.length >= MAX_LAYERS}
                    onRemoveChar={() => removeLayer(char.id)}
                    onRename={(n) => renameLayer(char.id, n)}
                    onRemoveChild={(id) => removeLayer(id)}
                    onRenameChild={(id, n) => renameLayer(id, n)}
                    onAddChild={(cat) => openLibraryFor(cat, char.id)}
                    onPreview={openPreview}
                  />
                ))}
              </div>
            )
          )}
        </section>

        {/* === Flat categories: wardrobe (unassigned), locations, props, general === */}
        {flatCats.map(group => {
          const collapsedHere = isCollapsed(group.id);
          return (
            <section key={group.id} className={`layer-group ${collapsedHere ? 'layer-group--collapsed' : ''}`}>
              <header className="layer-group__header">
                <button
                  className="layer-group__toggle"
                  onClick={() => toggleSection(group.id)}
                >
                  <TreeCaret />
                  <span className="mono-label">
                    {group.label}
                    {group.id === 'prop' && characters.length > 0 && (
                      <span className="layer-group__hint"> · unassigned</span>
                    )}
                  </span>
                  {group.items.length > 0 && <span className="layer-group__count">{group.items.length}</span>}
                </button>
                <button
                  className="layer-group__add"
                  onClick={(e) => { e.stopPropagation(); openLibraryFor(group.id); }}
                  disabled={layers.length >= MAX_LAYERS}
                  title={layers.length >= MAX_LAYERS ? `${MAX_LAYERS}-reference cap reached` : 'Add reference'}
                >+</button>
              </header>
              {!collapsedHere && (
                group.items.length === 0 ? (
                  <div className="layer-group__empty">— none</div>
                ) : (
                  <div className="layer-group__items">
                    {group.items.map(layer => (
                      <FlatLayerCard
                        key={layer.id}
                        layer={layer}
                        onRemove={() => removeLayer(layer.id)}
                        onRename={(n) => renameLayer(layer.id, n)}
                        onPreview={openPreview}
                      />
                    ))}
                  </div>
                )
              )}
            </section>
          );
        })}

        <div className="right-sidebar__footnote mono-label">
          Each character is a subject. Add wardrobe + accessories INSIDE the
          character card so the model knows which clothes belong to whom.
        </div>
      </div>

      <LayerPreviewModal target={previewTarget} onClose={() => setPreviewTarget(null)} />
    </aside>
  );
}

interface CharacterCardProps {
  character: Layer;
  children: Layer[];
  layerCap: boolean;
  onRemoveChar: () => void;
  onRename: (n: string) => void;
  onRemoveChild: (id: string) => void;
  onRenameChild: (id: string, n: string) => void;
  onAddChild: (cat: LibCategory) => void;
  onPreview: (l: Layer) => void;
}
const CharacterCard = memo(function CharacterCard(props: CharacterCardProps) {
  const { character: c, children, layerCap, onAddChild, onPreview } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.customName || c.name);

  const display = c.customName?.trim() || c.name;

  return (
    <div className="character-card">
      <header className="character-card__head">
        <img
          className="character-card__thumb"
          src={fileUrl(c.thumbPath)}
          alt=""
          loading="lazy"
          onClick={() => onPreview(c)}
          title="Click to preview"
        />
        <div className="character-card__title">
          {editing ? (
            <input
              autoFocus
              className="character-card__name-input"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={() => { props.onRename(draft); setEditing(false); }}
              onKeyDown={e => {
                if (e.key === 'Enter') { props.onRename(draft); setEditing(false); }
                if (e.key === 'Escape') { setDraft(c.customName || c.name); setEditing(false); }
              }}
            />
          ) : (
            <button className="character-card__name" onClick={() => setEditing(true)} title="Click to rename subject">
              {display}
            </button>
          )}
          <div className="character-card__meta mono-label">{children.length} sub-layers</div>
        </div>
        <button className="character-card__remove" onClick={props.onRemoveChar} title="Remove subject and all sub-layers">×</button>
      </header>

      <div className="character-card__subs">
        {CHARACTER_CHILD_CATEGORIES.map(cat => {
          const items = children.filter(ch => ch.category === cat);
          return (
            <section key={cat} className="character-sub">
              <header className="character-sub__header">
                <span className="mono-label">{CHARACTER_CHILD_LABELS[cat] ?? cat}</span>
                <button
                  className="character-sub__add"
                  onClick={() => onAddChild(cat)}
                  disabled={layerCap}
                  title={layerCap ? `${MAX_LAYERS}-reference cap reached` : `Add ${cat} to ${display}`}
                >+</button>
              </header>
              {items.length === 0 ? (
                <div className="character-sub__empty">— none</div>
              ) : (
                <div className="character-sub__items">
                  {items.map(item => (
                    <ChildLayerCard
                      key={item.id}
                      layer={item}
                      onRemove={() => props.onRemoveChild(item.id)}
                      onRename={(n) => props.onRenameChild(item.id, n)}
                      onPreview={onPreview}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
});

interface ChildLayerProps {
  layer: Layer;
  onRemove: () => void;
  onRename: (n: string) => void;
  onPreview: (l: Layer) => void;
}
const ChildLayerCard = memo(function ChildLayerCard({ layer, onRemove, onRename, onPreview }: ChildLayerProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(layer.customName || layer.name);
  const display = layer.customName?.trim() || layer.name;
  return (
    <div className="child-layer" title={display}>
      <img
        className="child-layer__thumb"
        src={fileUrl(layer.thumbPath)}
        alt=""
        loading="lazy"
        onClick={() => onPreview(layer)}
      />
      {editing ? (
        <input
          autoFocus
          className="child-layer__name-input"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => { onRename(draft); setEditing(false); }}
          onKeyDown={e => {
            if (e.key === 'Enter') { onRename(draft); setEditing(false); }
            if (e.key === 'Escape') { setDraft(layer.customName || layer.name); setEditing(false); }
          }}
        />
      ) : (
        <button className="child-layer__name" onClick={() => setEditing(true)} title="Click to rename">
          {display}
        </button>
      )}
      <button className="child-layer__remove" onClick={onRemove}>×</button>
    </div>
  );
});

const FlatLayerCard = memo(function FlatLayerCard({ layer, onRemove, onRename, onPreview }: ChildLayerProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(layer.customName || layer.name);
  const display = layer.customName?.trim() || layer.name;
  return (
    <div className="layer-card" title={display}>
      <img
        className="layer-card__thumb"
        src={fileUrl(layer.thumbPath)}
        alt=""
        loading="lazy"
        decoding="async"
        onClick={() => onPreview(layer)}
      />
      {editing ? (
        <input
          autoFocus
          className="layer-card__rename-input"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => { onRename(draft); setEditing(false); }}
          onKeyDown={e => {
            if (e.key === 'Enter') { onRename(draft); setEditing(false); }
            if (e.key === 'Escape') { setDraft(layer.customName || layer.name); setEditing(false); }
          }}
        />
      ) : (
        <button className="layer-card__name" onClick={() => setEditing(true)} title="Click to rename">
          {display}
        </button>
      )}
      <div className="layer-card__actions">
        <button className="layer-card__remove" onClick={onRemove}>×</button>
      </div>
    </div>
  );
});
