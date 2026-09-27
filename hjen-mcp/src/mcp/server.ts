// Zero-dependency MCP server core — JSON-RPC 2.0 over stdio, newline-framed.
//
// Same ethos as server/src/server.js: runs on Electron's bundled node with
// NOTHING installed (no @modelcontextprotocol/sdk, no zod, no npm). Implements
// the slice of the MCP spec HJEN needs: initialize, tools/list, tools/call,
// resources/list, resources/templates/list, resources/read, prompts/list, ping.
//
// stdio contract: every protocol message is ONE line of JSON on stdout; NOTHING
// else may touch stdout — all logs go to stderr.

const PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED = new Set(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']);

export interface TextContent { type: 'text'; text: string }
/** Base64 image block (MCP spec `image` content) — lets a tool return a frame
 *  the agent can SEE (hjen_asset_view). data = raw base64, no data: prefix. */
export interface ImageContent { type: 'image'; data: string; mimeType: string }
export type ContentBlock = TextContent | ImageContent;
export interface ToolResult { content: ContentBlock[]; isError?: boolean }
export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult> | ToolResult;

export interface JsonSchema { type: 'object'; properties?: Record<string, unknown>; required?: string[]; [k: string]: unknown }
export interface ToolDef { name: string; title?: string; description: string; inputSchema: JsonSchema; handler: ToolHandler }

export interface ResourceContents { uri: string; mimeType?: string; text: string }
export type ResourceReader = (uri: string, vars: Record<string, string>) => Promise<ResourceContents[]> | ResourceContents[];
interface StaticResource { name: string; uri: string; title?: string; description?: string; mimeType?: string; reader: ResourceReader }
interface TemplateResource { name: string; uriTemplate: string; regex: RegExp; varNames: string[]; title?: string; description?: string; reader: ResourceReader }

export interface PromptDef {
  name: string; title?: string; description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
  build: (args: Record<string, string>) => { description?: string; messages: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }> };
}

interface RpcMessage { jsonrpc: '2.0'; id?: string | number | null; method?: string; params?: any; result?: any; error?: any }

// JSON-RPC error codes
const PARSE_ERROR = -32700, INVALID_REQUEST = -32600, METHOD_NOT_FOUND = -32601,
  INVALID_PARAMS = -32602, INTERNAL_ERROR = -32603, RESOURCE_NOT_FOUND = -32002;

function compileTemplate(tpl: string): { regex: RegExp; varNames: string[] } {
  const varNames: string[] = [];
  const pattern = tpl.replace(/[.*+?^${}()|[\]\\]/g, (m) => (m === '{' || m === '}' ? m : `\\${m}`))
    .replace(/\{([^}]+)\}/g, (_m, name) => { varNames.push(name); return '([^/]+)'; });
  return { regex: new RegExp(`^${pattern}$`), varNames };
}

export class McpServer {
  private tools: ToolDef[] = [];
  private statics: StaticResource[] = [];
  private templates: TemplateResource[] = [];
  private prompts: PromptDef[] = [];

  constructor(private info: { name: string; version: string }, private opts: { instructions?: string } = {}) {}

  tool(def: ToolDef): void { this.tools.push(def); }
  resource(def: StaticResource): void { this.statics.push(def); }
  resourceTemplate(def: Omit<TemplateResource, 'regex' | 'varNames'>): void {
    const { regex, varNames } = compileTemplate(def.uriTemplate);
    this.templates.push({ ...def, regex, varNames });
  }
  prompt(def: PromptDef): void { this.prompts.push(def); }

  // ---- dispatch -------------------------------------------------------------

