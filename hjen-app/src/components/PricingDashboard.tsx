import { useEffect, useMemo, useState } from 'react';
import {
  PRICING,
  DEFAULT_PRICING_CONFIG,
  effectiveRate,
  resolveCost,
  formatUSD,
  type PricingConfig,
  type RateEntry,
  type ResolveCostInput,
} from '../lib/cost';

// ----------------------------------------------------------------------------
// Friendly labels + a representative scenario per model, so the preview shows
// a real client price (not an abstract per-unit number). These samples only
// drive the dashboard preview — live cost is metered at generation time.
// ----------------------------------------------------------------------------
const LABELS: Record<string, string> = {
  'openai:gpt-image-2': 'OpenAI · gpt-image-2',
  'google:imagen-3.0': 'Google · Imagen (Nano Banana Pro)',
  'byteplus:dreamina-seedance-2-0': 'BytePlus · Seedance 2.0 (video)',
  'replicate:sczhou/codeformer': 'Replicate · CodeFormer (face)',
  'replicate:philz1337x/clarity-upscaler': 'Replicate · Clarity Upscaler',
  'anthropic:claude-sonnet-4-6': 'Claude · Sonnet 4.6 (prompt enhance)',
};

interface Sample {
  label: string;
  input: ResolveCostInput;
}

function sampleFor(key: string, unit: RateEntry['unit']): Sample {
  switch (unit) {
    case 'token': // Seedance video — 1080p × 5s ≈ (1920·1080·24·5)/1024 tokens
      return { label: '1080p · 5s clip', input: { key, usage: { completionTokens: 243_000 } } };
    case 'token-io': // Claude enhance — typical prompt round-trip
      return { label: '~3.1K tokens', input: { key, usage: { inputTokens: 2_500, outputTokens: 600 } } };
    case 'compute-sec':
      return { label: '25s compute', input: { key, usage: { computeSeconds: 25 } } };
    case 'image-mp': // gpt-image-2 — the card-set default
      return { label: '2304×1536 · high', input: { key, params: { width: 2304, height: 1536, quality: 'high', imageCount: 1 } } };
    case 'image-tier':
      return { label: '1 image · ultra', input: { key, params: { tier: 'ultra', imageCount: 1 } } };
    default:
      return { label: '1 unit', input: { key } };
  }
}

