interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

/** Single-line honest-risk field used in every stage tool.
 *  Empty value is not blocked — but the empty state shows a visible warning
 *  chip so the user knows they're skipping the discipline. */
export function HonestRiskField({ value, onChange, placeholder }: Props) {
  const empty = !value.trim();
  return (
    <div className={`honest-risk ${empty ? 'honest-risk--empty' : ''}`}>
      <label className="honest-risk__label mono-label">
        Honest risk
        {empty && <span className="honest-risk__chip">unfilled</span>}
      </label>
      <textarea
        className="honest-risk__input"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? "What could collapse this on shoot day?"}
        rows={2}
      />
    </div>
  );
}
