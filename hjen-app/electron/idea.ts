// IDEA — the desktop door to the canonical Saudi Ad Voice Agent Graph.
//
// This module deliberately does not reproduce the graph in TypeScript. It
// executes `.agents/skills/saudi-ad-voice/scripts/run_voice_graph.mjs` as the
// single source of truth, with its own N0-N8 topology, deterministic audit,
// independent N6S naturalness judge and evidence boundary intact.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('node:path');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('node:fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const childProcess = require('node:child_process');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const crypto = require('node:crypto');

type IdeaDeps = {
  app: any;
  ipcMain: any;
  resolveTool: (id: 'python3') => string | null;
  describeMissing: (id: 'python3') => string;
  providerKey: (provider: string) => string | null;
  gatewaySettings: () => { url: string; token: string } | null;
  taskModelOverride: (task: string) => string | null;
};

type IdeaArgs = {
  text?: string;
  deliverable?: 'idea_narration' | 'dialogue' | 'vo';
  concept_frame?: boolean;
  take_count?: number;
  length_or_duration?: string;
  duration_scope?: 'film_runtime' | 'spoken_copy';
  voice_load?: 'picture_led' | 'balanced' | 'copy_led';
  spoken_word_limit?: number | null;
  brand?: { name?: string; offering?: string };
  speaker?: { origin?: string; age_band?: string; role?: string };
  listener?: { relationship?: string; power_distance?: 'equal' | 'upward' | 'downward' | 'intimate' };
  scene?: { place?: string; operational_state?: string; immediate_pressure?: string; cultural_truth_detail?: string };
  inside_state?: string;
  speech_act?: string;
  narrative_beat?: string;
  requested_locale?: 'saudi-neutral-spoken' | 'najdi-riyadh-light' | 'hijazi-jeddah-light';
  register_target?: 'saudi-neutral-spoken' | 'saudi-institutional-spoken' | 'saudi-family-warm' | 'saudi-youth-banter' | 'saudi-national-elevated';
};

const MAX_STDOUT_BYTES = 5 * 1024 * 1024;
const MAX_STDERR_BYTES = 160 * 1024;
const MAX_RUN_MS = 15 * 60 * 1000;

function graphScript(root: string): string {
  return path.join(root, 'scripts', 'run_voice_graph.mjs');
}

/** Dev reads the live repository skill; packaged builds read extraResources. */
function resolveSkillRoot(app: any): string | null {
  const candidates = [
    process.env.HJEN_SAUDI_VOICE_ROOT,
    app.isPackaged ? path.join(process.resourcesPath, 'skills', 'saudi-ad-voice') : '',
    // dist-electron/ -> app/ -> desktop_app/ -> 02_PRODUCT/ -> repo root
    path.resolve(__dirname, '../../../../.agents/skills/saudi-ad-voice'),
    // npm scripts normally start from desktop_app/app
    path.resolve(process.cwd(), '../../../.agents/skills/saudi-ad-voice'),
    process.env.HJEN_BRAND_ROOT
      ? path.join(process.env.HJEN_BRAND_ROOT, '.agents', 'skills', 'saudi-ad-voice')
      : '',
  ].filter(Boolean) as string[];
  return candidates.find(root => fs.existsSync(graphScript(root))) || null;
}

function graphVersion(root: string | null): string | null {
  if (!root) return null;
  try {
    const capsule = JSON.parse(fs.readFileSync(path.join(root, 'references', 'runtime-rule-capsule.json'), 'utf-8'));
    return typeof capsule?.version === 'string' ? capsule.version : null;
  } catch { return null; }
}

function cleanText(value: unknown, max = 600): string {
  return typeof value === 'string'
    ? value.normalize('NFKC').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max)
    : '';
}