  private async handle(method: string, params: any): Promise<any> {
    switch (method) {
      case 'initialize': {
        const requested = typeof params?.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_VERSION;
        return {
          protocolVersion: SUPPORTED.has(requested) ? requested : PROTOCOL_VERSION,
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: this.info,
          ...(this.opts.instructions ? { instructions: this.opts.instructions } : {}),
        };
      }
      case 'ping': return {};
      case 'tools/list':
        return { tools: this.tools.map(t => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema })) };
      case 'tools/call': {
        const t = this.tools.find(x => x.name === params?.name);
        if (!t) throw rpcError(INVALID_PARAMS, `unknown tool: ${params?.name}`);
        try {
          return await t.handler((params?.arguments ?? {}) as Record<string, unknown>);
        } catch (err: any) {
          // Tool execution errors are RESULTS (isError), so the model sees them.
          return { content: [{ type: 'text', text: `Error: ${err?.message || String(err)}` }], isError: true };
        }
      }
      case 'resources/list':
        return { resources: this.statics.map(r => ({ uri: r.uri, name: r.name, title: r.title, description: r.description, mimeType: r.mimeType })) };
      case 'resources/templates/list':
        return { resourceTemplates: this.templates.map(r => ({ uriTemplate: r.uriTemplate, name: r.name, title: r.title, description: r.description })) };
      case 'resources/read': {
        const uri = String(params?.uri ?? '');
        const stat = this.statics.find(r => r.uri === uri);
        if (stat) return { contents: await stat.reader(uri, {}) };
        for (const tpl of this.templates) {
          const m = tpl.regex.exec(uri);
          if (m) {
            const vars: Record<string, string> = {};
            tpl.varNames.forEach((n, i) => { vars[n] = decodeURIComponent(m[i + 1]); });
            return { contents: await tpl.reader(uri, vars) };
          }
        }
        throw rpcError(RESOURCE_NOT_FOUND, `resource not found: ${uri}`);
      }
      case 'prompts/list':
        return { prompts: this.prompts.map(p => ({ name: p.name, title: p.title, description: p.description, arguments: p.arguments })) };
      case 'prompts/get': {
        const p = this.prompts.find(x => x.name === params?.name);
        if (!p) throw rpcError(INVALID_PARAMS, `unknown prompt: ${params?.name}`);
        return p.build((params?.arguments ?? {}) as Record<string, string>);
      }
      default:
        throw rpcError(METHOD_NOT_FOUND, `method not found: ${method}`);
    }
  }

  private async dispatch(msg: RpcMessage): Promise<RpcMessage | null> {
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      // A response to us (no method) or garbage — ignore.
      if (msg && msg.method === undefined) return null;
      return { jsonrpc: '2.0', id: (msg?.id ?? null), error: { code: INVALID_REQUEST, message: 'invalid request' } };
    }
    const isNotification = msg.id === undefined || msg.id === null;
    try {
      const result = await this.handle(msg.method, msg.params);
      if (isNotification) return null; // notifications get no response
      return { jsonrpc: '2.0', id: msg.id!, result };
    } catch (err: any) {
      if (isNotification) return null;
      const code = typeof err?.code === 'number' ? err.code : INTERNAL_ERROR;
      return { jsonrpc: '2.0', id: msg.id!, error: { code, message: err?.message || String(err) } };
    }
  }

  /** Read newline-framed JSON-RPC from stdin, write responses to stdout. */
  async serveStdio(): Promise<void> {
    const write = (obj: RpcMessage) => process.stdout.write(JSON.stringify(obj) + '\n');
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let parsed: any;
        try { parsed = JSON.parse(line); }
        catch { write({ jsonrpc: '2.0', id: null, error: { code: PARSE_ERROR, message: 'parse error' } }); continue; }
        const batch = Array.isArray(parsed) ? parsed : [parsed];
        for (const m of batch) {
          this.dispatch(m as RpcMessage).then(res => { if (res) write(res); })
            .catch(e => write({ jsonrpc: '2.0', id: (m?.id ?? null), error: { code: INTERNAL_ERROR, message: String(e?.message || e) } }));
        }
      }
    });
    return new Promise<void>((resolve) => { process.stdin.on('end', resolve); process.stdin.on('close', resolve); });
  }

  /** Public entry for non-stdio transports (HTTP): dispatch ONE JSON-RPC message
   *  through the exact same handler stdio uses. Returns the response, or null for
   *  notifications. Keeps the hosted server behaviourally identical to stdio. */
  async handleMessage(msg: RpcMessage): Promise<RpcMessage | null> {
    return this.dispatch(msg);
  }
}

export type { RpcMessage };

function rpcError(code: number, message: string): Error & { code: number } {
  const e = new Error(message) as Error & { code: number };
  e.code = code;
  return e;
}
