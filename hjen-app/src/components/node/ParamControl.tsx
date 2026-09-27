// ParamControl — renders one node parameter as an inline, editable widget
// inside the node body (Griptape-style). Used by NodeView's node cards.

import type { Parameter } from '../../lib/node-engine/types';

const fileUrl = (p: string) => `hjen-file://${encodeURI(p)}`;

interface Props {
  param: Parameter;
  value: unknown;
  onChange: (value: unknown) => void;
  /** Opens an asset / selections editor for controls we don't edit inline yet. */
  onAction?: (param: Parameter) => void;
}

export function ParamControl({ param, value, onChange, onAction }: Props) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const control = param.control ?? inferControl(param);

  if (control === 'textarea') {
    return (
      <textarea
        className="nv-w nv-w__textarea nodrag"
        value={(value as string) ?? ''}
        placeholder={param.label}
        rows={3}
        onPointerDown={stop}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (control === 'number') {
    const hasRange = typeof param.min === 'number' && typeof param.max === 'number';
    return (
      <div className="nv-w__num">
        {hasRange && (
          <input
            type="range"
            className="nv-w nv-w__range nodrag"
            min={param.min} max={param.max} step={param.step ?? 0.05}
            value={Number(value ?? param.default ?? 0)}
            onPointerDown={stop}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        )}
        <input
          type="number"
          className="nv-w nv-w__number nodrag"
          step={param.step ?? 'any'}
          value={Number(value ?? param.default ?? 0)}
          onPointerDown={stop}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
    );
  }

  if (control === 'toggle') {
    return (
      <label className="nv-w__toggle nodrag" onPointerDown={stop}>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="nv-w__toggle-track"><span className="nv-w__toggle-thumb" /></span>
      </label>
    );
  }

  if (control === 'select') {
    return (
      <select
        className="nv-w nv-w__select nodrag"
        value={(value as string) ?? (param.default as string) ?? ''}
        onPointerDown={stop}
        onChange={(e) => onChange(e.target.value)}
      >
        {(param.options ?? []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }

  if (control === 'asset') {
    const a = value as { filePath?: string; path?: string; thumbPath?: string; name?: string } | undefined;
    const thumb = a?.thumbPath || a?.filePath || a?.path;
    return (
      <button className="nv-w__asset nodrag" onPointerDown={stop} onClick={() => onAction?.(param)}>
        {thumb
          ? <img className="nv-w__asset-thumb" src={fileUrl(thumb)} alt="" />
          : <span className="nv-w__asset-empty">＋ pick asset</span>}
        {a?.name && <span className="nv-w__asset-name">{a.name}</span>}
      </button>
    );
  }

  if (control === 'selections') {
    return (
      <button className="nv-w__link nodrag" onPointerDown={stop} onClick={() => onAction?.(param)}>
        Open DOP ▸
      </button>
    );
  }

  // default: text
  return (
    <input
      type="text"
      className="nv-w nv-w__text nodrag"
      value={(value as string) ?? ''}
      placeholder={param.label}
      onPointerDown={stop}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function inferControl(p: Parameter): NonNullable<Parameter['control']> {
  switch (p.dataType) {
    case 'number': return 'number';
    case 'boolean': return 'toggle';
    case 'text': return 'text';
    default: return 'text';
  }
}
