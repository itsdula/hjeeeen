interface Props {
  refusals: string[];
  onChange?: (next: string[]) => void;
  /** Read-only mode shows the chips without the editor — used in stages
   *  02-08 to display Brief's refusals as a guard rail. */
  readOnly?: boolean;
  /** Title shown above the chips. */
  title?: string;
}

/** Default refusals seeded by the Brief stage — straight from CLAUDE.md.
 *  Surfaced as the *floor* of refusals for every project. The user adds
 *  on top of these, never removes them. */
export const DEFAULT_REFUSALS: ReadonlyArray<string> = [
  'no white-thobe-laughing-at-phone',
  'no desert-sunset-with-falcon',
  'no diverse-team-at-laptop',
  'no orientalist-archive-light',
  'no logo-front-and-center',
];

export function RefusalsRow({ refusals, onChange, readOnly, title }: Props) {
  if (readOnly) {
    return (
      <section className="refusals refusals--ro">
        {title && <h5 className="refusals__title mono-label">{title}</h5>}
        <div className="refusals__chips">
          {refusals.map((r, i) => <span key={i} className="refusals__chip">{r}</span>)}
        </div>
      </section>
    );
  }

  return (
    <section className="refusals">
      <h5 className="refusals__title mono-label">{title ?? 'Refusals — what this campaign won\'t do'}</h5>
      <div className="refusals__chips">
        {refusals.map((r, i) => (
          <span key={i} className="refusals__chip refusals__chip--editable">
            <input
              className="refusals__input"
              value={r}
              onChange={e => onChange?.(refusals.map((x, j) => j === i ? e.target.value : x))}
            />
            <button
              className="refusals__remove"
              title="Remove refusal"
              onClick={() => onChange?.(refusals.filter((_, j) => j !== i))}
            >×</button>
          </span>
        ))}
        <button
          className="refusals__add"
          onClick={() => onChange?.([...refusals, ''])}
        >+ add refusal</button>
      </div>
    </section>
  );
}
