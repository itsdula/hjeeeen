// Ingest tools — the media-input layer:
// hjen_asset_upload lets ANY agent (local or hosted — no shared filesystem
// needed) push an image or document INTO the studio, landing it in the exact
// {slug}/{date}/ layout the app's Library/Usage reads. hjen_asset_view returns
// an image as a real MCP `image` content block so the agent can SEE a frame.

import fs from 'node:fs';
import path from 'node:path';
import { McpServer, type ToolResult } from '../mcp/server.js';
import type { Host } from '../host.js';
import { resolveProject } from '../projects.js';
import { saveUpload } from '../save.js';
import { projectLink } from '../deeplinks.js';
import type { ProjectMeta } from '../types.js';

const ok = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], isError: true });

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB — matches provider ceilings
const MAX_VIEW_BYTES = 6 * 1024 * 1024;    // beyond this, serve the .thumb.jpg sibling

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const DOC_EXTS = new Set(['pdf', 'md', 'txt', 'csv', 'json', 'docx', 'pptx', 'xlsx']);

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  pdf: 'application/pdf', md: 'text/markdown', txt: 'text/plain', csv: 'text/csv', json: 'application/json',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** Sniff ext from a dataURL mime, an explicit ext, or a filename — in that order. */
function resolveExt(data: string, ext?: string, filename?: string): string | null {
  const m = /^data:([a-z0-9.+/-]+);base64,/i.exec(data);
  if (m) {
    const mime = m[1].toLowerCase();
    const hit = Object.entries(MIME).find(([, v]) => v === mime);
    if (hit) return hit[0];
    if (mime === 'image/jpg') return 'jpg';
  }
  const fromExt = (ext || '').replace(/^\./, '').toLowerCase();
  if (fromExt) return fromExt;
  const fromName = (filename || '').split('.').pop()?.toLowerCase() || '';
  return fromName || null;
}

function resolveOptionalProject(host: Host, query: unknown): { project: ProjectMeta | null } | { error: ToolResult } {
  const q = typeof query === 'string' ? query.trim() : '';
  if (!q) return { project: null };
  const { project, matches } = resolveProject(host, q);
  if (project) return { project };
  return {
    error: fail({
      error: matches.length > 1 ? 'ambiguous' : 'not_found', query: q,
      matches: matches.map(m => ({ id: m.id, name: m.name, slug: m.slug })),
      hint: 'Pass an exact id or slug from hjen_projects_list, or omit project to save unassigned.',
    }),
  };
}

