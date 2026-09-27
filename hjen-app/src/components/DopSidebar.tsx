import { useStore } from '../store';
import {
  movieThumb, photographerThumb,
  cameraIcon, lensIcon, stockIcon,
  lightingThumb, movementStandin,
} from '../lib/catalog';
import { resolveSize } from '../lib/models';

/**
 * Cinematography panel — slides in from the LEFT (over the canvas) when
 * the user clicks the DOP button. Uses the layout the user requested:
 * rich, grouped sections instead of a flat chip list.
 *
 * All rows open the existing PickerModal so the user can change a value;
 * the panel stays open so they can chain selections. Clear-buttons live
 * inside each picker modal (added earlier).
 */
export function DopSidebar() {
  const open = useStore(s => s.dopOpen);
  const close = useStore(s => s.setDopOpen);
  // When the DOP is bound to a Node canvas Frame, dock it on the RIGHT.
  const onRight = useStore(s => s.dopTargetNodeId !== null);
  const selections = useStore(s => s.selections);
  const openPicker = useStore(s => s.openPicker);
  const setSelection = useStore(s => s.setSelection);

  const sizePreview = resolveSize(selections.model, selections.aspect, selections.resolution);

  return (
    <>
      {/* Click-outside-to-close: an invisible backdrop sits behind the panel
       *  while it's open. Clicking anywhere outside the DOP closes it, same
       *  as the X or Esc. Mounted only when open so it never blocks the
       *  canvas otherwise. */}
      {open && (
        <div
          className="dop-backdrop"
          onClick={() => close(false)}
          aria-hidden="true"
        />
      )}
      <aside className={`dop-sidebar ${open ? 'dop-sidebar--open' : ''} ${onRight ? 'dop-sidebar--right' : ''}`} aria-hidden={!open}>
      <header className="dop-sidebar__head">
        <div>
          <div className="mono-label dop-sidebar__head-eyebrow">Cinematography</div>
          <h2 className="dop-sidebar__head-title">DOP</h2>
        </div>
        <button className="dop-sidebar__close" onClick={() => close(false)} title="Close (Esc)">×</button>
      </header>

      <div className="dop-sidebar__body">
        {/* === FRAMING === */}
        <section className="dop-section">
          <h3 className="dop-section__title mono-label">Framing</h3>
          <RowItem
            label="Perspective"
            value={selections.angle?.name}
            sub={selections.angle?.description}
            onClick={() => openPicker('angle')}
          />
          <RowItem
            label="Aspect ratio"
            value={`${selections.aspect}`}
            sub={`${sizePreview.targetWidth}×${sizePreview.targetHeight}`}
            onClick={() => openPicker('aspect')}
          />
        </section>

        {/* === STYLE & AESTHETICS PRESET === */}
        <section className="dop-section">
          <h3 className="dop-section__title mono-label">Style &amp; aesthetics preset</h3>
          <div className="dop-style-toggle">
            {(['NONE', 'MOVIE', 'PHOTOGRAPHER'] as const).map(v => (
              <button
                key={v}
                className={`dop-style-toggle__btn ${selections.style_preset === v ? 'dop-style-toggle__btn--active' : ''}`}
                onClick={() => setSelection('style_preset', v)}
              >{v.toLowerCase()}</button>
            ))}
          </div>

          {selections.style_preset === 'MOVIE' && (
            <BigPreviewCard
              caption="movie"
              title={selections.movie?.title ?? 'Pick a movie'}
              sub={selections.movie ? `${selections.movie.year}${selections.movie.director ? ' · ' + selections.movie.director : ''}` : 'No movie selected'}
              thumb={selections.movie ? movieThumb(selections.movie.filename) : undefined}
              onClick={() => openPicker('movie')}
            />
          )}
          {selections.style_preset === 'PHOTOGRAPHER' && (
            <BigPreviewCard
              caption="photographer"
              title={selections.photographer?.name ?? 'Pick a photographer'}
              sub={selections.photographer?.notes ?? 'No photographer selected'}
              thumb={selections.photographer ? photographerThumb(selections.photographer.filename) : undefined}
              onClick={() => openPicker('photographer')}
            />
          )}
          {selections.style_preset === 'NONE' && (
            <div className="dop-style-empty mono-label">No style anchor — the model's own aesthetic will lead.</div>
          )}
        </section>

        {/* === CAMERA GEAR === */}
        <section className="dop-section">
          <h3 className="dop-section__title mono-label">Camera gear</h3>
          <div className="dop-gear-grid">
            <GearCard
              label="Camera body"
              value={selections.camera?.name}
              icon={selections.camera ? cameraIcon(selections.camera.filename) : undefined}
              onClick={() => openPicker('camera')}
              productShot
            />
            <GearCard
              label="Lens"
              value={selections.lens?.name}
              icon={selections.lens ? lensIcon(selections.lens.filename) : undefined}
              onClick={() => openPicker('lens')}
              productShot
            />
            <GearCard
              label="Film stock"
              value={selections.stock?.name}
              icon={selections.stock ? stockIcon(selections.stock.filename) : undefined}
              onClick={() => openPicker('stock')}
              productShot
            />
            <GearCard
              label="Focal length"
              value={selections.focal_mm ? `${selections.focal_mm}mm` : null}
              sub={selections.focal_mm ? focalDescriptor(selections.focal_mm) : undefined}
              onClick={() => openPicker('focal')}
              numeric
            />
            <GearCard
              label="Aperture"
              value={selections.aperture_f ? `f/${selections.aperture_f}` : null}
              sub={selections.aperture_f ? apertureDescriptor(selections.aperture_f) : undefined}
              onClick={() => openPicker('aperture')}
              numeric
            />
          </div>
        </section>

        {/* === LIGHTING & MOVEMENT === */}
        <section className="dop-section">
          <h3 className="dop-section__title mono-label">Lighting &amp; movement</h3>
          <RowItem
            label="Lighting"
            value={selections.lighting?.name}
            sub={selections.lighting?.description}
            thumb={selections.lighting ? lightingThumb(selections.lighting.filename) : undefined}
            onClick={() => openPicker('lighting')}
          />
          <RowItem
            label="Movement"
            value={selections.movement?.name}
            sub={selections.movement?.description}
            thumb={selections.movement ? movementStandin('stand-in.jpg') : undefined}
            onClick={() => openPicker('movement')}
          />
        </section>
      </div>
      </aside>
    </>
  );
}

