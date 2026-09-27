// Conversation tools — external agents see the SAME saved Assistant
// conversations the in-app panel shows (general + project-linked). Read-only
// by design: agents browse history for context; writing happens through the
// app's assistant turn (electron/main.ts) or a future explicit append tool.

import { McpServer, type ToolResult } from '../mcp/server.js';
import type { Host } from '../host.js';
import { listConversations, readConversation } from '../conversations-store.js';
import { resolveProject } from '../projects.js';

const ok = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], isError: true });

export function registerConversationTools(server: McpServer, host: Host): void {
  server.tool({
    name: 'hjen_conversations_list',
    title: 'List saved Assistant conversations',
    description: 'List saved Assistant conversations — general ones plus every project-linked one (each entry names its project). Pass `project` to scope to one project.',
    inputSchema: {
      type: 'object',
      properties: { project: { type: 'string', description: 'Optional project id/slug/name to scope the list.' } },
    },
    handler: ({ project }) => {
      const q = typeof project === 'string' ? project.trim() : '';
      if (!q) return ok({ count: undefined, conversations: listConversations(host) });
      const { project: p, matches } = resolveProject(host, q);
      if (!p) return fail({ error: matches.length > 1 ? 'ambiguous' : 'not_found', query: q, matches: matches.map(m => ({ id: m.id, slug: m.slug })) });
      const conversations = listConversations(host, { projectSlug: p.slug });
      return ok({ project: { id: p.id, name: p.name, slug: p.slug }, count: conversations.length, conversations });
    },
  });

  server.tool({
    name: 'hjen_conversation_get',
    title: 'Read one saved conversation',
    description: 'Return a saved Assistant conversation in full (messages + which project it is linked to, if any) by id from hjen_conversations_list.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Conversation id.' } },
      required: ['id'],
    },
    handler: ({ id }) => {
      const c = readConversation(host, String(id ?? ''));
      if (!c) return fail({ error: 'not_found', id });
      return ok(c);
    },
  });
}