export function registerIngestTools(server: McpServer, host: Host): void {
  server.tool({
    name: 'hjen_asset_upload',
    title: 'Upload an image or document into the studio',
    description: 'Push an image (png/jpg/webp/gif) or document (pdf/md/txt/csv/json/docx/pptx/xlsx) INTO HJEN Studio from base64 — no shared filesystem needed. Saves into the project\'s {date}/ folder with a sidecar, appears in the app\'s Library/Usage, and returns the absolute path ready to use as `references` (frame) or `imagePath` (video).',
    inputSchema: {
      type: 'object',
      properties: {
        data: { type: 'string', description: 'Base64 payload — raw base64 or a full data: URL.' },
        filename: { type: 'string', description: 'Optional original filename (used for slug + ext sniffing).' },
        ext: { type: 'string', description: 'Optional explicit extension (png, jpg, pdf, md, ...).' },
        kind: { type: 'string', enum: ['image', 'document'], description: 'What this is. Default: inferred from extension.' },
        project: { type: 'string', description: 'Optional project id/slug/name to file it under (else _unassigned).' },
        note: { type: 'string', description: 'Optional human note stored in the sidecar + log title.' },
      },
      required: ['data'],
    },
    handler: (args) => {
      const raw = String(args.data ?? '');
      if (!raw) return fail({ error: 'no_data', hint: 'Pass base64 in `data`.' });

      const extRes = resolveExt(raw, args.ext as string | undefined, args.filename as string | undefined);
      if (!extRes) return fail({ error: 'unknown_type', hint: 'Pass `ext` or a `filename` with an extension, or use a data: URL.' });
      const ext = extRes === 'jpeg' ? 'jpg' : extRes;

      const isImage = IMAGE_EXTS.has(ext);
      const isDoc = DOC_EXTS.has(ext);
      if (!isImage && !isDoc) return fail({ error: 'unsupported_type', ext, allowed: [...IMAGE_EXTS, ...DOC_EXTS] });
      const kind = (args.kind === 'image' || args.kind === 'document') ? args.kind : (isImage ? 'image' : 'document');

      const base64 = raw.replace(/^data:[a-z0-9.+/-]+;base64,/i, '');
      let bytes: Buffer;
      try { bytes = Buffer.from(base64, 'base64'); } catch { return fail({ error: 'bad_base64' }); }
      if (!bytes.length) return fail({ error: 'empty_payload' });
      if (bytes.length > MAX_UPLOAD_BYTES) return fail({ error: 'too_large', bytes: bytes.length, maxBytes: MAX_UPLOAD_BYTES });

      const pr = resolveOptionalProject(host, args.project);
      if ('error' in pr) return pr.error;

      const slugBase = (args.filename ? String(args.filename).replace(/\.[^.]+$/, '') : '') || (args.note ? String(args.note) : '') || `upload-${kind}`;
      const { filePath, jsonPath } = saveUpload(host, ext, {
        base64,
        promptSlug: slugBase,
        project: pr.project,
        sidecar: {
          kind: 'upload', uploadKind: kind, note: args.note ?? null,
          originalFilename: args.filename ?? null, mime: MIME[ext] || 'application/octet-stream',
          bytes: bytes.length, captured: new Date().toISOString(),
          project: pr.project ? { id: pr.project.id, name: pr.project.name, slug: pr.project.slug } : null,
        },
      });

      return ok({
        ok: true, kind, absPath: filePath, sidecar: jsonPath,
        mime: MIME[ext] || 'application/octet-stream', bytes: bytes.length,
        usableAs: isImage ? 'frame_make.references[] · portrait_refine.image · video_make.imagePath' : 'stage docs / briefs (read with your own tools)',
        deepLink: pr.project ? projectLink(pr.project.id, 'library') : undefined,
      });
    },
  });

  server.tool({
    name: 'hjen_asset_view',
    title: 'View an image asset (the agent sees it)',
    description: 'Return an image file as a real MCP image block so the agent can visually inspect a frame/take before deciding. Large files fall back to the .thumb.jpg sidecar when present.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute path of an image (e.g. a generation imgPath or an uploaded asset).' } },
      required: ['path'],
    },
    handler: (args) => {
      const p = String(args.path ?? '');
      if (!p || !path.isAbsolute(p)) return fail({ error: 'need_absolute_path' });
      if (!fs.existsSync(p)) return fail({ error: 'not_found', path: p });
      const ext = p.split('.').pop()?.toLowerCase() || '';
      if (!IMAGE_EXTS.has(ext)) return fail({ error: 'not_an_image', ext, hint: 'Only png/jpg/webp/gif can be viewed.' });

      let serve = p;
      let size = fs.statSync(p).size;
      if (size > MAX_VIEW_BYTES) {
        const thumb = p.replace(/\.[^.]+$/, '.thumb.jpg');
        if (fs.existsSync(thumb)) { serve = thumb; size = fs.statSync(thumb).size; }
        if (size > MAX_VIEW_BYTES) return fail({ error: 'too_large_to_view', bytes: size, maxBytes: MAX_VIEW_BYTES, hint: 'No small-enough thumbnail sibling found.' });
      }
      const servedExt = serve.split('.').pop()?.toLowerCase() || 'png';
      return {
        content: [
          { type: 'image', data: fs.readFileSync(serve).toString('base64'), mimeType: MIME[servedExt] || 'image/png' },
          { type: 'text', text: JSON.stringify({ path: p, served: serve === p ? 'original' : 'thumbnail', bytes: size }) },
        ],
      };
    },
  });
}