interface RowItemProps {
  label: string;
  value?: string | null;
  sub?: string;
  thumb?: string;
  onClick: () => void;
}
function RowItem({ label, value, sub, thumb, onClick }: RowItemProps) {
  const empty = !value;
  return (
    <button className={`dop-row ${empty ? 'dop-row--empty' : ''}`} onClick={onClick}>
      {thumb && <img className="dop-row__thumb" src={thumb} alt="" loading="lazy" />}
      <div className="dop-row__body">
        <div className="dop-row__label mono-label">{label}</div>
        <div className="dop-row__value">{value ?? 'Not set'}</div>
        {sub && <div className="dop-row__sub">{sub}</div>}
      </div>
      <span className="dop-row__chev">›</span>
    </button>
  );
}

interface BigPreviewProps {
  caption: string;
  title: string;
  sub?: string;
  thumb?: string;
  onClick: () => void;
}
function BigPreviewCard({ caption, title, sub, thumb, onClick }: BigPreviewProps) {
  return (
    <button className="dop-big-preview" onClick={onClick}>
      {thumb && <img className="dop-big-preview__img" src={thumb} alt="" loading="lazy" />}
      <div className="dop-big-preview__overlay">
        <span className="dop-big-preview__caption mono-label">{caption}</span>
        <span className="dop-big-preview__title">{title}</span>
        {sub && <span className="dop-big-preview__sub mono-label">{sub}</span>}
      </div>
    </button>
  );
}

interface GearCardProps {
  label: string;
  value?: string | null;
  sub?: string;
  icon?: string;
  onClick: () => void;
  numeric?: boolean;
  /** Render the icon as a centered product shot on a white background
   *  (instead of a full-bleed scene photo). Used for Camera / Lens / Stock. */
  productShot?: boolean;
}
function GearCard({ label, value, sub, icon, onClick, numeric, productShot }: GearCardProps) {
  const empty = !value;
  return (
    <button
      className={`dop-gear-card ${empty ? 'dop-gear-card--empty' : ''} ${numeric ? 'dop-gear-card--numeric' : ''} ${productShot ? 'dop-gear-card--product' : ''}`}
      onClick={onClick}
    >
      <div className="dop-gear-card__media">
        {numeric
          ? <span className="dop-gear-card__numeric-display">{value ?? '—'}</span>
          : icon
            ? <img className="dop-gear-card__product" src={icon} alt="" loading="lazy" />
            : <span className="dop-gear-card__placeholder">—</span>}
      </div>
      <div className="dop-gear-card__label mono-label">{label}</div>
      {!numeric && <div className="dop-gear-card__value">{value ?? 'Not set'}</div>}
      {sub && <div className="dop-gear-card__sub">{sub}</div>}
    </button>
  );
}

function focalDescriptor(mm: number): string {
  if (mm <= 16) return 'Ultra wide';
  if (mm <= 28) return 'Wide';
  if (mm <= 40) return 'Standard wide';
  if (mm <= 60) return 'Standard';
  if (mm <= 90) return 'Short telephoto / portrait';
  if (mm <= 140) return 'Portrait telephoto';
  return 'Telephoto';
}
function apertureDescriptor(f: number): string {
  if (f <= 1.4) return 'Very shallow DoF';
  if (f <= 2.8) return 'Shallow DoF';
  if (f <= 5.6) return 'Moderate DoF';
  if (f <= 11) return 'Deep DoF';
  return 'Very deep DoF';
}
