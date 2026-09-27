import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { Card, Metric, Text, Title } from '@tremor/react';
const Chart = lazy(() => import('./Chart'));
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel,
  flexRender, createColumnHelper, type SortingState,
} from '@tanstack/react-table';
import { api, getToken, clearToken, type Invitee } from './api';

const PLANS = ['trial', 'pro', 'team', 'enterprise'];
type Section = 'home' | 'accounts' | 'orgs' | 'approvals' | 'activity' | 'audit' | 'expenses' | 'settings';

// ─────────────────────────────────────────── auth
function Login({ onOk }: { onOk: () => void }) {
  const [tok, setTok] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); setErr(''); if (await api.verify(tok.trim())) onOk(); else { setErr('Wrong token.'); setBusy(false); } };
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 font-semibold tracking-wide">HJEN · <span className="text-accent">Control Plane</span></div>
        <div className="flex gap-2">
          <input type="password" value={tok} placeholder="ADMIN_TOKEN" onChange={(e) => setTok(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()}
            className="flex-1 bg-graphite-900 border border-line rounded-lg px-3 py-2.5 outline-none focus:border-accent text-sm" />
          <button onClick={go} disabled={busy} className="bg-accent text-black font-semibold rounded-lg px-5 text-sm disabled:opacity-50">{busy ? '…' : 'Enter'}</button>
        </div>
        {err && <div className="text-red-400 text-sm mt-2">{err}</div>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────── Qoyod expenses
function QoyodExpenses() {
  const [st, setSt] = useState<any>(null);
  const [cats, setCats] = useState<{ id: number; name: string; code?: string }[]>([]);
  const [f, setF] = useState({ vendorName: '', vendorTaxNumber: '', categoryId: '', description: '', amount: '', withVat: true, reference: '' });
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);

  const reload = async () => { setSt(await api.qoyodStatus()); setCats(await api.qoyodExpenseCategories()); };
  useEffect(() => { reload(); }, []);

  const submit = async () => {
    setBusy(true); setMsg('');
    const r = await api.qoyodExpense({ ...f, amount: Number(f.amount), categoryId: f.categoryId ? Number(f.categoryId) : undefined });
    setBusy(false);
    if (r?.ok) { setMsg(r.note === 'dry_run' ? 'Dry-run — logged, nothing created.' : `Recorded (bill #${r.billId}).`); setF({ ...f, description: '', amount: '', reference: '' }); reload(); }
    else setMsg('Failed: ' + (r?.note || 'error'));
  };

  const input = 'w-full bg-graphite-900 border border-line rounded-lg px-3 py-2 outline-none focus:border-accent text-sm';
  const cfg = st?.configured, dry = st?.dryRun;
  return (
    <><h1 className="text-xl font-semibold mb-1">Expenses → Qoyod</h1>
      <p className="text-sm text-zinc-500 mb-6">Record a business expense as a Qoyod bill (ZATCA books).</p>
      <div className="flex flex-wrap gap-2 mb-5 text-xs">
        <span className={`px-2.5 py-1 rounded-full border ${cfg ? 'border-emerald-500/40 text-emerald-400' : 'border-red-400/40 text-red-400'}`}>{cfg ? 'Connected' : 'Not configured'}</span>
        {cfg && <span className={`px-2.5 py-1 rounded-full border ${dry ? 'border-accent/40 text-accent' : 'border-emerald-500/40 text-emerald-400'}`}>{dry ? 'Dry-run' : 'Live'}</span>}
        {cfg && <span className="px-2.5 py-1 rounded-full border border-line text-zinc-400">VAT {st?.vatPercent ?? 0}%</span>}
        {cfg && st?.queueDepth > 0 && <span className="px-2.5 py-1 rounded-full border border-red-400/40 text-red-400">Retry queue: {st.queueDepth}</span>}
      </div>
      <Card className="!bg-graphite-800 !border-line !ring-0 max-w-lg space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs text-zinc-500">Vendor</label><input className={input} value={f.vendorName} onChange={(e) => setF({ ...f, vendorName: e.target.value })} placeholder="e.g. AWS" /></div>
          <div><label className="text-xs text-zinc-500">Vendor tax no. (optional)</label><input className={input} value={f.vendorTaxNumber} onChange={(e) => setF({ ...f, vendorTaxNumber: e.target.value })} /></div>
        </div>
        <div><label className="text-xs text-zinc-500">Category</label>
          {cats.length
            ? <select className={input} value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}><option value="">Select…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ''}</option>)}</select>
            : <input className={input} value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })} placeholder="Qoyod expense category id" />}
        </div>
        <div><label className="text-xs text-zinc-500">Description</label><input className={input} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3 items-end">
          <div><label className="text-xs text-zinc-500">Amount (SAR, ex-VAT)</label><input className={input} type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
          <label className="flex items-center gap-2 text-sm text-zinc-300 pb-2"><input type="checkbox" checked={f.withVat} onChange={(e) => setF({ ...f, withVat: e.target.checked })} /> Add {st?.vatPercent ?? 15}% VAT</label>
        </div>
        <div><label className="text-xs text-zinc-500">Reference (optional)</label><input className={input} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></div>
        <div className="flex items-center gap-3 pt-1">
          <button onClick={submit} disabled={busy || !cfg || !f.vendorName || !f.amount || !f.categoryId} className="bg-accent text-black font-semibold rounded-lg px-5 py-2 text-sm disabled:opacity-40">{busy ? '…' : 'Record expense'}</button>
          {msg && <span className="text-xs text-zinc-400">{msg}</span>}
        </div>
      </Card></>
  );
}