// Clamp + parse a number input, keeping empty → null for override fields.
function numOrNull(v: string): number | null {
  if (v.trim() === '') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

export function PricingDashboard() {
  const [config, setConfig] = useState<PricingConfig>(DEFAULT_PRICING_CONFIG);
  const [saved, setSaved] = useState<PricingConfig>(DEFAULT_PRICING_CONFIG);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    window.hjen.getPricingConfig().then(loaded => {
      const merged: PricingConfig = loaded
        ? {
            global: { ...DEFAULT_PRICING_CONFIG.global, ...loaded.global },
            models: loaded.models ?? {},
            updatedAt: loaded.updatedAt,
          }
        : DEFAULT_PRICING_CONFIG;
      setConfig(merged);
      setSaved(merged);
      setLoading(false);
    });
  }, []);

  const dirty = useMemo(
    () => JSON.stringify({ ...config, updatedAt: undefined }) !== JSON.stringify({ ...saved, updatedAt: undefined }),
    [config, saved],
  );

  // ---- mutators ----
  const setGlobal = (patch: Partial<PricingConfig['global']>) => {
    setConfig(c => ({ ...c, global: { ...c.global, ...patch } }));
    setStatus(null);
  };
  const setModel = (key: string, patch: Partial<PricingConfig['models'][string]>) => {
    setConfig(c => ({ ...c, models: { ...c.models, [key]: { ...c.models[key], ...patch } } }));
    setStatus(null);
  };
  const setRate = (key: string, ratePatch: RateEntry['rate']) => {
    const current = effectiveRate(key, config)!.rate;
    setModel(key, { rate: { ...current, ...ratePatch } });
  };

  const save = async () => {
    const res = await window.hjen.setPricingConfig(config);
    if (res.ok) {
      const next = { ...config, updatedAt: new Date().toISOString() };
      setSaved(next);
      setConfig(next);
      setStatus('Saved. Reports reprice on next open.');
    } else {
      setStatus(`Save failed: ${res.reason ?? 'unknown'}`);
    }
  };
  const revert = () => { setConfig(saved); setStatus(null); };
  const resetAll = () => { setConfig(DEFAULT_PRICING_CONFIG); setStatus('Reset to defaults — not yet saved.'); };

  if (loading) {
    return (
      <div className="page">
        <p className="page__subtitle mono-label">Loading pricing…</p>
      </div>
    );
  }

  const rows = Object.keys(PRICING).map(key => {
    const entry = effectiveRate(key, config)!;
    const sample = sampleFor(key, entry.unit);
    const cost = resolveCost(sample.input, config)!;
    const ov = config.models[key] ?? {};
    return { key, entry, sample, cost, ov };
  });

  const g = config.global;

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1 className="page__title">Pricing</h1>
          <p className="page__subtitle mono-label">
            vendor cost × (1 + markup) × (1 − discount) = client price · cost stays ground truth, price is derived
          </p>
        </div>
        <div className="pricing-actions">
          <button className="btn-secondary" onClick={resetAll}>Reset defaults</button>
          <button className="btn-secondary" onClick={revert} disabled={!dirty}>Revert</button>
          <button className="btn-primary" onClick={save} disabled={!dirty}>Save</button>
        </div>
      </header>

      {status && <div className="pricing-status">{status}</div>}

      {/* ---- Global knobs ---- */}
      <section className="usage-card pricing-globals">
        <h2 className="usage-card__title mono-label">Global default</h2>
        <div className="pricing-global-row">
          <label className="pricing-field">
            <span>Markup % on cost</span>
            <input
              type="number" className="setting-input pricing-input" min={0} step={5}
              value={g.markupPct}
              onChange={e => setGlobal({ markupPct: parseFloat(e.target.value) || 0 })}
            />
          </label>
          <label className="pricing-field">
            <span>Discount % off price</span>
            <input
              type="number" className="setting-input pricing-input" min={0} max={100} step={5}
              value={g.discountPct}
              onChange={e => setGlobal({ discountPct: Math.min(100, parseFloat(e.target.value) || 0) })}
            />
          </label>
          <p className="pricing-hint">
            Applies to every model unless a row below overrides it. Leave a row's markup/discount blank to inherit these.
          </p>
        </div>
      </section>

      {/* ---- Per-model table ---- */}
      <section className="usage-card">
        <h2 className="usage-card__title mono-label">Per-model — edit the vendor rate (“price”) and override margin</h2>
        <table className="usage-table pricing-table">
          <thead>
            <tr>
              <th>Model</th>
              <th>Vendor rate</th>
              <th>Markup %</th>
              <th>Discount %</th>
              <th>Sample</th>
              <th className="num">Cost</th>
              <th className="num">Client price</th>
              <th className="num">Margin</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, entry, sample, cost, ov }) => (
              <tr key={key}>
                <td>
                  <div className="pricing-model">{LABELS[key] ?? entry.model}</div>
                  <div className="pricing-sub">
                    <span className={cost.metered ? 'pricing-tag pricing-tag--metered' : 'pricing-tag'}>
                      {cost.metered ? 'metered' : 'estimated'}
                    </span>
                    {entry.unverified && <span className="pricing-tag pricing-tag--warn">rate unverified</span>}
                    <span className="pricing-asof">as of {entry.asOf}</span>
                  </div>
                </td>
                <td>{rateEditor(key, entry, setRate)}</td>
                <td>
                  <input
                    type="number" className="setting-input pricing-input pricing-input--sm" min={0} step={5}
                    placeholder={`${g.markupPct}`}
                    value={ov.markupPct ?? ''}
                    onChange={e => setModel(key, { markupPct: numOrNull(e.target.value) })}
                  />
                </td>
                <td>
                  <input
                    type="number" className="setting-input pricing-input pricing-input--sm" min={0} max={100} step={5}
                    placeholder={`${g.discountPct}`}
                    value={ov.discountPct ?? ''}
                    onChange={e => setModel(key, { discountPct: numOrNull(e.target.value) })}
                  />
                </td>
                <td className="pricing-sample">{sample.label}</td>
                <td className="num">{formatUSD(cost.actualCostUsd)}</td>
                <td className="num accent">{formatUSD(cost.clientPriceUsd ?? 0)}</td>
                <td className="num">{formatUSD(cost.marginUsd ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="pricing-hint">
          “Client price” is computed on the sample scenario shown, at the effective markup/discount for that row.
          Editing a vendor rate overrides the registry default — your edits persist to <code>_pricing.json</code>.
        </p>
      </section>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Rate editor — adapts to the model's billing unit.
// ----------------------------------------------------------------------------
function rateEditor(
  key: string,
  entry: RateEntry,
  setRate: (key: string, patch: RateEntry['rate']) => void,
) {
  const r = entry.rate;
  const cls = 'setting-input pricing-input pricing-input--sm';
  switch (entry.unit) {
    case 'token':
      return (
        <span className="pricing-rate">
          <input type="number" className={cls} step={0.1} min={0}
            value={r.usdPerMTok ?? 0}
            onChange={e => setRate(key, { usdPerMTok: parseFloat(e.target.value) || 0 })} />
          <em>$/M tok</em>
        </span>
      );
    case 'token-io':
      return (
        <span className="pricing-rate pricing-rate--col">
          <label><input type="number" className={cls} step={0.5} min={0}
            value={r.inPerMTok ?? 0}
            onChange={e => setRate(key, { inPerMTok: parseFloat(e.target.value) || 0 })} /> <em>in $/M</em></label>
          <label><input type="number" className={cls} step={0.5} min={0}
            value={r.outPerMTok ?? 0}
            onChange={e => setRate(key, { outPerMTok: parseFloat(e.target.value) || 0 })} /> <em>out $/M</em></label>
        </span>
      );
    case 'compute-sec':
      return (
        <span className="pricing-rate">
          <input type="number" className={cls} step={0.0001} min={0}
            value={r.usdPerSec ?? 0}
            onChange={e => setRate(key, { usdPerSec: parseFloat(e.target.value) || 0 })} />
          <em>$/sec</em>
        </span>
      );
    case 'image-mp': {
      const mp = r.perMP ?? { low: 0, medium: 0, high: 0 };
      return (
        <span className="pricing-rate pricing-rate--col">
          {(['low', 'medium', 'high'] as const).map(q => (
            <label key={q}><input type="number" className={cls} step={0.001} min={0}
              value={mp[q] ?? 0}
              onChange={e => setRate(key, { perMP: { ...mp, [q]: parseFloat(e.target.value) || 0 } })} /> <em>{q} $/MP</em></label>
          ))}
        </span>
      );
    }
    case 'image-tier': {
      const t = r.perTier ?? {};
      const tiers = Object.keys(t).length ? Object.keys(t) : ['draft', 'standard', 'ultra'];
      return (
        <span className="pricing-rate pricing-rate--col">
          {tiers.map(tier => (
            <label key={tier}><input type="number" className={cls} step={0.005} min={0}
              value={t[tier] ?? 0}
              onChange={e => setRate(key, { perTier: { ...t, [tier]: parseFloat(e.target.value) || 0 } })} /> <em>{tier} $/img</em></label>
          ))}
        </span>
      );
    }
    default:
      return <span className="pricing-sub">—</span>;
  }
}
