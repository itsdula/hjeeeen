"use strict";
// Use plain CommonJS require to avoid esModuleInterop edge cases.
// Electron v33 exports `app`, `BrowserWindow`, `ipcMain` directly on the module.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const electron = require('electron');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('node:path');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain, dialog, protocol, net } = electron;
console.log('[hjen-main] Electron loaded. Type of app:', typeof app, 'keys:', Object.keys(electron).slice(0, 8));
// Seedance 2 returns 4K clips encoded in HEVC/H.265. Chromium has no built-in
// HEVC decoder, so the in-app <video> preview renders a black frame stuck at
// 0:00 even though the file is valid (macOS plays it via VideoToolbox). This
// switch routes HEVC decode through the OS platform decoder so previews play.
// Must be set before app.whenReady().
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport');
// Register a privileged custom scheme so the renderer can load local files
// without base64 IPC round-trips. Must be done BEFORE app.whenReady().
protocol.registerSchemesAsPrivileged([
    { scheme: 'hjen-file', privileges: { secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
]);
let mainWindow = null;
const createWindow = () => {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1200,
        minHeight: 760,
        titleBarStyle: 'hiddenInset',
        backgroundColor: '#000000',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });
    if (process.env.VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
    else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }
};
app.whenReady().then(() => {
    // Serve any path under the user's home with the hjen-file:// scheme.
    // The renderer just does <img src="hjen-file:///absolute/path/to/image.jpg" />
    protocol.handle('hjen-file', (request) => {
        // URL form: hjen-file:///absolute/path  →  url.pathname is "/absolute/path"
        const u = new URL(request.url);
        const fp = decodeURIComponent(u.pathname);
        return net.fetch(`file://${fp}`);
    });
    createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin')
    app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0)
    createWindow(); });
// ============ API keys ============
ipcMain.handle('hjen:get-api-key', () => {
    if (process.env.OPENAI_API_KEY)
        return process.env.OPENAI_API_KEY;
    const keyFile = path.join(app.getPath('userData'), 'openai_key.txt');
    if (fs.existsSync(keyFile))
        return fs.readFileSync(keyFile, 'utf-8').trim() || null;
    return null;
});
ipcMain.handle('hjen:set-api-key', (_e, key) => {
    fs.writeFileSync(path.join(app.getPath('userData'), 'openai_key.txt'), key, { mode: 0o600 });
    return true;
});
ipcMain.handle('hjen:get-google-key', () => {
    if (process.env.GOOGLE_API_KEY)
        return process.env.GOOGLE_API_KEY;
    const keyFile = path.join(app.getPath('userData'), 'google_key.txt');
    if (fs.existsSync(keyFile))
        return fs.readFileSync(keyFile, 'utf-8').trim() || null;
    return null;
});
ipcMain.handle('hjen:set-google-key', (_e, key) => {
    fs.writeFileSync(path.join(app.getPath('userData'), 'google_key.txt'), key, { mode: 0o600 });
    return true;
});
ipcMain.handle('hjen:get-anthropic-key', () => {
    if (process.env.ANTHROPIC_API_KEY)
        return process.env.ANTHROPIC_API_KEY;
    const keyFile = path.join(app.getPath('userData'), 'anthropic_key.txt');
    if (fs.existsSync(keyFile))
        return fs.readFileSync(keyFile, 'utf-8').trim() || null;
    return null;
});
ipcMain.handle('hjen:set-anthropic-key', (_e, key) => {
    fs.writeFileSync(path.join(app.getPath('userData'), 'anthropic_key.txt'), key, { mode: 0o600 });
    return true;
});
// ============ Prompt enhancement (Claude) ============
//
// Reads attached reference images from disk, sends them + the raw prompt to
// Claude (vision), and returns a refined scene-direction prompt. Claude is
// instructed NOT to describe camera/lens/film/lighting/angle — those come
// from the app's selection chips and would conflict if duplicated in prose.
//
// BYO key for now. The endpoint is hardcoded to Anthropic direct; swap to
// an HJEN-hosted proxy later by changing ANTHROPIC_ENDPOINT below.
const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ENHANCE_MODEL = 'claude-sonnet-4-6';
// Sonnet 4.6 published rates (per million tokens). Update if Anthropic
// changes pricing; verify against your billing.
const CLAUDE_PRICING = {
    inputPerMTok: 3,
    outputPerMTok: 15,
};
/** Format the user's chip selections into a compact brief Claude can read.
 *  The STYLE block is split out and ALWAYS leads — it determines whether
 *  the scene is written in animation language or photoreal language, and
 *  Claude was previously ignoring it. */
