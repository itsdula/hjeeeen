// Pre-production suite — shared shell, project gate, stage persistence and
// Claude access for the five standalone tools (Brief Mind / Treatment /
// References / Story / Pitch). Every tool is a full-bleed Studio view that
// writes into the SAME 8-stage project contract the PPM workspace owns.
//
// House laws enforced here so the views can't drift:
//  - MADE not Generate — user-facing verbs are Make / Take / Refine.
//  - The contract is the source of truth — persistence goes through
//    readStageData/writeStageData, signing through the store's sign actions.
//  - Colour lives on substrates (--pp-accent); ink stays Whiteout/Midnight.

import { useCallback, useEffect, useRef, useState } from 'react';
import '../../styles/preprod.css';
import { useStore } from '../../store';
import type { ProjectMeta, StageNumber } from '../../types/hjen-bridge';
import { extractJson } from '../../lib/storyboardLlm';
import { llmForTask, type TaskId } from '../../lib/models/registry';
import { SignButton } from '../project/primitives/SignButton';
import { inkOf } from '../ProductHub';
import { CreativeGraphMap } from '../creativemind/CreativeGraphMap';

const PREPROD_PROJECT_KEY = 'hjen_preprod_project';

// ─── project selection (shared across the five tools — they are one line) ──

export function usePreprodProject(): {
  projects: ProjectMeta[];
  project: ProjectMeta | null;
  pick: (id: string) => Promise<void>;
  clear: () => void;
} {
  const projects = useStore(s => s.projects);
  const activeProjectId = useStore(s => s.activeProjectId);
  const projectState = useStore(s => s.projectState);
  const loadProjects = useStore(s => s.loadProjects);
  const selectProject = useStore(s => s.selectProject);

  // Restore once: last preprod project, else the app's active project.
  useEffect(() => {
    if (projects.length === 0) void loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (activeProjectId && projectState) return; // already loaded
    const saved = (() => { try { return localStorage.getItem(PREPROD_PROJECT_KEY); } catch { return null; } })();
    const id = activeProjectId ?? saved;
    if (id && projects.some(p => p.id === id)) void pickInner(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects.length]);

  const pickInner = async (id: string) => {
    selectProject(id);
    try { localStorage.setItem(PREPROD_PROJECT_KEY, id); } catch { /* ignore */ }
    // Load the pipeline state so SignButton / ledger work from these views
    // (openProjectWorkspace would also switch views — we only want the state).
    const state = await window.hjen.readProjectState({ id });
    if (state && useStore.getState().activeProjectId === id) {
      useStore.setState({ projectState: state });
    }
  };

  const pick = useCallback(pickInner, [selectProject]);
  const clear = useCallback(() => {
    selectProject(null);
    useStore.setState({ projectState: null });
  }, [selectProject]);

  const project = projects.find(p => p.id === activeProjectId) ?? null;
  return { projects, project, pick, clear };
}

// ─── stage persistence (BriefComposer pattern: debounce ~400ms) ────────────

export function useStageData<T extends object>(stage: StageNumber, empty: T): {
  data: T;
  loaded: boolean;
  update: (patch: Partial<T>) => void;
  replace: (next: T) => void;
  /** Persist immediately (e.g. before sign / handoff), with optional md companion. */
  saveNow: (markdown?: string) => Promise<void>;
} {
  const projectId = useStore(s => s.activeProjectId);
  const [data, setData] = useState<T>(empty);
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<T>(empty);
  latest.current = data;

  useEffect(() => {
    if (!projectId) { setData(empty); setLoaded(false); return; }
    setLoaded(false);
    let live = true;
    window.hjen.readStageData({ id: projectId, stage })
      .then(d => {
        if (!live) return;
        if (d && typeof d === 'object') setData({ ...empty, ...(d as Partial<T>) });
        else setData(empty);
        setLoaded(true);
      })
      .catch(() => { if (live) { setData(empty); setLoaded(true); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, stage]);

  const persist = useCallback((next: T, markdown?: string) => {
    if (!projectId) return Promise.resolve();
    return window.hjen.writeStageData({
      id: projectId, stage,
      data: { ...next, updatedAt: new Date().toISOString() },
      markdown,
    }).then(() => undefined).catch(() => undefined);
  }, [projectId, stage]);

  const schedule = useCallback((next: T) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void persist(next); }, 400);
  }, [persist]);

  const update = useCallback((patch: Partial<T>) => {
    setData(prev => { const next = { ...prev, ...patch }; schedule(next); return next; });
  }, [schedule]);

  const replace = useCallback((next: T) => { setData(next); schedule(next); }, [schedule]);

  const saveNow = useCallback((markdown?: string) => {
    if (timer.current) clearTimeout(timer.current);
    return persist(latest.current, markdown);
  }, [persist]);

  return { data, loaded, update, replace, saveNow };
}

// ─── LLM access (storyboardLlm pattern: single await + defensive parse) ──
// Routed by TASK through the models registry — Settings → Models decides
// which vendor/model actually runs each task. Untasked callers land on
// 'general', whose default is the same Claude model as before, so behavior
// is unchanged until the user says otherwise in the dashboard.

export async function ppClaude<T = any>(args: {
  system: string; prompt: string; maxTokens?: number; imagePaths?: string[]; task?: TaskId;
  // When set, the server injects `system` from its registry (gateway mode);
  // `system` is still passed for the offline/direct path. Recipe stays off the wire.
  promptId?: string; vars?: any;
}): Promise<{ ok: true; json: T; usd?: number } | { ok: false; message: string }> {
  try {
    const res = await llmForTask(args.task ?? 'general', {
      system: args.system, prompt: args.prompt,
      maxTokens: args.maxTokens ?? 8000,
      imagePaths: args.imagePaths,
      promptId: args.promptId, vars: args.vars,
    });
    if (!res?.ok || !res.text) return { ok: false, message: (res as any)?.message || 'The model returned nothing.' };
    const json = extractJson(res.text);
    if (json == null) return { ok: false, message: 'Could not read structured output — try again.' };
    return { ok: true, json: json as T };
  } catch (e: any) {
    return { ok: false, message: String(e?.message || e) };
  }
}

/** Count words for the VO budget — Arabic-aware (splits on whitespace). */
export function voWordCount(s: string): number {
  const t = (s || '').replace(/\([^)]*\)/g, ' ').trim(); // stage directions don't count
  return t ? t.split(/\s+/).filter(Boolean).length : 0;
}