// ─────────────────────────────────────────── shared bits
function statusOf(inv: Invitee) {
  return inv.pending ? { t: 'Pending', c: 'text-accent bg-accent/10' }
    : inv.rejected ? { t: 'Rejected', c: 'text-red-400 bg-red-400/10' }
    : inv.gateOpen ? { t: 'Open', c: 'text-emerald-400 bg-emerald-400/10' }
    : !inv.active ? { t: 'Stopped', c: 'text-red-400 bg-red-400/10' }
    : inv.daysLeft === 0 ? { t: 'Expired', c: 'text-red-400 bg-red-400/10' }
    : { t: 'Complete', c: 'text-zinc-400 bg-zinc-400/10' };
}
const Pill = ({ inv }: { inv: Invitee }) => { const s = statusOf(inv); return <span className={`text-[11px] px-2 py-0.5 rounded-full ${s.c}`}>{s.t}</span>; };
const Badge = ({ inv }: { inv: Invitee }) => inv.isOrg
  ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-400/15 text-emerald-400 mr-1.5">TEAM</span>
  : inv.clerkUserId ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent mr-1.5">CLERK</span> : null;

// ─────────────────────────────────────────── detail drawer (row = doorway → full record)
function Drawer({ inv, onClose, refresh }: { inv: Invitee; onClose: () => void; refresh: () => void }) {
  const [members, setMembers] = useState<any[] | null>(null);
  useEffect(() => { if (inv.isOrg && inv.clerkOrgId) api.orgMembers(inv.clerkOrgId).then(setMembers); }, [inv]);
  const act = async (fn: () => Promise<any>) => { await fn(); refresh(); onClose(); };
  const pct = Math.min(100, Math.round((inv.genUsed / (inv.genLimit || 1)) * 100));
  const Row = ({ k, v }: { k: string; v: any }) => (
    <div className="flex justify-between py-2 border-b border-line/60 text-sm"><span className="text-zinc-500">{k}</span><span className="text-ink">{v}</span></div>
  );
  const A = 'text-xs border border-line rounded-md px-3 py-1.5 hover:border-accent';
  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative w-full max-w-md bg-graphite-800 border-l border-line h-full overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center mb-1"><Badge inv={inv} /><span className="text-lg font-semibold">{inv.name}</span></div>
            <div className="text-sm text-zinc-500">{inv.email}</div>
          </div>
          <button onClick={onClose} className="text-zinc-500 text-xl leading-none">×</button>
        </div>
        <div className="mb-4"><Pill inv={inv} /></div>

        {/* quota */}
        <div className="mb-4">
          <div className="flex justify-between text-xs text-zinc-500 mb-1"><span>Quota</span><span className="tabular-nums">{inv.genUsed}/{inv.genLimit}</span></div>
          <div className="h-2 bg-line rounded overflow-hidden"><div className="h-full bg-accent" style={{ width: pct + '%' }} /></div>
        </div>

        <Row k="Plan" v={
          <select defaultValue={inv.plan || 'trial'} onChange={(e) => act(() => api.setPlan(inv.id, e.target.value))}
            className="bg-graphite-900 border border-line rounded px-2 py-1 text-xs">
            {PLANS.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
          </select>} />
        <Row k="Days left" v={inv.daysLeft} />
        <Row k="Spend" v={<span className="text-accent">${inv.spentUsd ?? 0}</span>} />
        {inv.country && <Row k="Country" v={inv.country} />}
        {inv.note && <Row k="Note" v={inv.note} />}
        {inv.clerkUserId && <Row k="Clerk user" v={<span className="text-xs">{inv.clerkUserId.slice(0, 16)}…</span>} />}

        {/* org members */}
        {inv.isOrg && (
          <div className="mt-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Members</div>
            {members === null ? <div className="text-xs text-zinc-500">Loading…</div>
              : members.length ? members.map((m, i) => (
                <div key={i} className="flex items-center gap-2 text-sm py-1"><b>{m.name}</b><span className="text-zinc-500 text-xs">{m.email}</span><span className="text-emerald-400 text-[11px] ml-auto">{m.role || 'member'}</span></div>
              )) : <div className="text-xs text-zinc-500">No members yet</div>}
          </div>
        )}

        {/* quick action bar (Stripe pattern) */}
        <div className="mt-6 flex flex-wrap gap-2">
          {inv.pending ? <>
            <button className={A} onClick={() => act(() => api.action('approve', { id: inv.id, genLimit: 40, durationDays: 15 }))}>Approve</button>
            <button className={A} onClick={() => act(() => api.action('reject', { id: inv.id }))}>Reject</button>
          </> : <>
            <button className={A} onClick={() => act(() => api.action('extend', { id: inv.id, days: 7 }))}>+7 days</button>
            <button className={A} onClick={() => act(() => api.action('bump', { id: inv.id, makes: 10 }))}>+10 shots</button>
            {inv.active ? <button className={A} onClick={() => act(() => api.action('stop', { id: inv.id }))}>Stop</button>
              : <button className={A} onClick={() => act(() => api.action('activate', { id: inv.id }))}>Activate</button>}
          </>}
          {inv.magicLink && <button className={A} onClick={() => navigator.clipboard.writeText(inv.magicLink!)}>Copy link</button>}
          <button className={`${A} !border-accent text-accent`} onClick={async () => { const link = await api.impersonate(inv.id); if (link) window.open(link, '_blank'); }}>View as user ↗</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────── accounts table (rows open the drawer)
function AccountsTable({ rows, onOpen }: { rows: Invitee[]; onOpen: (i: Invitee) => void }) {
  const [sorting, setSorting] = useState<SortingState>([]); const [filter, setFilter] = useState('');
  const ch = createColumnHelper<Invitee>();
  const columns = useMemo(() => [
    ch.accessor('name', { header: 'Account', cell: (c) => (<div><div className="flex items-center"><Badge inv={c.row.original} /><span className="font-medium">{c.getValue()}</span></div><div className="text-xs text-zinc-500">{c.row.original.email}</div></div>) }),
    ch.accessor('plan', { header: 'Plan', cell: (c) => <span className="text-xs capitalize text-zinc-300">{c.getValue() || 'trial'}</span> }),
    ch.accessor((r) => r.genUsed / (r.genLimit || 1), { id: 'usage', header: 'Usage', cell: (c) => { const inv = c.row.original; const pct = Math.min(100, Math.round((inv.genUsed / (inv.genLimit || 1)) * 100)); return (<div className="flex items-center gap-2 text-xs"><span className="tabular-nums w-14">{inv.genUsed}/{inv.genLimit}</span><span className="w-20 h-1.5 bg-line rounded overflow-hidden inline-block"><i className="block h-full bg-accent" style={{ width: pct + '%' }} /></span></div>); } }),
    ch.accessor('daysLeft', { header: 'Days', cell: (c) => <span className="text-xs tabular-nums">{c.getValue()}</span> }),
    ch.display({ id: 'status', header: 'Status', cell: (c) => <Pill inv={c.row.original} /> }),
    ch.accessor('spentUsd', { header: 'Spend', cell: (c) => <span className="text-xs tabular-nums text-accent">${c.getValue() ?? 0}</span> }),
  ], []);
  const table = useReactTable({ data: rows, columns, state: { sorting, globalFilter: filter }, onSortingChange: setSorting, onGlobalFilterChange: setFilter, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getFilteredRowModel: getFilteredRowModel() });
  return (
    <Card className="!bg-graphite-800 !border-line !ring-0">
      <div className="flex items-center justify-between mb-3">
        <Title className="!text-zinc-400 !text-sm">{rows.length} accounts</Title>
        <input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} className="bg-graphite-900 border border-line rounded px-3 py-1.5 text-xs outline-none focus:border-accent w-56" />
      </div>
      <table className="w-full text-sm">
        <thead>{table.getHeaderGroups().map((hg) => (
          <tr key={hg.id} className="text-left text-zinc-500 border-b border-line">
            {hg.headers.map((h) => (<th key={h.id} className="py-2 px-2 font-normal text-xs cursor-pointer select-none" onClick={h.column.getToggleSortingHandler()}>{flexRender(h.column.columnDef.header, h.getContext())}{{ asc: ' ↑', desc: ' ↓' }[h.column.getIsSorted() as string] ?? ''}</th>))}
          </tr>))}
        </thead>
        <tbody>{table.getRowModel().rows.map((r) => (
          <tr key={r.id} className="border-b border-line/50 hover:bg-graphite-700/40 cursor-pointer" onClick={() => onOpen(r.original)}>
            {r.getVisibleCells().map((cell) => <td key={cell.id} className="py-2.5 px-2 align-top">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}
          </tr>))}
        </tbody>
      </table>
    </Card>
  );
}

// ─────────────────────────────────────────── command palette (Linear pattern)
type Cmd = { id: string; label: string; hint?: string; kind: string; run: () => void };
function CommandPalette({ open, onClose, commands }: { open: boolean; onClose: () => void; commands: Cmd[] }) {
  const [q, setQ] = useState(''); const [sel, setSel] = useState(0);
  useEffect(() => { if (open) { setQ(''); setSel(0); } }, [open]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? commands.filter((c) => (c.label + ' ' + (c.hint || '')).toLowerCase().includes(s)) : commands;
    return list.slice(0, 9);
  }, [q, commands]);
  useEffect(() => { setSel(0); }, [q]);
  if (!open) return null;
  const pick = (c?: Cmd) => { if (c) { c.run(); onClose(); } };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-xl bg-graphite-800 border border-line rounded-xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <input autoFocus value={q} placeholder="Search accounts, jump to a section, run an action…"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(i + 1, filtered.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); pick(filtered[sel]); }
            else if (e.key === 'Escape') onClose();
          }}
          className="w-full bg-transparent px-4 py-3.5 text-sm outline-none border-b border-line placeholder:text-zinc-600" />
        <div className="max-h-80 overflow-y-auto py-1">
          {filtered.length ? filtered.map((c, i) => (
            <div key={c.id} onMouseEnter={() => setSel(i)} onClick={() => pick(c)}
              className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer ${i === sel ? 'bg-graphite-700' : ''}`}>
              <span className="text-[10px] uppercase tracking-wider text-zinc-600 w-14">{c.kind}</span>
              <span className="text-sm text-ink flex-1 truncate">{c.label}</span>
              {c.hint && <span className="text-xs text-zinc-500 truncate">{c.hint}</span>}
            </div>
          )) : <div className="px-4 py-6 text-center text-sm text-zinc-600">No matches</div>}
        </div>
        <div className="px-4 py-2 border-t border-line text-[11px] text-zinc-600 flex gap-4"><span>↑↓ navigate</span><span>↵ select</span><span>esc close</span></div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────── console shell (Stripe-style sidebar + sections)
function Console() {
  const [rows, setRows] = useState<Invitee[]>([]); const [totals, setTotals] = useState<any>({}); const [act, setAct] = useState<any>(null);
  const [settings, setSettings] = useState<any>({}); const [section, setSection] = useState<Section>('home'); const [open, setOpen] = useState<Invitee | null>(null);
  const [auditRows, setAuditRows] = useState<any[]>([]);
  const [palette, setPalette] = useState(false);
  const [facet, setFacet] = useState('all');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); }
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, []);
  const load = async () => {
    const [inv, a, s, au] = await Promise.all([api.invitees(), api.activity(), api.settings(), api.audit()]);
    setRows(inv.invitees); setTotals(inv.totals); setAct(a); setSettings(s); setAuditRows(au);
    if (open) setOpen(inv.invitees.find((x) => x.id === open.id) || null);
    setLoading(false);
  };
  const facetRows = useMemo(() => {
    if (facet === 'all') return rows;
    if (facet === 'pending') return rows.filter((r) => r.pending);
    if (facet === 'active') return rows.filter((r) => r.gateOpen);
    if (facet === 'teams') return rows.filter((r) => r.isOrg);
    return rows.filter((r) => (r.plan || 'trial') === facet);
  }, [rows, facet]);
  useEffect(() => { load(); }, []);

  const kpi = useMemo(() => ({
    total: rows.length, active: rows.filter((r) => r.gateOpen).length,
    pending: rows.filter((r) => r.pending).length, teams: rows.filter((r) => r.isOrg).length,
  }), [rows]);
  const topSpenders = useMemo(() => [...rows].filter((r) => (r.spentUsd || 0) > 0).sort((a, b) => (b.spentUsd || 0) - (a.spentUsd || 0)).slice(0, 6), [rows]);
  const chartData = (act?.days || []).map((d: any) => ({ day: d.day, Makes: d.makes }));

  const NAV: [Section, string, string][] = [
    ['home', 'Home', '◵'], ['accounts', 'Accounts', '⌘'], ['orgs', 'Organizations', '⬡'],
    ['approvals', `Approvals${kpi.pending ? ` (${kpi.pending})` : ''}`, '⏻'], ['activity', 'Activity', '≋'], ['audit', 'Audit', '⎙'], ['expenses', 'Expenses', '﷼'], ['settings', 'Settings', '⚙'],
  ];

  const commands = useMemo<Cmd[]>(() => [
    ...NAV.map(([id, label]) => ({ id: 'go-' + id, label: 'Go to ' + label.replace(/ \(\d+\)$/, ''), kind: 'Go', run: () => setSection(id) })),
    { id: 'toggle-signup', label: settings.clerkSignupApproval ? 'Sign-ups → Auto-fund' : 'Sign-ups → Require approval', kind: 'Action', run: async () => { await api.setSetting(!settings.clerkSignupApproval); load(); } },
    ...rows.map((r) => ({ id: 'acc-' + r.id, label: r.name, hint: r.email, kind: r.isOrg ? 'Team' : 'Account', run: () => setOpen(r) })),
  ], [rows, settings]);

  return (
    <div className="min-h-screen flex">
      {/* sidebar */}
      <aside className="w-56 shrink-0 border-r border-line p-4 sticky top-0 h-screen">
        <div className="font-semibold tracking-wide mb-4 px-2">HJEN · <span className="text-accent">Console</span></div>
        <button onClick={() => setPalette(true)} className="w-full flex items-center justify-between px-3 py-2 mb-3 rounded-md bg-graphite-900 border border-line text-xs text-zinc-500 hover:border-accent">
          <span>Search…</span><kbd className="text-[10px] bg-graphite-700 rounded px-1.5 py-0.5">⌘K</kbd>
        </button>
        <nav className="space-y-0.5">
          {NAV.map(([id, label, icon]) => (
            <button key={id} onClick={() => setSection(id)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center gap-3 ${section === id ? 'bg-graphite-700 text-ink' : 'text-zinc-400 hover:bg-graphite-800'}`}>
              <span className="text-zinc-500 w-4">{icon}</span>{label}
            </button>
          ))}
        </nav>
        <button className="absolute bottom-4 left-4 text-xs text-zinc-600" onClick={() => { clearToken(); location.reload(); }}>Lock 🔒</button>
      </aside>

      {/* main */}
      {loading && <div className="fixed top-0 left-0 right-0 h-0.5 bg-accent/80 animate-pulse z-30" />}
      <main className="flex-1 min-w-0 p-8 max-w-[1100px]">
        {section === 'home' && <>
          <h1 className="text-xl font-semibold mb-1">Overview</h1>
          <p className="text-sm text-zinc-500 mb-6">The pulse of HJEN — accounts, usage, spend.</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {[['Accounts', kpi.total], ['Active', kpi.active], ['Pending', kpi.pending], ['Spend', '$' + (totals.totalSpentUsd ?? 0)]].map(([l, v]) => (
              <Card key={l as string} className="!bg-graphite-800 !border-line !ring-0"><Text className="!text-zinc-500">{l}</Text><Metric className="!text-ink">{v}</Metric></Card>
            ))}
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            <Card className="!bg-graphite-800 !border-line !ring-0 md:col-span-2">
              <Title className="!text-zinc-400 !text-sm">Activity — 14 days · {act?.totalMakes} makes · ${act?.totalSpend}</Title>
              {chartData.length > 0 && <Suspense fallback={<div className="h-44 mt-3" />}><Chart data={chartData} /></Suspense>}
            </Card>
            <Card className="!bg-graphite-800 !border-line !ring-0">
              <Title className="!text-zinc-400 !text-sm mb-3">Top by spend</Title>
              {topSpenders.length ? topSpenders.map((r) => (
                <div key={r.id} className="flex items-center justify-between py-1.5 text-sm cursor-pointer hover:text-accent" onClick={() => setOpen(r)}>
                  <span className="truncate">{r.name}</span><span className="text-accent tabular-nums">${r.spentUsd}</span>
                </div>)) : <div className="text-xs text-zinc-500">No spend yet</div>}
            </Card>
          </div>
        </>}

        {section === 'accounts' && <><h1 className="text-xl font-semibold mb-4">Accounts</h1>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {[['all', 'All'], ['active', 'Active'], ['pending', 'Pending'], ['teams', 'Teams'], ['|', ''], ['trial', 'Trial'], ['pro', 'Pro'], ['team', 'Team'], ['enterprise', 'Enterprise']].map(([id, label]) =>
              id === '|' ? <span key="d" className="w-px bg-line mx-1" /> :
              <button key={id} onClick={() => setFacet(id)}
                className={`text-xs px-2.5 py-1 rounded-full border ${facet === id ? 'border-accent text-accent bg-accent/10' : 'border-line text-zinc-400 hover:border-zinc-600'}`}>{label}</button>)}
          </div>
          <AccountsTable rows={facetRows} onOpen={setOpen} /></>}
        {section === 'orgs' && <><h1 className="text-xl font-semibold mb-6">Organizations</h1><AccountsTable rows={rows.filter((r) => r.isOrg)} onOpen={setOpen} /></>}
        {section === 'approvals' && <><h1 className="text-xl font-semibold mb-1">Approvals</h1><p className="text-sm text-zinc-500 mb-6">New sign-ups awaiting your approval.</p>
          {rows.filter((r) => r.pending).length ? <AccountsTable rows={rows.filter((r) => r.pending)} onOpen={setOpen} />
            : <Card className="!bg-graphite-800 !border-line !ring-0"><div className="text-sm text-zinc-500 py-6 text-center">No pending requests.</div></Card>}</>}

        {section === 'activity' && <><h1 className="text-xl font-semibold mb-6">Activity</h1>
          <div className="grid md:grid-cols-3 gap-4">
            <Card className="!bg-graphite-800 !border-line !ring-0 md:col-span-2">
              <Title className="!text-zinc-400 !text-sm">14 days · {act?.totalMakes} makes · ${act?.totalSpend}</Title>
              {chartData.length > 0 && <Suspense fallback={<div className="h-44 mt-3" />}><Chart data={chartData} /></Suspense>}
            </Card>
            <Card className="!bg-graphite-800 !border-line !ring-0">
              <Title className="!text-zinc-400 !text-sm mb-3">By model</Title>
              {Object.entries(act?.byModel || {}).sort((a: any, b: any) => b[1] - a[1]).map(([m, n]: any) => (
                <div key={m} className="flex justify-between text-sm py-1"><span className="text-zinc-300">{m}</span><b className="text-accent">{n}</b></div>))}
            </Card>
          </div>
          <Card className="!bg-graphite-800 !border-line !ring-0 mt-4">
            <Title className="!text-zinc-400 !text-sm mb-3">Recent</Title>
            {(act?.recent || []).map((e: any, i: number) => {
              const h = Math.floor((Date.now() - e.ts) / 3.6e6); const t = h < 1 ? 'now' : h < 24 ? h + 'h' : Math.floor(h / 24) + 'd';
              return (<div key={i} className="flex gap-3 text-xs py-1 text-zinc-500"><span className="w-8">{t}</span><span className="flex-1 text-ink">{e.email}</span><span>{e.kind}{e.model ? ' · ' + e.model : ''}</span>{e.usd ? <span className="text-accent">${e.usd}</span> : null}</div>);
            })}
          </Card></>}

        {section === 'audit' && <><h1 className="text-xl font-semibold mb-1">Audit</h1><p className="text-sm text-zinc-500 mb-6">Every owner action — who, when, what.</p>
          <Card className="!bg-graphite-800 !border-line !ring-0">
            {auditRows.length ? auditRows.map((e: any, i: number) => {
              const d = new Date(e.ts); const when = `${d.toISOString().slice(5, 10)} ${d.toISOString().slice(11, 16)}`;
              return (<div key={i} className="flex items-center gap-3 text-xs py-1.5 border-b border-line/40">
                <span className="text-zinc-600 w-20 tabular-nums">{when}</span>
                <span className="text-accent w-40">{e.action}</span>
                <span className="text-ink flex-1 truncate">{e.targetName || ''}</span>
                <span className="text-zinc-600">{e.actor || 'owner'}</span>
              </div>);
            }) : <div className="text-sm text-zinc-500 py-6 text-center">No actions logged yet.</div>}
          </Card></>}

        {section === 'expenses' && <QoyodExpenses />}

        {section === 'settings' && <><h1 className="text-xl font-semibold mb-1">Settings</h1><p className="text-sm text-zinc-500 mb-6">Governance switches.</p>
          <Card className="!bg-graphite-800 !border-line !ring-0 max-w-lg">
            <div className="flex items-center justify-between">
              <div><div className="text-sm font-medium">New Clerk sign-ups</div><div className="text-xs text-zinc-500 mt-0.5">{settings.clerkSignupApproval ? 'Require your approval before funding' : 'Auto-fund on sign-up'}</div></div>
              <button className="text-xs border border-line rounded-md px-3 py-1.5 hover:border-accent" onClick={async () => { await api.setSetting(!settings.clerkSignupApproval); load(); }}>
                {settings.clerkSignupApproval ? '🔒 Require approval' : '⚡ Auto-fund'}
              </button>
            </div>
          </Card></>}
      </main>

      {open && <Drawer inv={open} onClose={() => setOpen(null)} refresh={load} />}
      <CommandPalette open={palette} onClose={() => setPalette(false)} commands={commands} />
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(!!getToken()); const [checked, setChecked] = useState(!getToken());
  // Never strand the user on the boot screen: a failed/hung verify falls back to
  // the Login gate instead of an eternal dark "…" (reads as a black screen).
  useEffect(() => {
    if (!getToken() || checked) return;
    const t = setTimeout(() => setChecked(true), 8000);
    api.verify(getToken())
      .then((ok) => { setAuthed(ok); setChecked(true); })
      .catch(() => { setAuthed(false); setChecked(true); })
      .finally(() => clearTimeout(t));
  }, [checked]);
  if (!checked) return <div className="min-h-screen flex items-center justify-center text-zinc-500">Connecting to the control plane…</div>;
  return authed ? <Console /> : <Login onOk={() => setAuthed(true)} />;
}