function buildSettingsBrief(s) {
    if (!s)
        return '';
    const lines = [];
    // ═══ STYLE REGISTER — leads the brief so Claude reads everything else
    //    through this lens. Animation movies need an explicit, loud signal
    //    or Claude defaults to photoreal Saudi-KV register.
    if (s.stylePreset === 'MOVIE' && s.movie?.title) {
        const isAnimation = s.movie.type === 'Animation';
        const meta = [s.movie.director, s.movie.year].filter(Boolean).join(', ');
        if (isAnimation) {
            lines.push(`*** STYLE REGISTER: ANIMATION ***`);
            lines.push(`Style anchor: ${s.movie.title}${meta ? ` (${meta})` : ''} — animation language, NOT photoreal.`);
            lines.push(`The downstream image model will render this in the visual vocabulary of ${s.movie.title}. Write your prose so it can be re-illustrated in that animation register — no photoreal skin / pore / texture language.`);
        }
        else {
            lines.push(`STYLE REGISTER: LIVE-ACTION CINEMA`);
            lines.push(`Style anchor: ${s.movie.title}${meta ? ` (${meta})` : ''} — match this film's visual register (era, palette, character behaviour) without naming it.`);
        }
    }
    else if (s.stylePreset === 'PHOTOGRAPHER' && s.photographer?.name) {
        lines.push(`STYLE REGISTER: PHOTOGRAPHER`);
        const meta = [s.photographer.genre, s.photographer.notes].filter(Boolean).join(' — ');
        lines.push(`Style anchor: ${s.photographer.name}${meta ? ` (${meta})` : ''} — match this photographer's signature register (genre, posture, light philosophy) without naming them.`);
    }
    else {
        lines.push(`STYLE REGISTER: DOCUMENTARY-PHOTOREAL (no style chip set)`);
    }
    // ═══ FRAMING + CAMERA + LIGHTING brief
    if (s.angle?.name)
        lines.push(`Perspective: ${s.angle.name}${s.angle.description ? ` — ${s.angle.description}` : ''}`);
    if (s.camera?.name)
        lines.push(`Camera: ${s.camera.name}${s.camera.prompt ? ` (${s.camera.prompt})` : ''}`);
    if (s.lens?.name)
        lines.push(`Lens: ${s.lens.name}${s.lens.note ? ` — ${s.lens.note}` : ''}`);
    if (typeof s.focal_mm === 'number')
        lines.push(`Focal length: ${s.focal_mm}mm`);
    if (typeof s.aperture_f === 'number')
        lines.push(`Aperture: f/${s.aperture_f}`);
    if (s.stock?.name)
        lines.push(`Film stock: ${s.stock.name}${s.stock.usage ? ` — ${s.stock.usage}` : ''}`);
    if (s.lighting?.name)
        lines.push(`Lighting: ${s.lighting.name}${s.lighting.description ? ` — ${s.lighting.description}` : ''}`);
    if (s.movement?.name)
        lines.push(`Camera movement: ${s.movement.name}${s.movement.description ? ` — ${s.movement.description}` : ''}`);
    if (s.aspect)
        lines.push(`Aspect ratio: ${s.aspect}`);
    if (s.atmosphere?.trim())
        lines.push(`Atmosphere note: ${s.atmosphere.trim()}`);
    return lines.join('\n');
}
function imageExtToMime(p) {
    const e = path.extname(p).toLowerCase().slice(1);
    if (e === 'jpg' || e === 'jpeg')
        return 'image/jpeg';
    if (e === 'webp')
        return 'image/webp';
    if (e === 'gif')
        return 'image/gif';
    return 'image/png';
}
const ENHANCEMENT_SYSTEM_PROMPT = `You are a TIGHT stills-photography prompt refiner for HJEN, a Saudi commercial KV studio.

Your role is a STABILIZER, not a creative writer. You take the user's raw prompt + reference images + chip selections and produce ONE short, dense paragraph that LOCKS IN what already exists. You do NOT invent new content. You do NOT pad.

═══ HARD LENGTH LIMIT ═══
Output: 40–80 words. ONE paragraph. If you write more than 80 words you have failed the task.

═══ RULE #0 — NO HALLUCINATING REFERENCES (TOP RULE) ═══

The user message contains a "WHAT IS ATTACHED" inventory listing exactly which reference categories exist, with counts. This is the exhaustive ground truth. You may ONLY describe things from categories whose count is ≥ 1.

ABSOLUTES:
- The CHARACTER reference is the SUBJECT'S FACE / IDENTITY. It is NOT a wardrobe reference. Even if you can see clothing on the character ref image, you may NOT describe that clothing as "from the reference" or invent specific garments (no "sage-green hooded puffer jacket", no "navy crepe abaya", no garment names + colors).
- If the inventory says "wardrobe: 0", you MUST NOT mention any specific garment, color, fabric, cut. Either silently omit wardrobe entirely OR use the most generic functional phrase ("dressed for the scene") — and only if the user's raw prompt invited it.
- If "prop: 0", do not invent or mention any prop.
- If "location: 0", describe location only in the abstract terms the user wrote — do not invent street names, neighbourhoods, weather details that weren't in the user prompt.
- The phrase "from the X reference" is FORBIDDEN unless X is in the inventory with count ≥ 1.
- Do NOT carry over phrasing from prior generations. Each call starts fresh; the only context is the current inventory + current user prompt + current chip settings. Anything not in those is invented.

When in doubt: omit. A shorter, faithful prose is better than a richer prose with invented detail. Invented detail produces images that contradict the user's actual references.

═══ RULE #1 — STYLE REGISTER IS THE CONTRACT ═══

The user's "Technical settings" block starts with a STYLE REGISTER line. That line dictates the visual language of your prose. It is NOT optional and the user-prompt cannot override it.

• "STYLE REGISTER: ANIMATION" — write the scene as if it will be rendered in that animated film's visual vocabulary. The character is a STYLISED character, not a real person. Describe shape, posture, color blocking, gesture. Do NOT describe pores, freckles, micro-expressions, skin texture, photographic realism, or any photoreal-portraiture language. If the user prompt says "Saudi woman in Paris" and the style is "Avatar: The Last Airbender", you write an Avatar-style stylised Saudi-coded character in Paris — not a real human in Paris.

• "STYLE REGISTER: LIVE-ACTION CINEMA" — cinematic-photographic register matched to that film's era and look.

• "STYLE REGISTER: PHOTOGRAPHER" — that photographer's signature register (genre/light/posture). Don't name them.

• "STYLE REGISTER: DOCUMENTARY-PHOTOREAL" — neutral photoreal default; subtle realism, no stylisation, no genre theatricality.

If you violate the style register you have failed the task, regardless of how good the prose is.

═══ RULE #2 — WHAT THE OUTPUT MUST DO ═══

1. CONFIRM the user's raw prompt — preserve the action, subject count, location intent, and mood the user wrote. Do NOT replace any of it with your own preferences.

2. LOCK IN what's visible in the reference images — for each attached reference, name the specific thing it shows in 2–4 words and bind it to whoever it belongs to:
   - Character ref → "the woman/man shown in the reference" or by provided name
   - Wardrobe ref → "in the [garment-from-ref]"
   - Prop ref → "holding/with the [object-from-ref]"
   - Location ref → "in the [location-from-ref]"
   Do NOT describe what the reference might mean or how it's lit. Just NAME it tightly.

3. RESPECT the chip selections silently — the chips (perspective, lens, focal, aperture, film, lighting, movement, aspect, style, atmosphere) will be appended downstream. Your job is to ensure the prose doesn't contradict them.

═══ RULE #3 — WHAT YOU MUST NOT DO ═══

- Do NOT add new characters, props, garments, or scene elements that aren't in the user prompt or in a reference.
- Do NOT add atmospheric flourishes, mood essays, or texture inventories ("warm golden afternoon light caressing the…", "skin glistening with…", "three plates of foreground/mid/background…"). One mood word per sentence max.
- Do NOT describe age, ethnicity, skin texture, micro-expressions, or hairstyle unless the user wrote them OR you can SEE them in a reference image. If style register is ANIMATION, skip skin / pore / texture descriptors entirely.
- Do NOT name camera, lens, focal length, aperture, film, lighting equipment/kelvin, photographer, director, movie, genre labels (cinematic / editorial / 35mm / bokeh), angle/movement terms, color grade, aspect, or render quality words. These come from the chips downstream.
- Do NOT add Saudi/Gulf clichés (thobe, abaya, dallah, shemagh, falcon, desert, camel) unless they appear in the user prompt or references.
- Do NOT explain what the image will look like ("a striking portrait that…"). Just describe the scene.

═══ RULE #4 — CHIP COMPATIBILITY (silent enforcement) ═══

Drop any element from the user's raw prompt that contradicts the selected chips. The chip ALWAYS wins. Examples:
- Perspective extreme close-up / close-up: drop wide environment, crowds, signage, buildings. Keep face / hands / single object / texture only.
- Perspective wide / establishing: keep environment, allow multiple plates.
- Wide aperture (≤ f/2.8): describe subject only; background goes unnamed.
- 21:9 aspect: composition spreads horizontally; no tall vertical sprawl.
- 9:16 aspect: one subject, vertical-friendly framing.

═══ OUTPUT FORMAT ═══

ONE paragraph. 40–80 words. Plain prose. Present tense. Third person. No headings, bullets, labels, or quotes. Do not start with "A photo of" or "An image of". Address named characters by name. Bind wardrobe/props to their parent character explicitly.`;
function enhancementsLogPath() {
    // Sits at the projects root so the user can find / archive it like
    // any other generated artifact.
    return path.join(projectsRootPath(), '_enhancements.jsonl');
}
// ============ Pending generation jobs (crash recovery) ============
//
// Layout:
//   {projectsRoot}/_pending/{jobId}.json
//
// Each file is the full serializable job context the renderer needs to
// either retry the generation or surface a clear "interrupted" notice
// on next launch. We write the file BEFORE issuing the API call and
// delete it on completion (success or failure). Files that survive an
// app restart are by definition orphans = app died mid-generation.
function pendingJobsDir() {
    return path.join(projectsRootPath(), '_pending');
}
ipcMain.handle('hjen:save-pending-job', (_e, args) => {
    if (!args.id || !args.payload)
        return { ok: false, reason: 'invalid' };
    fs.mkdirSync(pendingJobsDir(), { recursive: true });
    const f = path.join(pendingJobsDir(), `${args.id}.json`);
    try {
        fs.writeFileSync(f, JSON.stringify(args.payload, null, 2));
        return { ok: true };
    }
    catch (err) {
        return { ok: false, reason: err?.message || 'write_failed' };
    }
});
ipcMain.handle('hjen:clear-pending-job', (_e, args) => {
    if (!args.id)
        return { ok: false };
    const f = path.join(pendingJobsDir(), `${args.id}.json`);
    try {
        if (fs.existsSync(f))
            fs.unlinkSync(f);
    }
    catch { }
    return { ok: true };
});
ipcMain.handle('hjen:list-pending-jobs', () => {
    const dir = pendingJobsDir();
    if (!fs.existsSync(dir))
        return [];
    try {
        const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
        const out = [];
        for (const f of files) {
            try {
                const raw = fs.readFileSync(path.join(dir, f), 'utf-8');
                out.push(JSON.parse(raw));
            }
            catch { }
        }
        return out.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
    }
    catch {
        return [];
    }
});
// ============ Failed generation jobs (debug history) ============
//
// Layout:
//   {projectsRoot}/_failed/{jobId}.json
//
// Persisted on every catch in generate() so the user can later inspect
// the exact prompt + references that were sent + the API error message.
// Stays on disk until the user explicitly dismisses the entry from the
// sidebar's Failed group.
function failedJobsDir() {
    return path.join(projectsRootPath(), '_failed');
}
ipcMain.handle('hjen:save-failed-job', (_e, args) => {
    if (!args.id || !args.payload)
        return { ok: false, reason: 'invalid' };
    fs.mkdirSync(failedJobsDir(), { recursive: true });
    const f = path.join(failedJobsDir(), `${args.id}.json`);
    try {
        fs.writeFileSync(f, JSON.stringify(args.payload, null, 2));
        return { ok: true };
    }
    catch (err) {
        return { ok: false, reason: err?.message || 'write_failed' };
    }
});
ipcMain.handle('hjen:list-failed-jobs', () => {
    const dir = failedJobsDir();
    if (!fs.existsSync(dir))
        return [];
    try {
        const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
        const out = [];
        for (const f of files) {
            try {
                const raw = fs.readFileSync(path.join(dir, f), 'utf-8');
                out.push(JSON.parse(raw));
            }
            catch { }
        }
        return out.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
    }
    catch {
        return [];
    }
});
ipcMain.handle('hjen:delete-failed-job', (_e, args) => {
    if (!args.id)
        return { ok: false };
    const f = path.join(failedJobsDir(), `${args.id}.json`);
    try {
        if (fs.existsSync(f))
            fs.unlinkSync(f);
    }
    catch { }
    return { ok: true };
});
function appendEnhancementEvent(ev) {
    try {
        fs.mkdirSync(projectsRootPath(), { recursive: true });
        fs.appendFileSync(enhancementsLogPath(), JSON.stringify(ev) + '\n');
    }
    catch (err) {
        console.warn('[enhance] could not append to log', err);
    }
}
ipcMain.handle('hjen:list-enhancements', () => {
    const p = enhancementsLogPath();
    if (!fs.existsSync(p))
        return [];
    try {
        const lines = fs.readFileSync(p, 'utf-8').split(/\r?\n/).filter(Boolean);
        const out = [];
        for (const line of lines) {
            try {
                out.push(JSON.parse(line));
            }
            catch { }
        }
        return out.sort((a, b) => b.ts - a.ts);
    }
    catch {
        return [];
    }
});
ipcMain.handle('hjen:enhance-prompt', async (_e, args) => {
    // Resolve key from env or saved file
    let apiKey = process.env.ANTHROPIC_API_KEY || null;
    if (!apiKey) {
        const keyFile = path.join(app.getPath('userData'), 'anthropic_key.txt');
        if (fs.existsSync(keyFile))
            apiKey = fs.readFileSync(keyFile, 'utf-8').trim() || null;
    }
    if (!apiKey) {
        return { ok: false, reason: 'no_key', message: 'No Anthropic API key configured. Open Settings and add one.' };
    }
    const raw = (args.rawPrompt || '').trim();
    if (!raw) {
        return { ok: false, reason: 'empty_prompt', message: 'Write a prompt first, then Enhance.' };
    }
    const userBlocks = [];
    userBlocks.push({
        type: 'text',
        text: `User's raw prompt:\n${raw}`,
    });
    // Inject the user's chip selections as a "constraints brief" so Claude
    // can enforce the compatibility rules from the system prompt. The chips
    // themselves get concatenated downstream by promptBuilder.ts — Claude
    // must NOT name them in its output, only respect their semantic limits.
    const settingsBrief = buildSettingsBrief(args.settings);
    if (settingsBrief) {
        userBlocks.push({
            type: 'text',
            text: `Technical settings the user picked (will be appended downstream — your prose must be COMPATIBLE with all of these but must NEVER name them):\n${settingsBrief}`,
        });
    }
    const refs = Array.isArray(args.references) ? args.references : [];
    // Build an explicit inventory of WHAT IS ATTACHED — categorised + counted —
    // so Claude can't hallucinate references from categories that have zero
    // refs. Without this inventory Claude sees clothing on the character
    // photo and invents a fictional "wardrobe reference" to attribute it to.
    const inventory = {
        character: refs.filter(r => r.category === 'character'),
        wardrobe: refs.filter(r => r.category === 'wardrobe'),
        prop: refs.filter(r => r.category === 'prop'),
        location: refs.filter(r => r.category === 'location'),
        general: refs.filter(r => r.category === 'general'),
    };
    const inventoryLines = [
        `WHAT IS ATTACHED (exhaustive — anything else does NOT exist):`,
        `  • characters: ${inventory.character.length}${inventory.character.length ? ' — ' + inventory.character.map(r => `'${r.customName || r.name}'`).join(', ') : ''}`,
        `  • wardrobe:   ${inventory.wardrobe.length}${inventory.wardrobe.length ? ' — ' + inventory.wardrobe.map(r => `'${r.customName || r.name}'`).join(', ') : ''}`,
        `  • props:      ${inventory.prop.length}${inventory.prop.length ? ' — ' + inventory.prop.map(r => `'${r.customName || r.name}'`).join(', ') : ''}`,
        `  • locations:  ${inventory.location.length}${inventory.location.length ? ' — ' + inventory.location.map(r => `'${r.customName || r.name}'`).join(', ') : ''}`,
        `  • general:    ${inventory.general.length}${inventory.general.length ? ' — ' + inventory.general.map(r => `'${r.customName || r.name}'`).join(', ') : ''}`,
        ``,
        `If a category shows 0, you may NOT describe anything from that category. The character reference shows the SUBJECT'S FACE and IDENTITY — it does NOT define wardrobe. Even if you see clothing on the character ref image, you may NOT describe that clothing unless a wardrobe reference is ALSO attached above.`,
    ].join('\n');
    userBlocks.push({ type: 'text', text: inventoryLines });
    if (refs.length > 0) {
        const refLabel = refs.map((r, i) => {
            const n = r.customName?.trim() || r.name;
            const parent = r.parentName ? ` (belongs to ${r.parentName})` : '';
            return `[${i + 1}] ${r.category}: ${n}${parent}`;
        }).join('\n');
        userBlocks.push({
            type: 'text',
            text: `Reference images attached below in order:\n${refLabel}`,
        });
        for (const ref of refs) {
            try {
                if (!fs.existsSync(ref.filePath))
                    continue;
                const buf = fs.readFileSync(ref.filePath);
                // Downscale large references to keep request size + cost manageable.
                // 1024px long-edge is plenty for Claude to read a face / outfit / location.
                let imgBuf = buf;
                let mime = imageExtToMime(ref.filePath);
                try {
                    const native = electron.nativeImage.createFromBuffer(buf);
                    const sz = native.getSize();
                    const longest = Math.max(sz.width, sz.height);
                    if (longest > 1024) {
                        const scale = 1024 / longest;
                        const tw = Math.max(1, Math.round(sz.width * scale));
                        const th = Math.max(1, Math.round(sz.height * scale));
                        imgBuf = native.resize({ width: tw, height: th, quality: 'good' }).toJPEG(82);
                        mime = 'image/jpeg';
                    }
                }
                catch (resizeErr) {
                    // If resize fails, fall through with the original buffer.
                    console.warn('[enhance] resize failed, using original', resizeErr);
                }
                userBlocks.push({
                    type: 'image',
                    source: { type: 'base64', media_type: mime, data: imgBuf.toString('base64') },
                });
            }
            catch (err) {
                console.warn(`[enhance] could not read ref ${ref.filePath}`, err);
            }
        }
    }
    try {
        const res = await fetch(ANTHROPIC_ENDPOINT, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: ENHANCE_MODEL,
                // 220 ≈ ~160 words ceiling. Combined with the system prompt's
                // 40-80 word target, this leaves Claude no room to ramble.
                max_tokens: 220,
                system: ENHANCEMENT_SYSTEM_PROMPT,
                messages: [{ role: 'user', content: userBlocks }],
            }),
        });
        if (!res.ok) {
            const errBody = await res.text();
            return { ok: false, reason: 'api_error', message: `Anthropic ${res.status}: ${errBody.slice(0, 400)}` };
        }
        const data = await res.json();
        const text = Array.isArray(data?.content)
            ? data.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim()
            : '';
        if (!text) {
            return { ok: false, reason: 'empty_response', message: 'Claude returned an empty response.' };
        }
        const inputTokens = data?.usage?.input_tokens ?? 0;
        const outputTokens = data?.usage?.output_tokens ?? 0;
        const usd = (inputTokens / 1_000_000) * CLAUDE_PRICING.inputPerMTok +
            (outputTokens / 1_000_000) * CLAUDE_PRICING.outputPerMTok;
        // Persist for the Usage report. Append-only JSONL so concurrent writes
        // never overwrite each other and the file is grep-friendly on disk.
        appendEnhancementEvent({
            ts: Date.now(),
            model: ENHANCE_MODEL,
            inputTokens,
            outputTokens,
            usd,
            referencesCount: refs.length,
            rawPromptChars: raw.length,
            enhancedPromptChars: text.length,
            rawPromptExcerpt: raw.slice(0, 120),
            enhancedPromptExcerpt: text.slice(0, 120),
            projectId: args.projectId ?? null,
            projectSlug: args.projectSlug ?? null,
            projectName: args.projectName ?? null,
        });
        return {
            ok: true,
            enhancedPrompt: text,
            usage: { inputTokens, outputTokens },
            usd,
            model: ENHANCE_MODEL,
        };
    }
    catch (err) {
        return { ok: false, reason: 'network', message: err?.message || 'Network error contacting Anthropic.' };
    }
});
function projectsConfigPath() {
    return path.join(app.getPath('userData'), 'projects.json');
}
function projectsRootPath() {
    const settingsFile = path.join(app.getPath('userData'), 'settings.json');
    if (fs.existsSync(settingsFile)) {
        try {
            const s = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
            if (s.projectsRoot && typeof s.projectsRoot === 'string')
                return s.projectsRoot;
        }
        catch { }
    }
    return path.join(app.getPath('pictures'), 'HJEN Studio');
}
function readProjects() {
    const f = projectsConfigPath();
    if (!fs.existsSync(f))
        return [];
    try {
        const arr = JSON.parse(fs.readFileSync(f, 'utf-8'));
        return Array.isArray(arr) ? arr : [];
    }
    catch {
        return [];
    }
}
function writeProjects(arr) {
    fs.writeFileSync(projectsConfigPath(), JSON.stringify(arr, null, 2), { mode: 0o644 });
}
function projectFolder(slug) {
    return path.join(projectsRootPath(), slug);
}
function slugify(s) {
    return s
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 60) || 'untitled';
}
ipcMain.handle('hjen:get-projects', () => {
    return { projects: readProjects(), projectsRoot: projectsRootPath() };
});
ipcMain.handle('hjen:create-project', (_e, args) => {
    const arr = readProjects();
    const baseSlug = slugify(args.name);
    let slug = baseSlug;
    let n = 2;
    while (arr.some(p => p.slug === slug)) {
        slug = `${baseSlug}-${n++}`;
    }
    const project = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: args.name.trim() || 'Untitled Project',
        slug,
        created: new Date().toISOString(),
        generationCount: 0,
    };
    arr.unshift(project);
    writeProjects(arr);
    fs.mkdirSync(projectFolder(slug), { recursive: true });
    return project;
});
ipcMain.handle('hjen:delete-project', (_e, args) => {
    const arr = readProjects();
    const target = arr.find(p => p.id === args.id);
    if (!target)
        return { ok: false, reason: 'not_found' };
    const remaining = arr.filter(p => p.id !== args.id);
    writeProjects(remaining);
    if (args.deleteFiles) {
        const dir = projectFolder(target.slug);
        if (fs.existsSync(dir))
            fs.rmSync(dir, { recursive: true, force: true });
    }
    return { ok: true };
});
ipcMain.handle('hjen:rename-project', (_e, args) => {
    const arr = readProjects();
    const target = arr.find(p => p.id === args.id);
    if (!target)
        return null;
    target.name = args.name.trim() || target.name;
    writeProjects(arr);
    return target;
});
ipcMain.handle('hjen:get-projects-root', () => projectsRootPath());
ipcMain.handle('hjen:set-projects-root', (_e, newRoot) => {
    if (!newRoot || typeof newRoot !== 'string')
        return { ok: false };
    fs.mkdirSync(newRoot, { recursive: true });
    const settingsFile = path.join(app.getPath('userData'), 'settings.json');
    let settings = {};
    if (fs.existsSync(settingsFile)) {
        try {
            settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
        }
        catch { }
    }
    settings.projectsRoot = newRoot;
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
    return { ok: true, root: newRoot };
});
ipcMain.handle('hjen:pick-folder', async () => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    if (!win)
        return null;
    const res = await dialog.showOpenDialog(win, {
        title: 'Choose folder',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: projectsRootPath(),
    });
    if (res.canceled || res.filePaths.length === 0)
        return null;
    return res.filePaths[0];
});
// ============ Save generation ============
// Save a generated image + sidecar JSON to <projectsRoot>/<project_slug>/YYYY-MM-DD/{ts}_{slug}.{png,json}
// If no projectSlug, falls back to <projectsRoot>/_unassigned/YYYY-MM-DD/
ipcMain.handle('hjen:save-generation', (_e, args) => {
    const today = new Date().toISOString().slice(0, 10);
    const bucket = args.projectSlug ? args.projectSlug : '_unassigned';
    const dir = path.join(projectsRootPath(), bucket, today);
    fs.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safeSlug = (args.promptSlug || 'untitled').slice(0, 60);
    const base = `${ts}_${safeSlug}`;
    const imgPath = path.join(dir, `${base}.png`);
    const jsonPath = path.join(dir, `${base}.json`);
    const buffer = Buffer.from(args.base64, 'base64');
    fs.writeFileSync(imgPath, buffer);
    fs.writeFileSync(jsonPath, JSON.stringify(args.sidecar, null, 2));
    // Generate a small 320px-wide JPEG thumbnail for sidebar performance.
    // Saved alongside the full PNG as {base}.thumb.jpg
    const thumbPath = path.join(dir, `${base}.thumb.jpg`);
    try {
        const native = electron.nativeImage.createFromBuffer(buffer);
        const { width, height } = native.getSize();
        const scale = 320 / Math.max(1, width);
        const tw = Math.max(1, Math.round(width * scale));
        const th = Math.max(1, Math.round(height * scale));
        const thumbBuf = native.resize({ width: tw, height: th, quality: 'good' }).toJPEG(70);
        fs.writeFileSync(thumbPath, thumbBuf);
    }
    catch (e) {
        // Thumbnail is non-critical; sidebar can fall back to the full image
        console.warn('Thumbnail generation failed', e);
    }
    // Bump generation count on the project record
    if (args.projectId) {
        const arr = readProjects();
        const target = arr.find(p => p.id === args.projectId);
        if (target) {
            target.generationCount = (target.generationCount || 0) + 1;
            writeProjects(arr);
        }
    }
    return { imgPath, jsonPath, dir, thumbPath };
});
ipcMain.handle('hjen:open-folder', (_e, p) => {
    electron.shell.openPath(p);
    return true;
});
// Move a generation (.png + .json + .thumb.jpg) from its current project
// to a different project's date folder. Updates the sidecar's project field.
ipcMain.handle('hjen:move-generation', (_e, args) => {
    if (!fs.existsSync(args.imgPath))
        return { ok: false, reason: 'source_missing' };
    const dir = path.dirname(args.imgPath);
    const fname = path.basename(args.imgPath);
    const ext = path.extname(fname);
    const base = fname.slice(0, -ext.length);
    const jsonPath = path.join(dir, `${base}.json`);
    const thumbPath = path.join(dir, `${base}.thumb.jpg`);
    const dateFolder = path.basename(dir); // YYYY-MM-DD
    const sourceBucket = path.basename(path.dirname(dir)); // project slug
    const targetBucket = args.targetProjectSlug || '_unassigned';
    if (sourceBucket === targetBucket)
        return { ok: false, reason: 'same_project' };
    const targetDir = path.join(projectsRootPath(), targetBucket, dateFolder);
    fs.mkdirSync(targetDir, { recursive: true });
    // Avoid collisions if a same-named file already exists in target
    let targetBase = base;
    let suffix = 1;
    while (fs.existsSync(path.join(targetDir, `${targetBase}${ext}`))) {
        suffix += 1;
        targetBase = `${base}_${suffix}`;
    }
    const newImg = path.join(targetDir, `${targetBase}${ext}`);
    const newJson = path.join(targetDir, `${targetBase}.json`);
    const newThumb = path.join(targetDir, `${targetBase}.thumb.jpg`);
    // Update sidecar project reference before move
    let sidecar = {};
    try {
        sidecar = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    }
    catch { }
    if (args.targetProjectSlug) {
        const projects = readProjects();
        const target = projects.find(p => p.slug === args.targetProjectSlug);
        sidecar.project = target ? { id: target.id, name: target.name, slug: target.slug } : null;
    }
    else {
        sidecar.project = null;
    }
    // Perform moves
    fs.renameSync(args.imgPath, newImg);
    if (fs.existsSync(jsonPath)) {
        fs.writeFileSync(newJson, JSON.stringify(sidecar, null, 2));
        fs.unlinkSync(jsonPath);
    }
    if (fs.existsSync(thumbPath))
        fs.renameSync(thumbPath, newThumb);
    // Adjust generation counts on both projects
    const projects = readProjects();
    const sourceP = projects.find(p => p.slug === sourceBucket);
    if (sourceP)
        sourceP.generationCount = Math.max(0, (sourceP.generationCount || 0) - 1);
    if (args.targetProjectId) {
        const t = projects.find(p => p.id === args.targetProjectId);
        if (t)
            t.generationCount = (t.generationCount || 0) + 1;
    }
    writeProjects(projects);
    return { ok: true, newImgPath: newImg, newJsonPath: newJson };
});
// Permanently delete a generation's PNG + JSON + thumbnail.
ipcMain.handle('hjen:delete-generation', (_e, args) => {
    if (!fs.existsSync(args.imgPath))
        return { ok: false, reason: 'source_missing' };
    const dir = path.dirname(args.imgPath);
    const fname = path.basename(args.imgPath);
    const ext = path.extname(fname);
    const base = fname.slice(0, -ext.length);
    const jsonPath = path.join(dir, `${base}.json`);
    const thumbPath = path.join(dir, `${base}.thumb.jpg`);
    const projectSlug = path.basename(path.dirname(dir));
    try {
        fs.unlinkSync(args.imgPath);
    }
    catch { }
    try {
        if (fs.existsSync(jsonPath))
            fs.unlinkSync(jsonPath);
    }
    catch { }
    try {
        if (fs.existsSync(thumbPath))
            fs.unlinkSync(thumbPath);
    }
    catch { }
    // Decrement project counter
    const projects = readProjects();
    const proj = projects.find(p => p.slug === projectSlug);
    if (proj) {
        proj.generationCount = Math.max(0, (proj.generationCount || 0) - 1);
        writeProjects(projects);
    }
    return { ok: true };
});
ipcMain.handle('hjen:list-project-files', (_e, args) => {
    const bucket = args.projectSlug || '_unassigned';
    const root = path.join(projectsRootPath(), bucket);
    if (!fs.existsSync(root))
        return [];
    const entries = [];
    const dateFolders = fs.readdirSync(root).filter((d) => {
        const full = path.join(root, d);
        return fs.statSync(full).isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d);
    });
    for (const dateFolder of dateFolders) {
        const dir = path.join(root, dateFolder);
        const files = fs.readdirSync(dir);
        for (const f of files) {
            if (!f.endsWith('.json'))
                continue;
            const baseName = f.slice(0, -5);
            const imgPath = path.join(dir, `${baseName}.png`);
            const thumbCandidate = path.join(dir, `${baseName}.thumb.jpg`);
            const jsonPath = path.join(dir, f);
            if (!fs.existsSync(imgPath))
                continue;
            let sidecar = {};
            try {
                sidecar = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
            }
            catch { }
            const stat = fs.statSync(imgPath);
            const title = sidecar?.selections?.prompt?.split(/[.!?\n,]/)[0]?.trim()?.slice(0, 80) ||
                baseName.split('_').slice(1).join(' ').replace(/-/g, ' ');
            entries.push({
                imgPath,
                thumbPath: fs.existsSync(thumbCandidate) ? thumbCandidate : undefined,
                jsonPath,
                dateFolder,
                baseName,
                promptTitle: title || baseName,
                size: sidecar?.finalSize || sidecar?.size,
                ts: stat.mtimeMs,
                costUsd: typeof sidecar?.estimatedCost?.usd === 'number' ? sidecar.estimatedCost.usd : undefined,
                durationMs: typeof sidecar?.durationMs === 'number' ? sidecar.durationMs : undefined,
                modelLabel: sidecar?.model,
            });
        }
    }
    entries.sort((a, b) => b.ts - a.ts);
    return entries;
});
ipcMain.handle('hjen:read-sidecar', (_e, jsonPath) => {
    if (!fs.existsSync(jsonPath))
        return null;
    try {
        return JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    }
    catch {
        return null;
    }
});
// Walk EVERY project folder and return every generation entry with its
// sidecar metadata. Used by the global Usage report + Projects page.
ipcMain.handle('hjen:list-all-generations', () => {
    const root = projectsRootPath();
    if (!fs.existsSync(root))
        return [];
    const projects = readProjects();
    const projectBySlug = new Map(projects.map(p => [p.slug, p]));
    const out = [];
    const bucketDirs = fs.readdirSync(root).filter((d) => {
        if (d === '_library')
            return false; // skip the central library
        return fs.statSync(path.join(root, d)).isDirectory();
    });
    for (const bucket of bucketDirs) {
        const bucketPath = path.join(root, bucket);
        const project = projectBySlug.get(bucket) ?? null;
        const dateFolders = fs.readdirSync(bucketPath).filter((d) => {
            const full = path.join(bucketPath, d);
            return fs.statSync(full).isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d);
        });
        for (const dateFolder of dateFolders) {
            const dir = path.join(bucketPath, dateFolder);
            const files = fs.readdirSync(dir);
            for (const f of files) {
                if (!f.endsWith('.json'))
                    continue;
                const baseName = f.slice(0, -5);
                const imgPath = path.join(dir, `${baseName}.png`);
                const thumbCandidate = path.join(dir, `${baseName}.thumb.jpg`);
                const jsonPath = path.join(dir, f);
                if (!fs.existsSync(imgPath))
                    continue;
                let sidecar = {};
                try {
                    sidecar = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
                }
                catch { }
                const stat = fs.statSync(imgPath);
                out.push({
                    imgPath,
                    thumbPath: fs.existsSync(thumbCandidate) ? thumbCandidate : undefined,
                    jsonPath,
                    dateFolder,
                    baseName,
                    ts: stat.mtimeMs,
                    captured: sidecar?.captured ?? null,
                    promptTitle: sidecar?.selections?.prompt?.split(/[.!?\n,]/)[0]?.trim()?.slice(0, 100) ||
                        baseName.split('_').slice(1).join(' ').replace(/-/g, ' '),
                    finalSize: sidecar?.finalSize || sidecar?.size,
                    modelLabel: sidecar?.model,
                    quality: sidecar?.selections?.quality,
                    resolution: sidecar?.selections?.resolution,
                    aspect: sidecar?.selections?.aspect,
                    costUsd: typeof sidecar?.estimatedCost?.usd === 'number' ? sidecar.estimatedCost.usd : undefined,
                    durationMs: typeof sidecar?.durationMs === 'number' ? sidecar.durationMs : undefined,
                    referencesCount: Array.isArray(sidecar?.references) ? sidecar.references.length : 0,
                    projectId: project?.id ?? null,
                    projectName: project?.name ?? '(unassigned)',
                    projectSlug: bucket,
                });
            }
        }
    }
    out.sort((a, b) => b.ts - a.ts);
    return out;
});
ipcMain.handle('hjen:read-image-data-url', (_e, imgPath) => {
    if (!fs.existsSync(imgPath))
        return null;
    const ext = path.extname(imgPath).slice(1).toLowerCase() || 'png';
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
    const data = fs.readFileSync(imgPath);
    return `data:${mime};base64,${data.toString('base64')}`;
});
function libraryRoot() {
    return path.join(projectsRootPath(), '_library');
}
function libraryIndexPath() {
    return path.join(libraryRoot(), 'library.json');
}
function readLibrary() {
    const p = libraryIndexPath();
    if (!fs.existsSync(p))
        return [];
    try {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
    catch {
        return [];
    }
}
function writeLibrary(arr) {
    fs.mkdirSync(libraryRoot(), { recursive: true });
    fs.writeFileSync(libraryIndexPath(), JSON.stringify(arr, null, 2));
}
function makeThumb(buffer, thumbPath) {
    const native = electron.nativeImage.createFromBuffer(buffer);
    const sz = native.getSize();
    const scale = 320 / Math.max(1, sz.width);
    const tw = Math.max(1, Math.round(sz.width * scale));
    const th = Math.max(1, Math.round(sz.height * scale));
    const thumbBuf = native.resize({ width: tw, height: th, quality: 'good' }).toJPEG(70);
    fs.writeFileSync(thumbPath, thumbBuf);
}
ipcMain.handle('hjen:list-library', () => readLibrary());
ipcMain.handle('hjen:add-to-library', (_e, args) => {
    if (!fs.existsSync(args.sourcePath))
        return { ok: false, reason: 'source_not_found' };
    const ext = path.extname(args.sourcePath).toLowerCase() || '.png';
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const catDir = path.join(libraryRoot(), `${args.category}s`);
    fs.mkdirSync(catDir, { recursive: true });
    const filePath = path.join(catDir, `${id}${ext}`);
    const thumbPath = path.join(catDir, `thumb_${id}.jpg`);
    const buffer = fs.readFileSync(args.sourcePath);
    fs.writeFileSync(filePath, buffer);
    try {
        makeThumb(buffer, thumbPath);
    }
    catch (e) {
        console.warn('[library] thumb failed', e);
    }
    const baseName = path.basename(args.sourcePath, ext);
    const asset = {
        id,
        category: args.category,
        name: args.name?.trim() || baseName,
        filename: path.basename(args.sourcePath),
        filePath,
        thumbPath,
        addedAt: new Date().toISOString(),
        bytes: buffer.length,
        origin: args.sourcePath,
    };
    const arr = readLibrary();
    arr.unshift(asset);
    writeLibrary(arr);
    return { ok: true, asset };
});
ipcMain.handle('hjen:delete-from-library', (_e, args) => {
    const arr = readLibrary();
    const target = arr.find(a => a.id === args.id);
    if (!target)
        return { ok: false };
    try {
        if (fs.existsSync(target.filePath))
            fs.unlinkSync(target.filePath);
    }
    catch { }
    try {
        if (fs.existsSync(target.thumbPath))
            fs.unlinkSync(target.thumbPath);
    }
    catch { }
    writeLibrary(arr.filter(a => a.id !== args.id));
    return { ok: true };
});
ipcMain.handle('hjen:rename-library-asset', (_e, args) => {
    const arr = readLibrary();
    const target = arr.find(a => a.id === args.id);
    if (!target)
        return null;
    target.name = args.name.trim() || target.name;
    writeLibrary(arr);
    return target;
});
ipcMain.handle('hjen:pick-image-files', async () => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    if (!win)
        return null;
    const res = await dialog.showOpenDialog(win, {
        title: 'Add to reference library',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'tiff', 'bmp'] }],
    });
    if (res.canceled || res.filePaths.length === 0)
        return null;
    return res.filePaths;
});
// Backfill thumbnails for existing PNGs that were saved before the
// thumbnail-on-save feature was added. Returns { processed, skipped, errors }.
ipcMain.handle('hjen:backfill-thumbnails', async (_e, args) => {
    const bucket = args?.projectSlug || '_unassigned';
    const root = path.join(projectsRootPath(), bucket);
    if (!fs.existsSync(root))
        return { processed: 0, skipped: 0, errors: 0 };
    let processed = 0;
    let skipped = 0;
    let errors = 0;
    const dateFolders = fs.readdirSync(root).filter((d) => {
        const full = path.join(root, d);
        return fs.statSync(full).isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d);
    });
    for (const dateFolder of dateFolders) {
        const dir = path.join(root, dateFolder);
        const files = fs.readdirSync(dir);
        for (const f of files) {
            if (!f.endsWith('.png'))
                continue;
            const baseName = f.slice(0, -4);
            const imgPath = path.join(dir, f);
            const thumbPath = path.join(dir, `${baseName}.thumb.jpg`);
            if (fs.existsSync(thumbPath)) {
                skipped++;
                continue;
            }
            try {
                const buf = fs.readFileSync(imgPath);
                const native = electron.nativeImage.createFromBuffer(buf);
                const sz = native.getSize();
                const scale = 320 / Math.max(1, sz.width);
                const tw = Math.max(1, Math.round(sz.width * scale));
                const th = Math.max(1, Math.round(sz.height * scale));
                const thumbBuf = native.resize({ width: tw, height: th, quality: 'good' }).toJPEG(70);
                fs.writeFileSync(thumbPath, thumbBuf);
                processed++;
            }
            catch (err) {
                console.warn(`[backfill] failed for ${imgPath}`, err);
                errors++;
            }
        }
    }
    return { processed, skipped, errors };
});
// ---------------------------------------------------------------------------
// Skills — Anthropic-style markdown skill files. Stored under
//   {userData}/skills/{slug}.md
//
// Each file has YAML frontmatter (name/description/version) and a body that
// becomes the system prompt for the Claude call that produces the Master
// Prompt before image generation.
function skillsRoot() {
    const dir = path.join(app.getPath('userData'), 'skills');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}
