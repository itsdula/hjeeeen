// Surface ③ — mount external MCP servers INTO HJEN's in-app agent. Connects to
// the primary hjen server plus any configured external stdio MCP servers, merges
// their tools (external names prefixed to avoid collisions), and returns a single
// router the agent loop calls. Unreachable externals are skipped, never fatal.

import { McpStdioClient } from './mcp-stdio-client.js';

export interface ServerSpec { name: string; command: string; args?: string[]; env?: NodeJS.ProcessEnv }
export interface AgentToolDef { name: string; description: string; input_schema: any }
export interface Mounted {
  tools: AgentToolDef[];
  call: (name: string, args: Record<string, unknown>) => Promise<{ content: any[]; isError?: boolean }>;
  clients: McpStdioClient[];
  mounted: Array<{ name: string; toolCount: number; ok: boolean; error?: string }>;
}

export async function mountServers(primary: ServerSpec, externals: ServerSpec[] = []): Promise<Mounted> {
  const router = new Map<string, { client: McpStdioClient; real: string }>();
  const clients: McpStdioClient[] = [];
  const tools: AgentToolDef[] = [];
  const mounted: Mounted['mounted'] = [];

  // Primary (hjen) — tools keep their names.
  const pc = new McpStdioClient(primary.command, primary.args, primary.env);
  await pc.start();
  clients.push(pc);
  const pTools = await pc.listTools();
  for (const t of pTools) { tools.push({ name: t.name, description: t.description, input_schema: t.inputSchema }); router.set(t.name, { client: pc, real: t.name }); }
  mounted.push({ name: primary.name, toolCount: pTools.length, ok: true });

  // Externals — prefixed `ext__{server}__{tool}` so names never collide.
  for (const ext of externals) {
    try {
      const c = new McpStdioClient(ext.command, ext.args, ext.env);
      await c.start();
      clients.push(c);
      const et = await c.listTools();
      for (const t of et) { const pn = `ext__${ext.name}__${t.name}`; tools.push({ name: pn, description: `[${ext.name}] ${t.description}`, input_schema: t.inputSchema }); router.set(pn, { client: c, real: t.name }); }
      mounted.push({ name: ext.name, toolCount: et.length, ok: true });
    } catch (e: any) {
      mounted.push({ name: ext.name, toolCount: 0, ok: false, error: e?.message || String(e) });
    }
  }

  const call = async (name: string, args: Record<string, unknown>) => {
    const r = router.get(name);
    if (!r) return { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true };
    return r.client.callTool(r.real, args);
  };

  return { tools, call, clients, mounted };
}