// ─── shell + gate ───────────────────────────────────────────────────────────

export function PreprodShell(props: {
  tool: string;            // tile name (Brief Mind / Treatment / …)
  sub: string;             // one-line English descriptor shown beside the name
  accent: string;          // brand hex — substrate only
  stage?: StageNumber;     // when set, shows the stage pill + Sign button
  signWarnings?: Array<{ body: string; onJump?: () => void }>;
  beforeSign?: () => Promise<void>; // e.g. saveNow(markdown)
  actions?: React.ReactNode;        // right-side extra bar actions
  children: React.ReactNode;
}) {
  const [graphOpen, setGraphOpen] = useState(false);
  const setActiveView = useStore(s => s.setActiveView);
  const projectState = useStore(s => s.projectState);
  const signStage = useStore(s => s.signProjectStage);
  const unsignStage = useStore(s => s.unsignProjectStage);
  const addLedger = useStore(s => s.addLedgerEntry);
  const { projects, project, pick } = usePreprodProject();

  const status = props.stage ? (projectState?.stages?.[props.stage]?.status ?? 'draft') : 'draft';

  const body = !project ? (
    <ProjectGate projects={projects} pick={pick} tool={props.tool} sub={props.sub} />
  ) : props.children;

  // --on-accent must follow the accent's luminance, not the theme default.
  // Light accents (the asset floors' dust #DCC9C1 and canopy #B2D08D) draw
  // white-on-pale and become unreadable otherwise. inkOf() is the same
  // luminance test the Product Hub tiles already ship.
  const onAccent = inkOf(props.accent) === 'dark' ? '#14110D' : 'var(--whiteout)';

  return (
    <div className="pp" style={{ ['--pp-accent' as any]: props.accent, ['--on-accent' as any]: onAccent }}>
      <div className="pp-bar">
        <button className="pp-back" onClick={() => setActiveView('studio')}>‹ Studio</button>
        <div className="pp-bar__title">
          <span className="pp-bar__dot" />
          <h2>{props.tool}</h2>
          <span className="pp-bar__sub">{props.sub}</span>
        </div>
        <div className="pp-bar__spacer" />
        <div className="pp-bar__actions">
          {project && (
            <button className="pp-graphbtn" onClick={() => setGraphOpen(true)} title="Open the shared Project Creative Graph">
              Graph
            </button>
          )}
          {props.actions}
        </div>
        {project && props.stage && (
          <div className="pp-bar__stage">
            <span className="pp-stagepill mono-label">Stage 0{props.stage}</span>
            <SignButton
              status={status as 'draft' | 'signed'}
              warnings={props.signWarnings ?? []}
              label={`Sign stage 0${props.stage}`}
              onSign={async () => {
                if (props.beforeSign) await props.beforeSign();
                await signStage(props.stage!);
                void addLedger({ kind: 'note', body: `${props.tool}: stage 0${props.stage} signed.` });
              }}
              onUnsign={() => unsignStage(props.stage!)}
            />
          </div>
        )}
      </div>
      {body}
      {graphOpen && project && <CreativeGraphMap projectId={project.id} onClose={() => setGraphOpen(false)} />}
    </div>
  );
}

function ProjectGate({ projects, pick, tool, sub }: {
  projects: ProjectMeta[]; pick: (id: string) => Promise<void>; tool: string; sub: string;
}) {
  return (
    <div className="pp-gate">
      <div className="pp-gate__card">
        <div className="mono-label pp-gate__eyebrow">{tool} · {sub}</div>
        <h3 className="pp-gate__h">Pick the project this work belongs to.</h3>
        <p className="pp-gate__p">Everything you make here is written into the project's 8-stage contract — the same ledger the PPM signs.</p>
        <ProjectList projects={projects} onPick={pick} />
      </div>
    </div>
  );
}

function ProjectList({ projects, onPick }: { projects: ProjectMeta[]; onPick: (id: string) => void | Promise<void> }) {
  if (projects.length === 0) return <div className="pp-gate__empty mono-label">No projects yet — create one from Projects.</div>;
  return (
    <div className="pp-gate__list">
      {projects.map(p => (
        <button key={p.id} className="pp-gate__row" onClick={() => void onPick(p.id)}>
          <span className="pp-gate__name">{p.name}</span>
          <span className="pp-gate__meta mono-label">Stage 0{p.currentStage ?? 1}</span>
        </button>
      ))}
    </div>
  );
}

// ─── small shared primitives ───────────────────────────────────────────────

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="pp-field">
      <div className="pp-field__head">
        <label className="pp-field__label mono-label">{label}</label>
        {hint && <span className="pp-field__hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function Busy({ label }: { label: string }) {
  return <div className="pp-busy"><span className="pp-busy__ring" />{label}</div>;
}

export function useToast(): [string | null, (m: string) => void] {
  const [toast, setToast] = useState<string | null>(null);
  const show = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3200);
  }, []);
  return [toast, show];
}
