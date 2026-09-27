/** The five Clay & Basil pillars surfaced as visible chips in every stage
 *  that touches an image. Per memory, the DNA is *enforced, not optional*.
 *  This row is read-only — it shows the photographer what their work is
 *  being measured against, frame by frame. */
export const CLAY_BASIL_PILLARS: ReadonlyArray<string> = [
  'Lived-in Kingdom',
  'Teal Shadow · Warm Skin',
  'Environmental Portrait',
  'Saudi Object',
  'Cinematic Frame',
];

interface Props {
  regions?: string[];
  /** Optional override — by default shows the five pillars. */
  pillars?: ReadonlyArray<string>;
}

export function DnaChipRow({ regions, pillars }: Props) {
  const pp = pillars ?? CLAY_BASIL_PILLARS;
  return (
    <section className="dna-chip-row">
      <h5 className="dna-chip-row__title mono-label">DNA</h5>
      <div className="dna-chip-row__chips">
        {pp.map((p, i) => <span key={i} className="dna-chip">{p}</span>)}
        {regions && regions.length > 0 && (
          <>
            <span className="dna-chip-row__divider">·</span>
            {regions.map((r, i) => <span key={i} className="dna-chip dna-chip--region">{r}</span>)}
          </>
        )}
      </div>
    </section>
  );
}
