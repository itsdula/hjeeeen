// The ONE place the hjen MCP server is assembled — tools, resources, prompts.
// Both the stdio entry (index.ts) and the hosted HTTP entry (http/serve-http.ts)
// call buildServer(host), so the two transports can never expose different tools.

import { McpServer } from './mcp/server.js';
import type { Host } from './host.js';
import { registerResources } from './resources.js';
import { registerReadTools } from './tools/read.js';
import { registerWriteTools } from './tools/write.js';
import { registerMakeTools } from './tools/make.js';
import { registerOrchestrateTools } from './tools/orchestrate.js';
import { registerIngestTools } from './tools/ingest.js';
import { registerConversationTools } from './tools/conversations.js';
import { registerStudioTools } from './tools/studio.js';
import { registerDirectorTools } from './tools/director.js';
import { registerPrompts } from './prompts.js';
import { initJobs } from './jobs.js';

export const INSTRUCTIONS = `HJEN Studio — a Saudi-DNA KV/film production studio, driven over MCP.

A project holds an 8-stage pipeline contract (Brief → References → Recast →
Treatment → Screenplay → Assets → Frames → Videos) + a ledger, plus a
storyboard, a node graph, generations, a shared library, and cast cards. Every
tool speaks the same DOP language (Selections + Layer references).

ORIENT BEFORE ACTING: call hjen_project_overview first — it returns the whole
contract in one read. Load hjen://dna and hjen://register before making any
image or copy; they are binding. House vocabulary: MAKE / FRAME / REFINE / TAKE
— never "generate".

OPENING VIEWS: when the user asks to OPEN a project/view (node, storyboard,
frame, video, library, cast), call hjen_studio_open — it navigates the running
app for them. Only fall back to printing the deep link if it returns
opened:false.`;

/** Assemble a fully-registered hjen MCP server bound to `host`. */
export function buildServer(host: Host): McpServer {
  initJobs(host);
  const server = new McpServer({ name: 'hjen', version: '0.1.0' }, { instructions: INSTRUCTIONS });
  registerResources(server, host);
  registerReadTools(server, host);
  registerWriteTools(server, host);
  registerMakeTools(server, host);
  registerOrchestrateTools(server, host);
  registerIngestTools(server, host);
  registerConversationTools(server, host);
  registerStudioTools(server, host);
  registerDirectorTools(server, host);
  registerPrompts(server);
  return server;
}