/** Keep only the graph's public structured contract; renderer extras never pass. */
function normalizeBrief(args: IdeaArgs): Record<string, unknown> {
  const text = cleanText(args?.text, 24_000);
  const deliverable = ['idea_narration', 'dialogue', 'vo'].includes(String(args?.deliverable))
    ? args.deliverable : 'idea_narration';
  const durationScope = ['film_runtime', 'spoken_copy'].includes(String(args?.duration_scope))
    ? args.duration_scope : 'film_runtime';
  const voiceLoad = ['picture_led', 'balanced', 'copy_led'].includes(String(args?.voice_load))
    ? args.voice_load : (durationScope === 'film_runtime' ? 'picture_led' : 'copy_led');
  const locale = ['saudi-neutral-spoken', 'najdi-riyadh-light', 'hijazi-jeddah-light'].includes(String(args?.requested_locale))
    ? args.requested_locale : 'saudi-neutral-spoken';
  const register = [
    'saudi-neutral-spoken', 'saudi-institutional-spoken', 'saudi-family-warm',
    'saudi-youth-banter', 'saudi-national-elevated',
  ].includes(String(args?.register_target)) ? args.register_target : 'saudi-neutral-spoken';
  const power = ['equal', 'upward', 'downward', 'intimate'].includes(String(args?.listener?.power_distance))
    ? args.listener?.power_distance : 'equal';
  const requestedLimit = Number(args?.spoken_word_limit || 0);
  const parsedTakeCount = Number(args?.take_count);
  const takeCount = Number.isFinite(parsedTakeCount)
    ? Math.min(3, Math.max(1, Math.round(parsedTakeCount)))
    : 3;

  return {
    text,
    deliverable,
    concept_frame: args?.concept_frame === true || deliverable === 'idea_narration',
    take_count: takeCount,
    length_or_duration: cleanText(args?.length_or_duration, 40) || '60s',
    duration_scope: durationScope,
    voice_load: voiceLoad,
    ...(Number.isFinite(requestedLimit) && requestedLimit > 0 && requestedLimit <= 500
      ? { spoken_word_limit: Math.round(requestedLimit) } : {}),
    brand: {
      name: cleanText(args?.brand?.name, 160),
      offering: cleanText(args?.brand?.offering, 240),
    },
    speaker: {
      origin: cleanText(args?.speaker?.origin, 160),
      age_band: cleanText(args?.speaker?.age_band, 80),
      role: cleanText(args?.speaker?.role, 180),
    },
    listener: {
      relationship: cleanText(args?.listener?.relationship, 180),
      power_distance: power,
    },
    scene: {
      place: cleanText(args?.scene?.place, 240),
      operational_state: cleanText(args?.scene?.operational_state, 180),
      immediate_pressure: cleanText(args?.scene?.immediate_pressure, 300),
      cultural_truth_detail: cleanText(args?.scene?.cultural_truth_detail, 300),
    },
    inside_state: cleanText(args?.inside_state, 300),
    speech_act: cleanText(args?.speech_act, 180),
    narrative_beat: cleanText(args?.narrative_beat, 400),
    requested_locale: locale,
    register_target: register,
  };
}

function safeGraphTrace(tracePath: string): Record<string, unknown> | null {
  try {
    const raw = JSON.parse(fs.readFileSync(tracePath, 'utf-8'));
    const nodes: Record<string, unknown> = {};
    for (const [id, value] of Object.entries(raw?.nodes || {})) {
      const v: any = value;
      nodes[id] = {
        status: cleanText(v?.status, 80),
        decision: cleanText(v?.decision, 120),
        fatal_codes: Array.isArray(v?.fatal_codes)
          ? v.fatal_codes.map((x: unknown) => cleanText(x, 100)).filter(Boolean).slice(0, 20)
          : [],
      };
    }
    return { final_status: cleanText(raw?.final_status, 80), nodes };
  } catch { return null; }
}