function slugifySkillName(name) {
    return name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'skill';
}
function parseSkillFrontmatter(raw) {
    // Strip UTF-8 BOM if present — common in files saved by Windows editors or
    // some macOS apps. Without this, the leading char is U+FEFF and the
    // `^---` regex below silently fails to match the frontmatter.
    let src = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n');
    // Permit leading blank lines before the opening fence.
    src = src.replace(/^\s*\n+/, '');
    const m = src.match(/^---+\s*\n([\s\S]*?)\n---+\s*(?:\n|$)([\s\S]*)$/);
    if (!m)
        return { meta: {}, body: src.trim(), hasFrontmatter: false };
    const meta = {};
    for (const line of m[1].split('\n')) {
        // Allow optional leading whitespace before the key (some editors indent).
        const kv = line.match(/^\s*([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
        if (!kv)
            continue;
        let v = kv[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
        }
        meta[kv[1].toLowerCase()] = v;
    }
    return { meta, body: m[2].trim(), hasFrontmatter: true };
}
function readSkillFromDisk(filePath) {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const { meta, body } = parseSkillFrontmatter(raw);
        const stat = fs.statSync(filePath);
        const id = path.basename(filePath, '.md');
        if (!body)
            return null;
        return {
            id,
            name: meta.name || id,
            description: meta.description || '',
            version: meta.version || '',
            filePath,
            body,
            importedAt: stat.mtime.toISOString(),
            bytes: stat.size,
        };
    }
    catch (e) {
        console.warn('[skills] failed to read', filePath, e);
        return null;
    }
}
ipcMain.handle('hjen:list-skills', () => {
    const dir = skillsRoot();
    return fs.readdirSync(dir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => readSkillFromDisk(path.join(dir, f)))
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));
});
ipcMain.handle('hjen:pick-skill-file', async () => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    if (!win)
        return null;
    const res = await dialog.showOpenDialog(win, {
        title: 'Import skill (Markdown)',
        properties: ['openFile'],
        filters: [{ name: 'Skill files', extensions: ['md', 'markdown'] }],
    });
    if (res.canceled || !res.filePaths?.[0])
        return null;
    return res.filePaths[0];
});
ipcMain.handle('hjen:import-skill', (_e, args) => {
    if (!args?.sourcePath || !fs.existsSync(args.sourcePath)) {
        return { ok: false, reason: 'source_not_found' };
    }
    let raw;
    try {
        raw = fs.readFileSync(args.sourcePath, 'utf8');
    }
    catch {
        return { ok: false, reason: 'read_failed' };
    }
    const { meta, body, hasFrontmatter } = parseSkillFrontmatter(raw);
    if (!hasFrontmatter)
        return { ok: false, reason: 'no_frontmatter' };
    if (!body)
        return { ok: false, reason: 'empty_body' };
    if (!meta.name)
        return { ok: false, reason: 'missing_name', foundKeys: Object.keys(meta) };
    const slug = slugifySkillName(meta.name);
    const dest = path.join(skillsRoot(), `${slug}.md`);
    if (fs.existsSync(dest))
        return { ok: false, reason: 'already_exists', existingId: slug };
    fs.writeFileSync(dest, raw, 'utf8');
    const skill = readSkillFromDisk(dest);
    if (!skill)
        return { ok: false, reason: 'parse_failed' };
    return { ok: true, skill };
});
ipcMain.handle('hjen:delete-skill', (_e, args) => {
    if (!args?.id)
        return { ok: false };
    const safe = path.basename(args.id).replace(/[^A-Za-z0-9_-]/g, '');
    const filePath = path.join(skillsRoot(), `${safe}.md`);
    if (!fs.existsSync(filePath))
        return { ok: false, reason: 'not_found' };
    try {
        fs.unlinkSync(filePath);
        return { ok: true };
    }
    catch (e) {
        return { ok: false, reason: 'unlink_failed', message: String(e?.message || e) };
    }
});
function skillRunsLogPath() {
    return path.join(projectsRootPath(), '_skill_runs.jsonl');
}
function appendSkillRunEvent(ev) {
    try {
        fs.mkdirSync(projectsRootPath(), { recursive: true });
        fs.appendFileSync(skillRunsLogPath(), JSON.stringify(ev) + '\n');
    }
    catch (err) {
        console.warn('[skill-run] could not append to log', err);
    }
}
ipcMain.handle('hjen:list-skill-runs', () => {
    const p = skillRunsLogPath();
    if (!fs.existsSync(p))
        return [];
    try {
        const lines = fs.readFileSync(p, 'utf-8').split(/\r?\n/).filter(Boolean);
        const out = [];
        for (const line of lines) {
            try {
                out.push(JSON.parse(line));
            }
            catch { }
        }
        return out;
    }
    catch {
        return [];
    }
});
ipcMain.handle('hjen:run-skill', async (_e, args) => {
    let apiKey = process.env.ANTHROPIC_API_KEY || null;
    if (!apiKey) {
        const keyFile = path.join(app.getPath('userData'), 'anthropic_key.txt');
        if (fs.existsSync(keyFile))
            apiKey = fs.readFileSync(keyFile, 'utf-8').trim() || null;
    }
    if (!apiKey) {
        return { ok: false, reason: 'no_key', message: 'No Anthropic API key configured. Open Settings and add one.' };
    }
    const prompt = (args.prompt || '').trim();
    if (!prompt) {
        return { ok: false, reason: 'empty_prompt', message: 'Write a prompt first, then run a skill.' };
    }
    const safeId = path.basename(args.skillId || '').replace(/[^A-Za-z0-9_-]/g, '');
    if (!safeId)
        return { ok: false, reason: 'invalid_skill', message: 'Invalid skill id.' };
    const skillFile = path.join(skillsRoot(), `${safeId}.md`);
    if (!fs.existsSync(skillFile)) {
        return { ok: false, reason: 'skill_not_found', message: 'Skill file not found on disk.' };
    }
    const skill = readSkillFromDisk(skillFile);
    if (!skill || !skill.body) {
        return { ok: false, reason: 'skill_unreadable', message: 'Could not parse the skill file.' };
    }
    try {
        const res = await fetch(ANTHROPIC_ENDPOINT, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: ENHANCE_MODEL,
                max_tokens: 1024,
                system: skill.body,
                messages: [{ role: 'user', content: prompt }],
            }),
        });
        if (!res.ok) {
            const errBody = await res.text();
            return { ok: false, reason: 'api_error', message: `Anthropic ${res.status}: ${errBody.slice(0, 400)}` };
        }
        const data = await res.json();
        const text = Array.isArray(data?.content)
            ? data.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim()
            : '';
        if (!text) {
            return { ok: false, reason: 'empty_response', message: 'Skill returned an empty response.' };
        }
        const inputTokens = data?.usage?.input_tokens ?? 0;
        const outputTokens = data?.usage?.output_tokens ?? 0;
        const usd = (inputTokens / 1_000_000) * CLAUDE_PRICING.inputPerMTok +
            (outputTokens / 1_000_000) * CLAUDE_PRICING.outputPerMTok;
        appendSkillRunEvent({
            ts: Date.now(),
            model: ENHANCE_MODEL,
            skillId: skill.id,
            skillName: skill.name,
            inputTokens,
            outputTokens,
            usd,
            rawPromptChars: prompt.length,
            masterPromptChars: text.length,
            rawPromptExcerpt: prompt.slice(0, 120),
            masterPromptExcerpt: text.slice(0, 120),
            projectId: args.projectId ?? null,
            projectSlug: args.projectSlug ?? null,
            projectName: args.projectName ?? null,
        });
        return {
            ok: true,
            masterPrompt: text,
            usage: { inputTokens, outputTokens },
            usd,
            model: ENHANCE_MODEL,
            skillId: skill.id,
            skillName: skill.name,
        };
    }
    catch (err) {
        return { ok: false, reason: 'network', message: err?.message || 'Network error contacting Anthropic.' };
    }
});
