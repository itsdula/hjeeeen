// Breakdown — SERVER-SIDE ASR (Phase 4). Transcribes the ingested audio track to
// TIMED segments via the OpenAI Whisper API (a DIRECT vendor — no middleman;
// Anwar's decision 2026-07-27). Arabic-first. Faithful port of the desktop
// bdTranscribe OpenAI path + its hallucination/lang guards. NEVER throws — returns
// a clear failure the caller degrades from (→ no dialogue), so ASR is best-effort.

import fs from 'node:fs';
import path from 'node:path';

/** Normalize a detected-language string to a short code where obvious. */
function normLang(l) {
  const s = (l || '').toLowerCase();
  if (/^ar|arab/.test(s)) return 'ar';
  if (/^en|engl/.test(s)) return 'en';
  return s.slice(0, 5) || 'und';
}

// Whisper hallucinates on non-speech audio (music beds, ambience, wordless ads) —
// emitting gibberish like "L L L L", one repeated token, or bracketed annotations
// ([Music] / 〈Footsteps〉 / موسيقى). Such output must NOT pollute the analysis as
// "dialogue"; detect it so the caller degrades to none (the SOUND vision pass still
// hears the real audio). Byte-for-byte with the desktop guard.
function looksHallucinated(segs) {
  const text = segs.map((s) => s.text).join(' ').trim();
  if (!text) return true;
  const spoken = text
    .replace(/[〈\[(][^〉\])]*[〉\])]/g, ' ')
    .replace(/\bموسيقى\b|\bmusic\b|\bapplause\b|\btance\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  const spokenWords = spoken.split(/\s+/).filter((w) => w.replace(/[^\p{L}\p{N}]/gu, '').length >= 2);
  if (spokenWords.length < 3) return true;
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return false;
  const counts = {};
  for (const t of tokens) counts[t] = (counts[t] || 0) + 1;
  const maxRep = Math.max(...Object.values(counts));
  if (tokens.length > 6 && maxRep / tokens.length > 0.4) return true;
  const shortRatio = tokens.filter((t) => t.replace(/[^\p{L}\p{N}]/gu, '').length <= 1).length / tokens.length;
  if (shortRatio > 0.55) return true;
  const compact = text.replace(/\s+/g, '');
  const uniq = new Set(compact.toLowerCase()).size;
  if (compact.length > 20 && uniq / compact.length < 0.12) return true;
  return false;
}

/** Flat "line | line" caption string for prompt code that wants an untimed blob. */
export function captionsFlat(segs, maxChars = 4000) {
  if (!segs || !segs.length) return '';
  return segs.map((s) => s.text).join(' | ').slice(0, maxChars);
}

/**
 * Transcribe an audio file → { ok, transcript:{lang,source:'asr',segments[]}, message }.
 * @param {string} audioPath  absolute path to the ingested audio (m4a)
 * @param {string} key        OpenAI API key (server-side)
 * @param {{ model?:string, language?:string }} [opts]  language 'auto'|'ar'|'en'|…
 */
export async function transcribeAudio(audioPath, key, opts = {}) {
  if (!audioPath || !fs.existsSync(audioPath)) return { ok: false, message: 'no audio to transcribe' };
  if (!key) return { ok: false, message: 'no OpenAI key for transcription' };
  try {
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(audioPath)]), path.basename(audioPath));
    form.append('model', opts.model || 'whisper-1');
    form.append('response_format', 'verbose_json');
    if (opts.language && opts.language !== 'auto') form.append('language', opts.language);
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form,
    });
    if (!res.ok) return { ok: false, message: `ASR API ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const j = await res.json();
    const segs = (Array.isArray(j?.segments) ? j.segments : []).map((s) => ({
      start: Number(s.start) || 0, end: Number(s.end) || 0, text: String(s.text || '').trim(),
    })).filter((s) => s.text);
    if (!segs.length && j?.text) segs.push({ start: 0, end: Number(j?.duration) || 0, text: String(j.text).trim() });
    if (!segs.length) return { ok: false, message: 'ASR returned no speech' };
    if (looksHallucinated(segs)) return { ok: false, message: 'no clear speech — ASR output looked hallucinated (music/ambience)' };
    return { ok: true, transcript: { lang: normLang(j?.language || opts.language || 'und'), source: 'asr', segments: segs } };
  } catch (e) {
    return { ok: false, message: String(e?.message || e).slice(0, 200) };
  }
}