function status(deps: IdeaDeps) {
  const root = resolveSkillRoot(deps.app);
  const python = deps.resolveTool('python3');
  const localKey = deps.providerKey('openai');
  const gateway = deps.gatewaySettings();
  const override = deps.taskModelOverride('arabic-copy');
  const model = override && /^(gpt-|o\d)/i.test(override) ? override : 'gpt-5.1';
  const auth = localKey ? 'local' : gateway ? 'gateway' : 'none';
  const ok = Boolean(root && python && auth !== 'none');
  const message = !root
    ? 'Saudi Ad Voice Graph is missing from this HJEN build.'
    : !python
      ? deps.describeMissing('python3')
      : auth === 'none'
        ? 'Connect your HJEN account or add an OpenAI API key in Settings.'
        : '';
  return { ok, graphFound: !!root, pythonFound: !!python, auth, model, version: graphVersion(root), message };
}

function spawnGraph(deps: IdeaDeps, args: IdeaArgs): Promise<any> {
  const ready = status(deps);
  if (!ready.ok) return Promise.resolve({ ok: false, reason: 'not_ready', message: ready.message, status: ready });

  const brief = normalizeBrief(args);
  if (String(brief.text || '').length < 8) {
    return Promise.resolve({ ok: false, reason: 'empty_brief', message: 'Write the brief first.' });
  }

  const root = resolveSkillRoot(deps.app)!;
  const python = deps.resolveTool('python3')!;
  const localKey = deps.providerKey('openai');
  const gateway = deps.gatewaySettings();
  const override = deps.taskModelOverride('arabic-copy');
  const model = override && /^(gpt-|o\d)/i.test(override) ? override : 'gpt-5.1';
  const runDir = path.join(deps.app.getPath('userData'), 'idea', 'traces');
  fs.mkdirSync(runDir, { recursive: true });
  const tracePath = path.join(runDir, `${Date.now()}-${crypto.randomUUID()}.json`);

  return new Promise(resolve => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    const env: Record<string, string> = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PYTHON: python,
      SAUDI_VOICE_MODEL: model,
      // The gateway branch still carries a placeholder upstream credential;
      // the real OpenAI key never enters the desktop process.
      OPENAI_API_KEY: localKey || 'x',
    } as Record<string, string>;
    if (gateway && !localKey) {
      env.HJEN_VOICE_GATEWAY_URL = gateway.url;
      env.HJEN_VOICE_GATEWAY_TOKEN = gateway.token;
    }

    const child = childProcess.spawn(
      process.execPath,
      [graphScript(root), '--brief-json', '-', '--output', tracePath, '--no-memory'],
      { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] },
    );

    const finish = (payload: any) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(payload);
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= MAX_STDOUT_BYTES) stdout += chunk.toString('utf-8');
      else child.kill('SIGTERM');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= MAX_STDERR_BYTES) stderr += chunk.toString('utf-8');
    });
    child.on('error', (error: Error) => finish({
      ok: false, reason: 'spawn_failed', message: String(error?.message || error), ms: Date.now() - started,
    }));
    child.on('close', (code: number | null) => {
      if (settled) return;
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        finish({ ok: false, reason: 'output_too_large', message: 'The graph returned an unexpectedly large result.', ms: Date.now() - started });
        return;
      }
      let result: any = null;
      try { result = JSON.parse(stdout.trim()); } catch { /* handled below */ }
      if (!result) {
        finish({
          ok: false,
          reason: 'invalid_graph_output',
          message: (stderr.trim() || `Saudi Ad Voice Graph exited with code ${code ?? 'unknown'}.`).slice(0, 700),
          ms: Date.now() - started,
        });
        return;
      }
      finish({
        ok: true,
        result,
        graph: safeGraphTrace(tracePath),
        model,
        ms: Date.now() - started,
      });
    });

    timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish({ ok: false, reason: 'timeout', message: 'IDEA reached the 15-minute graph limit. The copy was not released.', ms: Date.now() - started });
    }, MAX_RUN_MS);

    child.stdin.end(JSON.stringify(brief));
  });
}

export function registerIdea(deps: IdeaDeps): void {
  deps.ipcMain.handle('hjen:idea-status', () => status(deps));
  deps.ipcMain.handle('hjen:idea-run', (_event: unknown, args: IdeaArgs) => spawnGraph(deps, args || {}));
}

export { normalizeBrief, resolveSkillRoot };
